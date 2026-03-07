#!/usr/bin/env bun
/**
 * Post-CRE-workflow: fetch leaves from contract leavesURI, claim shares, place orders.
 * No phase1-output.json — reads everything from chain.
 *
 * Flow:
 *   1. Read submarketStates for each submarket → leavesURI, merkleRoot
 *   2. Fetch leaves JSON from leavesURI (IPFS)
 *   3. For each agent: build merkle proof, batchClaimShares via factory.execute
 *   4. For each agent: place a few orders via factory.execute
 */

import {
  createPublicClient,
  createWalletClient,
  http,
  encodeFunctionData,
  keccak256,
  encodeAbiParameters,
  parseAbiParameters,
  encodePacked,
} from "viem";
import { baseSepolia } from "viem/chains";
import type { Address } from "viem";
import { SimpleMerkleTree } from "@openzeppelin/merkle-tree";
import { MINIMARKET_ABI } from "../../ts/src/market/abi";

const ORDERBOOK_ABI = [
  {
    type: "function",
    name: "placeOrder",
    inputs: [
      { name: "submarketId", type: "bytes32" },
      { name: "sellYes", type: "bool" },
      { name: "amount", type: "uint256" },
      { name: "price", type: "uint256" },
    ],
    outputs: [{ type: "uint256" }],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "takeOrder",
    inputs: [{ name: "orderId", type: "uint256" }],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "getOrderCount",
    inputs: [],
    outputs: [{ type: "uint256" }],
    stateMutability: "view",
  },
] as const;

const FACTORY_ABI = [
  {
    type: "function",
    name: "execute",
    inputs: [
      { name: "index", type: "uint256" },
      { name: "target", type: "address" },
      { name: "value", type: "uint256" },
      { name: "data", type: "bytes" },
    ],
    outputs: [{ type: "bytes" }],
    stateMutability: "nonpayable",
  },
] as const;

const SHARE_PRECISION = BigInt(1e6);
const PRICE_PRECISION = BigInt(1e18);

/** Extract revert reason from viem/contract errors (FakeAgent wraps with "Call failed") */
function getRevertReason(e: unknown): string {
  const err = e as Record<string, unknown>;
  const cause = (err.cause ?? err) as Record<string, unknown>;
  const data = (cause.data ?? err.data) as { errorName?: string; args?: unknown } | undefined;
  const name = data?.errorName;
  const msg =
    (err.reason as string) ??
    (err.shortMessage as string) ??
    (cause.shortMessage as string) ??
    (cause.message as string) ??
    (err.message as string);
  if (name) return `${name}${data?.args != null ? ` ${JSON.stringify(data.args)}` : ""}`;
  if (msg && msg !== "Call failed") return msg;
  return String(e);
}

function getSubmarketId(parentId: bigint, optionIndex: bigint): `0x${string}` {
  return keccak256(
    encodeAbiParameters(parseAbiParameters("uint256, uint256"), [parentId, optionIndex])
  );
}

function extractIpfsCid(uri: string): string | null {
  // ipfs://Qm... or https://.../ipfs/Qm...
  const m = uri.match(/(?:ipfs:\/\/|\/ipfs\/)([a-zA-Z0-9]+)/);
  return m ? m[1] : null;
}

async function fetchLeavesJson(uri: string, timeoutMs = 15000): Promise<unknown | null> {
  const cid = extractIpfsCid(uri);
  const urls = cid
    ? [
        `https://dweb.link/ipfs/${cid}`,
        `https://gateway.pinata.cloud/ipfs/${cid}`,
        `https://ipfs.io/ipfs/${cid}`,
        `https://cloudflare-ipfs.com/ipfs/${cid}`,
      ]
    : [uri];
  for (const url of urls) {
    try {
      const controller = new AbortController();
      const t = setTimeout(() => controller.abort(), timeoutMs);
      const res = await fetch(url, { signal: controller.signal });
      clearTimeout(t);
      if (res.ok) return await res.json();
    } catch {
      /* try next */
    }
  }
  return null;
}

type Leaf = { agent: string; yesShares: string; noShares: string };

function buildMerkleTree(leaves: Array<{ agent: string; yesShares: bigint; noShares: bigint }>) {
  const hashes = leaves.map((l) =>
    keccak256(encodePacked(["address", "uint256", "uint256"], [l.agent as `0x${string}`, l.yesShares, l.noShares]))
  );
  return SimpleMerkleTree.of(hashes);
}

export interface PostWorkflowParams {
  marketAddress: Address;
  orderbookAddress: Address;
  factoryAddress: Address;
  marketId: bigint;
  optionCount: number;
  agentCount: number;
  agentAddresses: Address[];
  walletClient: ReturnType<typeof createWalletClient>;
  publicClient: ReturnType<typeof createPublicClient>;
}

export async function runPostWorkflowClaimAndTrade(params: PostWorkflowParams): Promise<boolean> {
  const {
    marketAddress,
    orderbookAddress,
    factoryAddress,
    marketId,
    optionCount,
    agentCount,
    agentAddresses,
    walletClient,
    publicClient,
  } = params;

  const account = walletClient.account;
  if (!account) throw new Error("No wallet account");

  const effectiveOptionCount = Math.max(optionCount, 1);

  // 1. Read submarketStates for each submarket
  type SubmarketInfo = { submarketId: `0x${string}`; optionIndex: number; merkleRoot: `0x${string}`; leavesURI: string; phase: number };
  const submarkets: SubmarketInfo[] = [];
  for (let i = 0; i < effectiveOptionCount; i++) {
    const submarketId = getSubmarketId(marketId, BigInt(i));
    const state = (await publicClient.readContract({
      address: marketAddress,
      abi: MINIMARKET_ABI,
      functionName: "submarketStates",
      args: [submarketId],
    })) as unknown;
    const arr = Array.isArray(state) ? state : Object.values(state as object);
    const phase = Number(arr[0] ?? 0);
    const merkleRoot = (arr[1] ?? "0x") as `0x${string}`;
    const uri = String(arr[10] ?? "");
    submarkets.push({ submarketId, optionIndex: i, merkleRoot, leavesURI: uri, phase });
  }

  const tradingSubmarkets = submarkets.filter((s) => s.phase === 1);
  const uriToUse = submarkets.find((s) => s.leavesURI)?.leavesURI ?? "";
  if (tradingSubmarkets.length === 0) {
    console.log("   No submarkets in TRADING phase — nothing to claim.");
    return false;
  }
  if (!uriToUse) {
    console.error("   No leavesURI on submarkets — CRE workflow may not have run yet.");
    return false;
  }

  // 2. Fetch leaves from IPFS
  console.log(`   Fetching leaves from ${uriToUse.slice(0, 50)}...`);
  const raw = await fetchLeavesJson(uriToUse);
  if (!raw) {
    console.error("   Failed to fetch leaves from IPFS.");
    return false;
  }

  type SmEntry = { index?: number; leaves?: Leaf[] };
  const data = raw as { submarkets?: SmEntry[]; leaves?: Leaf[] };
  const getLeavesForOption = (optIdx: number): Leaf[] | undefined => {
    const sm = data.submarkets?.find((s) => (s.index ?? 0) === optIdx);
    if (sm?.leaves) return sm.leaves;
    if (optIdx === 0 && data.leaves) return data.leaves;
    return undefined;
  };

  // 3. Claim shares for each agent
  console.log("   Claiming shares...");
  for (let ai = 0; ai < agentCount; ai++) {
    const agentAddr = agentAddresses[ai];
    const claimSubmarketIds: `0x${string}`[] = [];
    const claimProofs: Array<{
      root: `0x${string}`;
      proof: `0x${string}`[];
      index: bigint;
      agent: `0x${string}`;
      yesShares: bigint;
      noShares: bigint;
    }> = [];

    for (const sm of tradingSubmarkets) {
      const leaves = getLeavesForOption(sm.optionIndex);
      if (!leaves || !sm.merkleRoot) continue;

      const parsed = leaves.map((l) => ({
        agent: l.agent,
        yesShares: BigInt(l.yesShares ?? 0),
        noShares: BigInt(l.noShares ?? 0),
      }));
      const leafIdx = parsed.findIndex((l) => l.agent.toLowerCase() === agentAddr.toLowerCase());
      if (leafIdx < 0) continue;
      const leaf = parsed[leafIdx];
      if (leaf.yesShares === 0n && leaf.noShares === 0n) continue;

      const tree = buildMerkleTree(parsed);
      claimSubmarketIds.push(sm.submarketId);
      claimProofs.push({
        root: sm.merkleRoot,
        proof: tree.getProof(leafIdx) as `0x${string}`[],
        index: BigInt(leafIdx),
        agent: agentAddr,
        yesShares: leaf.yesShares,
        noShares: leaf.noShares,
      });
    }

    if (claimSubmarketIds.length === 0) continue;

    try {
      const claimData = encodeFunctionData({
        abi: MINIMARKET_ABI,
        functionName: "batchClaimShares",
        args: [claimSubmarketIds, claimProofs],
      });
      const { request } = await publicClient.simulateContract({
        address: factoryAddress,
        abi: FACTORY_ABI,
        functionName: "execute",
        args: [BigInt(ai), marketAddress, 0n, claimData],
        account,
      });
      const hash = await walletClient.writeContract(request);
      console.log(`      agent[${ai}] claim: ${hash.slice(0, 12)}...`);
      await new Promise((r) => setTimeout(r, 2000));
    } catch (e) {
      const msg = getRevertReason(e);
      if (msg.includes("AlreadyClaimedShares")) console.log(`      agent[${ai}] already claimed`);
      else console.warn(`      agent[${ai}] claim skip: ${msg}`);
    }
  }

  // 4. Place a few orders per agent
  if (!orderbookAddress) return true;
  console.log("   Placing orders...");
  // Use small amount (0.0001 shares) — CRE allocates tiny shares with low ticket cost
  const tradeAmount = SHARE_PRECISION / 10000n;
  const trades = [
    { maker: 0, taker: 1, sellYes: true, amount: tradeAmount, price: (52n * PRICE_PRECISION) / 100n },
    { maker: 1, taker: 2, sellYes: false, amount: tradeAmount, price: (48n * PRICE_PRECISION) / 100n },
    { maker: 2, taker: 3, sellYes: false, amount: tradeAmount, price: (45n * PRICE_PRECISION) / 100n },
    { maker: 3, taker: 0, sellYes: false, amount: tradeAmount, price: (42n * PRICE_PRECISION) / 100n },
  ];
  for (const sm of submarkets.filter((s) => s.phase === 1)) {
    for (const t of trades) {
      if (t.maker >= agentCount || t.taker >= agentCount || t.maker === t.taker) continue;
      try {
        const placeData = encodeFunctionData({
          abi: ORDERBOOK_ABI,
          functionName: "placeOrder",
          args: [sm.submarketId, t.sellYes, t.amount, t.price],
        });
        const { request: placeReq } = await publicClient.simulateContract({
          address: factoryAddress,
          abi: FACTORY_ABI,
          functionName: "execute",
          args: [BigInt(t.maker), orderbookAddress, 0n, placeData],
          account,
        });
        await walletClient.writeContract(placeReq);
        await new Promise((r) => setTimeout(r, 2000));

        const orderCount = await publicClient.readContract({
          address: orderbookAddress,
          abi: ORDERBOOK_ABI,
          functionName: "getOrderCount",
        });
        const orderId = orderCount - 1n;
        const takeData = encodeFunctionData({
          abi: ORDERBOOK_ABI,
          functionName: "takeOrder",
          args: [orderId],
        });
        const { request: takeReq } = await publicClient.simulateContract({
          address: factoryAddress,
          abi: FACTORY_ABI,
          functionName: "execute",
          args: [BigInt(t.taker), orderbookAddress, 0n, takeData],
          account,
        });
        const hash = await walletClient.writeContract(takeReq);
        console.log(`      sm${sm.optionIndex} ${t.maker}→${t.taker}: ${hash.slice(0, 12)}...`);
        await new Promise((r) => setTimeout(r, 2000));
      } catch (e) {
        const msg = getRevertReason(e);
        console.warn(`      sm${sm.optionIndex} ${t.maker}→${t.taker} skip: ${msg}`);
      }
    }
  }
  return true;
}
