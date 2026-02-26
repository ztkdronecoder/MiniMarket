#!/usr/bin/env bun
/**
 * Trade + Phase 2 Simulator — after phase 1 claims:
 * 1. Place/take orders on OrderbookMarket (fuzzy trades)
 * 2. Fast-forward so trading deadline passes
 * 3. Resolve market (resolveMarket)
 * 4. Winners claim payouts (claimPayout)
 *
 * Usage:
 *   bun run scripts/phase-1-test/trade-and-phase2-simulator.ts
 *
 * Environment:
 *   MARKET_ADDRESS, ORDERBOOK_ADDRESS (or from deployed.json)
 *   RPC_URL, KEYSTORE, KEYSTORE_PASSWORD
 *   PHASE1_OUTPUT  path to phase1-output.json (default: scripts/phase-1-test/phase1-output.json)
 */

import { readFileSync, existsSync } from "fs";
import { resolve, join } from "path";
import { createPublicClient, createWalletClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { Wallet } from "ethers";
import { MINIMARKET_ABI } from "../../ts/src/market/abi";

const ORDERBOOK_ABI = [
  {
    type: "function",
    name: "placeOrder",
    inputs: [
      { name: "marketId", type: "uint256" },
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

const LOCALHOST_CHAIN = {
  id: 31337,
  name: "Localhost",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: ["http://127.0.0.1:8545"] } },
};

const ANVIL_KEYS = [
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80",
  "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d",
  "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a",
  "0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6",
  "0x8b3a350cf5c34c9194ca85829a2df0ec3153be0318b5e2d3348e872092edffba",
];

// Share scale matches USDC (1e6) — ticket 1 USDC => ~1e6 shares per participant
const SHARE_PRECISION = BigInt(1e6);
// Orderbook price is ratio 0..1e18
const PRICE_PRECISION = BigInt(1e18);

async function main() {
  const rpcUrl = process.env.RPC_URL ?? "http://127.0.0.1:8545";

  let contractAddress = process.env.MARKET_ADDRESS;
  let orderbookAddress = process.env.ORDERBOOK_ADDRESS;
  const deployedPath = resolve(process.cwd(), "scripts/phase-1-test/deployed.json");
  if (existsSync(deployedPath)) {
    const deployed = JSON.parse(readFileSync(deployedPath, "utf-8"));
    const local = deployed.localhost ?? deployed;
    contractAddress = contractAddress ?? local.MiniMarket;
    orderbookAddress = orderbookAddress ?? local.OrderbookMarket;
  }
  if (!contractAddress || !orderbookAddress) {
    console.error("Set MARKET_ADDRESS and ORDERBOOK_ADDRESS or have deployed.json with both");
    process.exit(1);
  }

  const phase1Path = process.env.PHASE1_OUTPUT ?? resolve(process.cwd(), "scripts/phase-1-test/phase1-output.json");
  if (!existsSync(phase1Path)) {
    console.error("Phase 1 output not found:", phase1Path);
    process.exit(1);
  }
  const phase1 = JSON.parse(readFileSync(phase1Path, "utf-8"));
  const marketId = BigInt(phase1.marketId);
  const consensusOutcome = phase1.consensusOutcome === "YES" ? 1 : 2;

  let privateKey = process.env.PRIVATE_KEY;
  if (!privateKey?.startsWith("0x")) privateKey = "0x" + (privateKey ?? "");
  if (!privateKey || privateKey === "0x") {
    const keystorePath = process.env.KEYSTORE ?? join(process.env.HOME ?? "~", ".foundry", "keystores", "chack");
    const password = process.env.KEYSTORE_PASSWORD;
    if (!password) {
      console.error("Set PRIVATE_KEY or KEYSTORE_PASSWORD");
      process.exit(1);
    }
    const wallet = await Wallet.fromEncryptedJson(readFileSync(keystorePath, "utf-8"), password);
    privateKey = wallet.privateKey;
  }

  const publicClient = createPublicClient({
    chain: LOCALHOST_CHAIN as any,
    transport: http(rpcUrl),
  });

  const keyByAddress = new Map<string, string>();
  for (const key of ANVIL_KEYS) {
    const acc = privateKeyToAccount(key as `0x${string}`);
    keyByAddress.set(acc.address.toLowerCase(), key);
  }

  console.log("=== Trade + Phase 2 Simulator ===");
  console.log("Market:", contractAddress, "ID:", marketId.toString());
  console.log("Orderbook:", orderbookAddress);
  console.log("Consensus:", phase1.consensusOutcome);
  console.log("");

  // 1. Fuzzy trading: place orders, have others take them
  console.log("1. Trading on orderbook (place + take orders)...");
  const leaves = phase1.leaves as Array<{ agent: string; yesShares: string; noShares: string }>;
  const agentsWithKeys = leaves
    .map((l) => ({ ...l, key: keyByAddress.get(l.agent.toLowerCase()) }))
    .filter((a) => a.key) as Array<{ agent: string; yesShares: string; noShares: string; key: string }>;

  // Fuzzy trades: 0.01 shares each (1e4 in 1e6 scale) so balances stay sufficient
  const trades: Array<{ makerIdx: number; takerIdx: number; sellYes: boolean; amount: bigint; price: bigint }> = [
    { makerIdx: 0, takerIdx: 1, sellYes: true, amount: SHARE_PRECISION / 100n, price: (55n * PRICE_PRECISION) / 100n },
    { makerIdx: 1, takerIdx: 2, sellYes: false, amount: SHARE_PRECISION / 100n, price: (45n * PRICE_PRECISION) / 100n },
    { makerIdx: 2, takerIdx: 3, sellYes: true, amount: SHARE_PRECISION / 100n, price: (5n * PRICE_PRECISION) / 10n },
    { makerIdx: 3, takerIdx: 4, sellYes: false, amount: SHARE_PRECISION / 100n, price: (52n * PRICE_PRECISION) / 100n },
  ];

  for (const t of trades) {
    if (t.makerIdx >= agentsWithKeys.length || t.takerIdx >= agentsWithKeys.length) continue;
    const maker = agentsWithKeys[t.makerIdx];
    const taker = agentsWithKeys[t.takerIdx];
    if (maker.agent === taker.agent) continue;

    const makerAccount = privateKeyToAccount(maker.key as `0x${string}`);
    const takerAccount = privateKeyToAccount(taker.key as `0x${string}`);

    try {
      const makerWallet = createWalletClient({
        chain: LOCALHOST_CHAIN as any,
        transport: http(rpcUrl),
        account: makerAccount,
      });
      const { request: placeReq } = await publicClient.simulateContract({
        address: orderbookAddress as `0x${string}`,
        abi: ORDERBOOK_ABI,
        functionName: "placeOrder",
        args: [marketId, t.sellYes, t.amount, t.price],
        account: makerAccount,
      });
      await makerWallet.writeContract(placeReq);
      const orderCount = await publicClient.readContract({
        address: orderbookAddress as `0x${string}`,
        abi: ORDERBOOK_ABI,
        functionName: "getOrderCount",
      });
      const orderId = orderCount - 1n;

      const takerWallet = createWalletClient({
        chain: LOCALHOST_CHAIN as any,
        transport: http(rpcUrl),
        account: takerAccount,
      });
      const { request: takeReq } = await publicClient.simulateContract({
        address: orderbookAddress as `0x${string}`,
        abi: ORDERBOOK_ABI,
        functionName: "takeOrder",
        args: [orderId],
        account: takerAccount,
      });
      const hash = await takerWallet.writeContract(takeReq);
      console.log(`   Trade: ${maker.agent.slice(0, 10)}... → ${taker.agent.slice(0, 10)}... ${hash}`);
    } catch (e) {
      console.warn(`   Trade skipped (${maker.agent.slice(0, 8)}→${taker.agent.slice(0, 8)}):`, (e as Error).message?.slice(0, 60));
    }
  }

  // 2. Fast-forward 5 min (trading deadline)
  console.log("\n2. Fast-forwarding 5 min (trading deadline)...");
  const rpcBody = (method: string, params: unknown[] = []) =>
    JSON.stringify({ jsonrpc: "2.0", id: 1, method, params });
  await fetch(rpcUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: rpcBody("evm_increaseTime", [300]),
  });
  await fetch(rpcUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: rpcBody("evm_mine", []),
  });
  console.log("   Time advanced");

  // 3. Resolve market (CRE/owner only)
  console.log("\n3. Resolving market (outcome:", phase1.consensusOutcome, ")...");
  const creAccount = privateKeyToAccount(privateKey as `0x${string}`);
  const creWallet = createWalletClient({
    chain: LOCALHOST_CHAIN as any,
    transport: http(rpcUrl),
    account: creAccount,
  });
  const { request: resolveReq } = await publicClient.simulateContract({
    address: contractAddress as `0x${string}`,
    abi: MINIMARKET_ABI,
    functionName: "resolveMarket",
    args: [marketId, consensusOutcome],
    account: creAccount,
  });
  const resolveHash = await creWallet.writeContract(resolveReq);
  console.log("   Resolve tx:", resolveHash);

  // 4. Winners claim payouts
  console.log("\n4. Claiming payouts (winners)...");
  const winningOutcome = consensusOutcome;
  for (const leaf of leaves) {
    const key = keyByAddress.get(leaf.agent.toLowerCase());
    if (!key) continue;
    const account = privateKeyToAccount(key as `0x${string}`);
    const winningShares = winningOutcome === 1 ? BigInt(leaf.yesShares) : BigInt(leaf.noShares);
    if (winningShares === 0n) {
      console.log(`   Skip ${leaf.agent.slice(0, 10)}... (no winning shares)`);
      continue;
    }
    const wallet = createWalletClient({
      chain: LOCALHOST_CHAIN as any,
      transport: http(rpcUrl),
      account,
    });
    try {
      const { request } = await publicClient.simulateContract({
        address: contractAddress as `0x${string}`,
        abi: MINIMARKET_ABI,
        functionName: "claimPayout",
        args: [marketId],
        account,
      });
      const hash = await wallet.writeContract(request);
      console.log(`   Claimed for ${leaf.agent}: ${hash}`);
    } catch (e) {
      console.error(`   Failed to claim for ${leaf.agent}:`, (e as Error).message?.slice(0, 80));
    }
  }

  console.log("\n=== Trade + Phase 2 Simulator complete ===");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
