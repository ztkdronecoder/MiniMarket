#!/usr/bin/env bun
/**
 * Sepolia trading simulator — agents place and take orders via factory.execute
 * for the duration of the trading window (real time, no evm_increaseTime).
 *
 * Runs once per minute until trading end. Used by main.ts after Phase 1 workflow.
 */

import {
  createPublicClient,
  createWalletClient,
  http,
  encodeFunctionData,
  keccak256,
  encodeAbiParameters,
  parseAbiParameters,
} from "viem";
import { baseSepolia } from "viem/chains";
import type { Address } from "viem";
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

function getSubmarketId(parentId: bigint, optionIndex: bigint): `0x${string}` {
  return keccak256(
    encodeAbiParameters(parseAbiParameters("uint256, uint256"), [parentId, optionIndex])
  );
}

/** Extract revert reason from viem/contract errors */
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
  // Fallback: stringify first 200 chars for debugging
  const raw = String(e);
  return raw.length > 200 ? raw.slice(0, 200) + "…" : raw;
}

export interface SepoliaTradeSimulatorParams {
  marketAddress: Address;
  orderbookAddress: Address;
  factoryAddress: Address;
  marketId: bigint;
  optionCount: number;
  agentCount: number;
  walletClient: ReturnType<typeof createWalletClient>;
  publicClient: ReturnType<typeof createPublicClient>;
}

/** Run trading loop: place/take orders once per minute until trading window ends */
export async function runSepoliaTradeSimulator(params: SepoliaTradeSimulatorParams): Promise<void> {
  const {
    marketAddress,
    orderbookAddress,
    factoryAddress,
    marketId,
    optionCount,
    agentCount,
    walletClient,
    publicClient,
  } = params;

  if (!orderbookAddress) {
    console.warn("   No ORDERBOOK_ADDRESS — skipping trading simulator.");
    return;
  }

  const configResult = (await publicClient.readContract({
    address: marketAddress,
    abi: MINIMARKET_ABI,
    functionName: "configs",
    args: [marketId],
  })) as unknown;
  // configs returns tuple: [..., createdAt@9, tradingDuration@10, ...]
  const arr = Array.isArray(configResult) ? configResult : Object.values(configResult as object);
  const createdAt = Number(arr[9] ?? 0);
  const tradingDuration = Number(arr[10] ?? 0);
  const tradingEnd = createdAt + tradingDuration;

  if (!createdAt || !tradingDuration) {
    console.warn(`   Could not read market config (createdAt=${createdAt}, tradingDuration=${tradingDuration}) — skipping.`);
    return;
  }

  const nowAtStart = Math.floor(Date.now() / 1000);
  if (nowAtStart >= tradingEnd) {
    console.log("   Trading window already closed — nothing to do.");
    return;
  }

  const submarketIds: `0x${string}`[] = [];
  for (let i = 0; i < optionCount; i++) {
    submarketIds.push(getSubmarketId(marketId, BigInt(i)));
  }

  const TRADE_INTERVAL_MS = 60_000; // once per minute

  console.log("");
  console.log("═══ Trading simulator (agents via factory.execute) ═══");
  console.log(`   createdAt: ${createdAt}, tradingDuration: ${tradingDuration}s`);
  console.log(`   Trading window ends: ${new Date(tradingEnd * 1000).toLocaleTimeString()}`);
  console.log(`   Placing/taking orders every ${TRADE_INTERVAL_MS / 1000}s until then`);
  console.log(`   (Agents must have claimed Phase 1 shares via batchClaimShares first)`);
  console.log("");

  const tradeTemplates = [
    { makerIdx: 0, takerIdx: 1, sellYes: true, amount: SHARE_PRECISION / 100n, price: (52n * PRICE_PRECISION) / 100n },
    { makerIdx: 1, takerIdx: 2, sellYes: false, amount: SHARE_PRECISION / 100n, price: (48n * PRICE_PRECISION) / 100n },
    { makerIdx: 2, takerIdx: 3, sellYes: true, amount: SHARE_PRECISION / 100n, price: (55n * PRICE_PRECISION) / 100n },
    { makerIdx: 3, takerIdx: 4, sellYes: false, amount: SHARE_PRECISION / 100n, price: (50n * PRICE_PRECISION) / 100n },
  ];

  let round = 0;
  const runOneRound = async (): Promise<boolean> => {
    const now = Math.floor(Date.now() / 1000);
    if (now >= tradingEnd) return false;

    round++;
    const drift = BigInt((round - 1) * 2);
    console.log(`   [Round ${round}] ${new Date().toLocaleTimeString()} — placing orders...`);

    for (const smEntry of submarketIds.map((id, i) => ({ index: i, submarketId: id }))) {
      for (const t of tradeTemplates) {
        if (t.makerIdx >= agentCount || t.takerIdx >= agentCount) continue;
        if (t.makerIdx === t.takerIdx) continue;

        const price = ((Number(t.price) / Number(PRICE_PRECISION)) * 100 + Number(drift)) % 100;
        const pricePct = Math.floor(Math.max(10, Math.min(90, price)));
        const priceBn = (BigInt(pricePct) * PRICE_PRECISION) / 100n;

        try {
          const placeData = encodeFunctionData({
            abi: ORDERBOOK_ABI,
            functionName: "placeOrder",
            args: [smEntry.submarketId, t.sellYes, t.amount, priceBn],
          });

          const account = walletClient.account;
          if (!account) throw new Error("No wallet account");

          const { request: placeReq } = await publicClient.simulateContract({
            address: factoryAddress,
            abi: FACTORY_ABI,
            functionName: "execute",
            args: [BigInt(t.makerIdx), orderbookAddress, 0n, placeData],
            account,
          });
          await walletClient.writeContract(placeReq);
          await new Promise((r) => setTimeout(r, 2000)); // RPC nonce sync

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
            args: [BigInt(t.takerIdx), orderbookAddress, 0n, takeData],
            account,
          });
          const hash = await walletClient.writeContract(takeReq);
          console.log(`      sm${smEntry.index} agent${t.makerIdx}→${t.takerIdx} ${hash.slice(0, 12)}...`);
          await new Promise((r) => setTimeout(r, 2000)); // RPC nonce sync
        } catch (e) {
          const msg = getRevertReason(e);
          console.warn(`      sm${smEntry.index} skip: ${msg}`);
        }
      }
    }
    return true;
  };

  // First round immediately
  let shouldContinue = await runOneRound();

  while (shouldContinue) {
    await new Promise((r) => setTimeout(r, TRADE_INTERVAL_MS));
    shouldContinue = await runOneRound();
  }

  console.log("");
  console.log("   Trading window closed — stopping.");
  console.log("");
}
