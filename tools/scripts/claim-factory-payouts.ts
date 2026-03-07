#!/usr/bin/env bun
/**
 * Claim shares + payouts for fake agents via FakeAgentFactory.
 *
 * Flow:
 *   1. Query ponder for markets with phase=1 (TRADING) submarkets → batchClaimShares + batchClaimPayout
 *   2. Query ponder for markets with phase=2 (RESOLVED) submarkets → batchClaimPayout only
 *      (batchClaimShares is unavailable once a market is RESOLVED)
 *
 * Usage:
 *   bun run scripts/claim-factory-payouts.ts
 *
 * Environment:
 *   MARKET_ADDRESS, FACTORY_ADDRESS  (or read from deployed-addresses.json)
 *   RPC_URL                          (default: https://sepolia.base.org)
 *   PONDER_URL                       (default: http://localhost:42069)
 *   KEYSTORE + KEYSTORE_PASSWORD     or PRIVATE_KEY
 *   AGENT_INDICES                    comma-separated (default: 0,1,2,3,4)
 */

import { readFileSync, existsSync } from "fs";
import { resolve, join } from "path";
import {
  createPublicClient,
  createWalletClient,
  http,
  encodeFunctionData,
  keccak256,
  encodePacked,
  encodeAbiParameters,
  parseAbiParameters,
  type Address,
} from "viem";
import { baseSepolia } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";
import { Wallet } from "ethers";
import { SimpleMerkleTree } from "@openzeppelin/merkle-tree";
import { MINIMARKET_ABI } from "../ts/src/market/abi";

// ─── ABIs ─────────────────────────────────────────────────────────────────────

const FACTORY_ABI = [
  {
    type: "function",
    name: "getAgentAddress",
    inputs: [{ name: "index", type: "uint256" }],
    outputs: [{ type: "address" }],
    stateMutability: "view",
  },
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

// ─── Helpers ─────────────────────────────────────────────────────────────────

function computeSubmarketId(parentMarketId: bigint, optionIndex: number): `0x${string}` {
  return keccak256(
    encodeAbiParameters(parseAbiParameters("uint256, uint256"), [parentMarketId, BigInt(optionIndex)])
  );
}

function buildMerkleTree(leaves: Array<{ agent: string; yesShares: bigint; noShares: bigint }>) {
  const leafHashes = leaves.map((l) =>
    keccak256(encodePacked(["address", "uint256", "uint256"], [l.agent as `0x${string}`, l.yesShares, l.noShares]))
  );
  return SimpleMerkleTree.of(leafHashes);
}

function extractIpfsCid(uri: string): string | null {
  const m = uri.match(/\/ipfs\/([a-zA-Z0-9]+)/);
  return m ? m[1] : null;
}

async function fetchIpfsJson(uri: string, timeoutMs = 10000): Promise<unknown | null> {
  const cid = extractIpfsCid(uri);
  const urls = cid
    ? [uri, `https://ipfs.io/ipfs/${cid}`, `https://cloudflare-ipfs.com/ipfs/${cid}`]
    : [uri];
  for (const url of urls) {
    try {
      const controller = new AbortController();
      const t = setTimeout(() => controller.abort(), timeoutMs);
      const res = await fetch(url, { signal: controller.signal });
      clearTimeout(t);
      if (res.ok) return await res.json();
    } catch { /* try next */ }
  }
  return null;
}

async function waitForTx(
  publicClient: ReturnType<typeof createPublicClient>,
  hash: `0x${string}`,
  label: string
) {
  process.stdout.write(`   ${label} → ${hash.slice(0, 12)}...`);
  await publicClient.waitForTransactionReceipt({ hash });
  console.log(" ✅");
  await new Promise((r) => setTimeout(r, 2000));
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const rootDir = resolve(import.meta.dir, "..");
  const ponderUrl = (process.env.PONDER_URL ?? "http://localhost:42069").replace(/\/$/, "");
  const rpcUrl = process.env.RPC_URL ?? "https://sepolia.base.org";
  const agentIndices = (process.env.AGENT_INDICES ?? "0,1,2,3,4")
    .split(",")
    .map((s) => parseInt(s.trim(), 10))
    .filter((n) => !Number.isNaN(n));

  // ── Read deployed addresses ────────────────────────────────────────────────
  let marketAddress = process.env.MARKET_ADDRESS as Address | undefined;
  let factoryAddress = process.env.FACTORY_ADDRESS as Address | undefined;

  if (!marketAddress || !factoryAddress) {
    const deployedPath = resolve(rootDir, "deployed-addresses.json");
    if (existsSync(deployedPath)) {
      const deployed = JSON.parse(readFileSync(deployedPath, "utf-8"));
      const net = deployed.baseSepolia ?? deployed.localhost;
      marketAddress = marketAddress ?? net?.Cortex;
      factoryAddress = factoryAddress ?? net?.FakeAgentFactory;
    }
  }
  if (!marketAddress) { console.error("Set MARKET_ADDRESS or have deployed-addresses.json"); process.exit(1); }
  if (!factoryAddress) { console.error("Set FACTORY_ADDRESS or have deployed-addresses.json"); process.exit(1); }

  // ── Decrypt keystore ───────────────────────────────────────────────────────
  let privateKey: `0x${string}`;
  if (process.env.PRIVATE_KEY) {
    privateKey = process.env.PRIVATE_KEY as `0x${string}`;
  } else {
    const keystorePath = process.env.KEYSTORE ?? join(process.env.HOME ?? "~", ".foundry", "keystores", "chack");
    const password = process.env.KEYSTORE_PASSWORD;
    if (!password) { console.error("Set KEYSTORE_PASSWORD or PRIVATE_KEY"); process.exit(1); }
    process.stdout.write("   Decrypting keystore... ");
    const wallet = await Wallet.fromEncryptedJson(readFileSync(keystorePath, "utf-8"), password);
    privateKey = wallet.privateKey as `0x${string}`;
    console.log("done");
  }

  const account = privateKeyToAccount(privateKey);
  const publicClient = createPublicClient({ chain: baseSepolia, transport: http(rpcUrl) });
  const walletClient = createWalletClient({ chain: baseSepolia, transport: http(rpcUrl), account });

  console.log(`\nDeployer:  ${account.address}`);
  console.log(`Market:    ${marketAddress}`);
  console.log(`Factory:   ${factoryAddress}`);
  console.log(`Agents:    [${agentIndices.join(", ")}]`);

  // ── Get agent addresses ────────────────────────────────────────────────────
  const agentAddresses: Address[] = [];
  for (const idx of agentIndices) {
    const addr = await publicClient.readContract({
      address: factoryAddress!,
      abi: FACTORY_ABI,
      functionName: "getAgentAddress",
      args: [BigInt(idx)],
    });
    agentAddresses.push(addr as Address);
  }
  console.log("\nAgent addresses:");
  agentIndices.forEach((idx, i) => console.log(`  [${idx}] ${agentAddresses[i]}`));

  // ── Query ponder for all markets ───────────────────────────────────────────
  console.log(`\nQuerying ponder at ${ponderUrl}...`);
  const marketsRes = await fetch(`${ponderUrl}/markets?limit=100`);
  if (!marketsRes.ok) { console.error("Failed to fetch markets from ponder"); process.exit(1); }
  const markets: Array<{ id: string; optionCount: number }> = await marketsRes.json();
  console.log(`  Found ${markets.length} market(s)`);

  type SubmarketData = {
    id: string;
    parentMarketId: string;
    optionIndex: number;
    phase: number;
    merkleRoot: string | null;
    leavesURI: string | null;
    resolvedOutcome: number | null;
  };

  // Collect submarkets across all markets
  const tradingSubmarkets: SubmarketData[] = []; // phase=1: can claim shares
  const resolvedSubmarkets: SubmarketData[] = []; // phase=2: can claim payout only

  for (const mkt of markets) {
    const smRes = await fetch(`${ponderUrl}/markets/${mkt.id}/submarkets`);
    if (!smRes.ok) continue;
    const sms: SubmarketData[] = await smRes.json();
    for (const sm of sms) {
      if (sm.phase === 1 && !sm.resolvedOutcome) tradingSubmarkets.push(sm);
      else if (sm.phase === 2 || sm.resolvedOutcome != null) resolvedSubmarkets.push(sm);
    }
  }

  console.log(`  TRADING (phase=1): ${tradingSubmarkets.length} submarket(s) — can claim shares`);
  console.log(`  RESOLVED (phase=2): ${resolvedSubmarkets.length} submarket(s) — payout only`);

  // ─── PHASE 1: batchClaimShares for TRADING submarkets ────────────────────
  if (tradingSubmarkets.length > 0) {
    // Group by leavesURI (one upload per parent market covers all its submarkets)
    const uriToSubs = new Map<string, SubmarketData[]>();
    for (const sm of tradingSubmarkets) {
      const uri = sm.leavesURI ?? "";
      if (!uriToSubs.has(uri)) uriToSubs.set(uri, []);
      uriToSubs.get(uri)!.push(sm);
    }

    for (const [uri, subs] of uriToSubs) {
      if (!uri) {
        console.warn(`\n⚠️  Submarkets with no leavesURI — cannot reconstruct proofs, skipping`);
        for (const sm of subs) console.warn(`   ${sm.id} (market ${sm.parentMarketId})`);
        continue;
      }

      console.log(`\n  Fetching leaves from ${uri.slice(0, 60)}...`);
      const raw = await fetchIpfsJson(uri);
      if (!raw) {
        console.error(`   Failed to fetch — skipping ${subs.length} submarket(s)`);
        continue;
      }

      type Leaf = { agent: string; yesShares: string; noShares: string };
      type SmEntry = { index: number; leaves: Leaf[] };
      const data = raw as { submarkets?: SmEntry[]; leaves?: Leaf[] };

      // For each agent, build proofs covering all submarkets that have this leavesURI
      for (let ai = 0; ai < agentIndices.length; ai++) {
        const agentIndex = agentIndices[ai];
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

        for (const sm of subs) {
          const leaves: Leaf[] | undefined =
            data.submarkets?.find((s) => s.index === sm.optionIndex)?.leaves
            ?? (sm.optionIndex === 0 ? data.leaves : undefined);

          if (!leaves || !sm.merkleRoot) continue;

          const parsedLeaves = leaves.map((l) => ({
            agent: l.agent,
            yesShares: BigInt(l.yesShares ?? 0),
            noShares: BigInt(l.noShares ?? 0),
          }));

          const leafIdx = parsedLeaves.findIndex(
            (l) => l.agent.toLowerCase() === agentAddr.toLowerCase()
          );
          if (leafIdx < 0) continue;
          const leaf = parsedLeaves[leafIdx];
          if (leaf.yesShares === 0n && leaf.noShares === 0n) continue;

          const tree = buildMerkleTree(parsedLeaves);
          claimSubmarketIds.push(sm.id as `0x${string}`);
          claimProofs.push({
            root: sm.merkleRoot as `0x${string}`,
            proof: tree.getProof(leafIdx) as `0x${string}`[],
            index: BigInt(leafIdx),
            agent: agentAddr,
            yesShares: leaf.yesShares,
            noShares: leaf.noShares,
          });
        }

        if (claimSubmarketIds.length === 0) {
          console.log(`  Agent[${agentIndex}]: not in any leaf — skipping batchClaimShares`);
          continue;
        }

        const claimSharesData = encodeFunctionData({
          abi: MINIMARKET_ABI,
          functionName: "batchClaimShares",
          args: [claimSubmarketIds, claimProofs],
        });

        try {
          const hash = await walletClient.writeContract({
            address: factoryAddress!,
            abi: FACTORY_ABI,
            functionName: "execute",
            args: [BigInt(agentIndex), marketAddress!, 0n, claimSharesData],
          });
          await waitForTx(publicClient, hash, `agent[${agentIndex}] batchClaimShares (${claimSubmarketIds.length} sm)`);
        } catch (e) {
          const msg = String(e).slice(0, 120);
          if (msg.includes("AlreadyClaimedShares")) {
            console.log(`  Agent[${agentIndex}]: shares already claimed`);
          } else {
            console.error(`  Agent[${agentIndex}] batchClaimShares failed:`, msg);
          }
        }
      }
    }
  }

  // ─── PHASE 2: batchClaimPayout for RESOLVED submarkets ───────────────────
  const allPayoutSubs = [
    ...tradingSubmarkets.map((s) => s.id as `0x${string}`),
    ...resolvedSubmarkets.map((s) => s.id as `0x${string}`),
  ];

  if (allPayoutSubs.length === 0) {
    console.log("\nNo submarkets to claim payout from.");
    return;
  }

  console.log(`\n═══ Claiming payouts for ${allPayoutSubs.length} submarket(s) ═══`);

  for (let ai = 0; ai < agentIndices.length; ai++) {
    const agentIndex = agentIndices[ai];
    const claimPayoutData = encodeFunctionData({
      abi: MINIMARKET_ABI,
      functionName: "batchClaimPayout",
      args: [allPayoutSubs],
    });

    try {
      const hash = await walletClient.writeContract({
        address: factoryAddress!,
        abi: FACTORY_ABI,
        functionName: "execute",
        args: [BigInt(agentIndex), marketAddress!, 0n, claimPayoutData],
      });
      await waitForTx(publicClient, hash, `agent[${agentIndex}] batchClaimPayout`);
    } catch (e) {
      const msg = String(e).slice(0, 120);
      if (msg.includes("NothingToClaim")) {
        console.log(`  Agent[${agentIndex}]: nothing to claim (no winning shares)`);
      } else {
        console.error(`  Agent[${agentIndex}] batchClaimPayout failed:`, msg);
      }
    }
  }

  console.log("\n✅ Done.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
