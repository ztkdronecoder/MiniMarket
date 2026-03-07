#!/usr/bin/env bun
/**
 * Sepolia trading simulator — agents place and take orders via factory.execute
 * for the duration of the trading window (real time, no evm_increaseTime).
 *
 * Each round:
 *   1. Fill 2–4 oldest pending orders from prior rounds (deferred fills).
 *   2. Place 3–5 new random orders per submarket (random direction/amount/price).
 *      Newly placed orders are queued and NOT filled in the same round.
 *
 * This creates realistic noise: many orders accumulate before being filled.
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
// Base amount: 0.05 shares — multiplied 1x–8x per order for variety (0.05–0.40 shares)
const BASE_AMOUNT = SHARE_PRECISION / 20n;

function getSubmarketId(parentId: bigint, optionIndex: bigint): `0x${string}` {
  return keccak256(
    encodeAbiParameters(parseAbiParameters("uint256, uint256"), [parentId, optionIndex])
  );
}

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
  const raw = String(e);
  return raw.length > 300 ? raw.slice(0, 300) + "…" : raw;
}

function randInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function randDifferent(min: number, max: number, exclude: number): number {
  let v = randInt(min, max);
  while (v === exclude && max > min) v = randInt(min, max);
  return v;
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

interface PendingOrder {
  orderId: bigint;
  makerIdx: number;
  takerIdx: number;
  sellYes: boolean;
  pricePct: number;
  smIndex: number;
}

/** Run trading loop: place/fill orders once per minute until trading window ends */
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
  const pendingOrders: PendingOrder[] = [];

  console.log("");
  console.log("═══ Trading simulator (random orders, deferred fills) ═══");
  console.log(`   createdAt: ${createdAt}, tradingDuration: ${tradingDuration}s`);
  console.log(`   Trading window ends: ${new Date(tradingEnd * 1000).toLocaleTimeString()}`);
  console.log(`   Intervals: ${TRADE_INTERVAL_MS / 1000}s | Per round: place 3–5 orders/submarket, fill 2–4 pending`);
  console.log("");

  const account = walletClient.account;
  if (!account) throw new Error("No wallet account");

  let round = 0;

  const runOneRound = async (): Promise<boolean> => {
    const now = Math.floor(Date.now() / 1000);
    if (now >= tradingEnd) return false;

    round++;
    console.log(`   [Round ${round}] ${new Date().toLocaleTimeString()} — pending: ${pendingOrders.length} orders`);

    // ── Phase A: Fill oldest pending orders (from previous rounds) ──────────
    const fillCount = Math.min(pendingOrders.length, randInt(2, 4));
    if (fillCount > 0) {
      console.log(`      filling ${fillCount} pending order(s)...`);
      const toFill = pendingOrders.splice(0, fillCount);
      for (const o of toFill) {
        try {
          const takeData = encodeFunctionData({
            abi: ORDERBOOK_ABI,
            functionName: "takeOrder",
            args: [o.orderId],
          });
          const hash = await walletClient.writeContract({
            address: factoryAddress,
            abi: FACTORY_ABI,
            functionName: "execute",
            args: [BigInt(o.takerIdx), orderbookAddress, 0n, takeData],
            account,
            gas: 300_000n,
          });
          console.log(`      fill #${o.orderId} sm${o.smIndex} agent${o.takerIdx} takes ${o.sellYes ? "YES" : "NO"} @${o.pricePct}% ${hash.slice(0, 12)}…`);
        } catch (e) {
          console.warn(`      fill #${o.orderId} skip: ${getRevertReason(e)}`);
        }
        await new Promise((r) => setTimeout(r, 2000));
      }
    }

    // ── Phase B: Place new random orders per submarket ───────────────────────
    for (const smEntry of submarketIds.map((id, i) => ({ index: i, submarketId: id }))) {
      const placeCount = randInt(3, 5);
      console.log(`      sm${smEntry.index}: placing ${placeCount} new orders...`);

      for (let p = 0; p < placeCount; p++) {
        const makerIdx = randInt(0, agentCount - 1);
        const takerIdx = randDifferent(0, agentCount - 1, makerIdx);
        const sellYes = Math.random() < 0.5;
        const amount = BigInt(randInt(1, 8)) * BASE_AMOUNT;
        const pricePct = randInt(15, 85);
        const priceBn = (BigInt(pricePct) * PRICE_PRECISION) / 100n;

        try {
          // Read current order count so we can know the orderId that will be assigned
          const orderCount = (await publicClient.readContract({
            address: orderbookAddress,
            abi: ORDERBOOK_ABI,
            functionName: "getOrderCount",
          })) as bigint;

          const placeData = encodeFunctionData({
            abi: ORDERBOOK_ABI,
            functionName: "placeOrder",
            args: [smEntry.submarketId, sellYes, amount, priceBn],
          });

          const { request } = await publicClient.simulateContract({
            address: factoryAddress,
            abi: FACTORY_ABI,
            functionName: "execute",
            args: [BigInt(makerIdx), orderbookAddress, 0n, placeData],
            account,
          });
          const hash = await walletClient.writeContract(request);

          const orderId = orderCount; // placeOrder appends at index = current count
          pendingOrders.push({ orderId, makerIdx, takerIdx, sellYes, pricePct, smIndex: smEntry.index });

          console.log(`      place #${orderId} sm${smEntry.index} agent${makerIdx} ${sellYes ? "sellYES" : "sellNO"} @${pricePct}% amt=${amount} ${hash.slice(0, 12)}…`);
        } catch (e) {
          console.warn(`      place sm${smEntry.index} skip: ${getRevertReason(e)}`);
        }
        await new Promise((r) => setTimeout(r, 2000));
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
