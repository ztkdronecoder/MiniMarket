#!/usr/bin/env bun
/**
 * CRE Workflow Simulator — simulates what the CRE workflow would do:
 * 1. Poll Ponder every 30s for markets ready to resolve (GET /workflows/next-phase1)
 * 2. When found: decrypt, compute shares, build merkle tree
 * 3. Log leaves to JSON file
 * 4. Post on-chain: root + leavesURI (mock — we have JSON locally)
 * 5. Participants claim via merkle proof
 *
 * Does NOT use workflows/phase-1 — uses ts/src/cre/workflow (CREWorkflow).
 *
 * Usage:
 *   bun run scripts/phase-1-test/cre-workflow-simulator.ts
 *
 * Environment:
 *   MARKET_ADDRESS   Contract address
 *   RPC_URL         RPC (default: http://127.0.0.1:8545)
 *   PONDER_URL      Ponder API (default: http://localhost:42069)
 *   POLL_INTERVAL   Seconds between polls (default: 30)
 *   KEYSTORE + KEYSTORE_PASSWORD or PRIVATE_KEY
 */

import { readFileSync, existsSync, writeFileSync } from "fs";
import { resolve, join } from "path";
import { createPublicClient, createWalletClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { Wallet } from "ethers";
import { CREWorkflow } from "../../ts/src/cre/workflow";
import { MINIMARKET_ABI } from "../../ts/src/market/abi";

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

const DRAND_GENESIS = 1692803367;
const DRAND_PERIOD = 3;

function currentDrandRound(): bigint {
  return BigInt(Math.floor((Date.now() / 1000 - DRAND_GENESIS) / DRAND_PERIOD));
}

async function pollNextPhase1(ponderUrl: string): Promise<Array<{
  marketId: string;
  drandTargetRound: string;
  submissionCount: number;
  submissions: Array<{ agent: string; validationHash: string }>;
}> | null> {
  // Use large currentDrandRound so we get markets even when chain time was fast-forwarded (test)
  const round = process.env.BYPASS_DRAND_ROUND === "1"
    ? "999999999999"
    : currentDrandRound().toString();
  const res = await fetch(`${ponderUrl}/workflows/next-phase1?currentDrandRound=${round}&single=true`);
  if (!res.ok) return null;
  const data = await res.json();
  return Array.isArray(data) ? data : null;
}

async function main() {
  const rpcUrl = process.env.RPC_URL ?? "http://127.0.0.1:8545";
  const ponderUrl = (process.env.PONDER_URL ?? "http://localhost:42069").replace(/\/$/, "");
  const pollInterval = parseInt(process.env.POLL_INTERVAL ?? "30", 10) * 1000;

  let contractAddress = process.env.MARKET_ADDRESS;
  if (!contractAddress) {
    const deployedPath = resolve(process.cwd(), "scripts/phase-1-test/deployed.json");
    if (existsSync(deployedPath)) {
      const deployed = JSON.parse(readFileSync(deployedPath, "utf-8"));
      contractAddress = deployed.localhost?.MiniMarket ?? deployed.MiniMarket;
    }
  }
  if (!contractAddress) {
    console.error("Set MARKET_ADDRESS or have scripts/phase-1-test/deployed.json");
    process.exit(1);
  }

  let privateKey = process.env.PRIVATE_KEY;
  if (!privateKey?.startsWith("0x")) privateKey = "0x" + (privateKey ?? "");
  if (!privateKey || privateKey === "0x") {
    const keystorePath = process.env.KEYSTORE ?? join(process.env.HOME ?? "~", ".foundry", "keystores", "chack");
    const password = process.env.KEYSTORE_PASSWORD;
    if (!password) {
      console.error("Set PRIVATE_KEY or KEYSTORE_PASSWORD");
      process.exit(1);
    }
    const keystoreJson = readFileSync(keystorePath, "utf-8");
    const wallet = await Wallet.fromEncryptedJson(keystoreJson, password);
    privateKey = wallet.privateKey;
  }

  const workflow = new CREWorkflow({
    contractAddress: contractAddress as `0x${string}`,
    privateKey: privateKey as `0x${string}`,
    rpcUrl,
    chain: LOCALHOST_CHAIN as any,
  });

  console.log("=== CRE Workflow Simulator ===");
  console.log("Contract:", contractAddress);
  console.log("Ponder:", ponderUrl);
  console.log("Polling every", pollInterval / 1000, "seconds for markets to resolve...");
  console.log("");

  // 1. Poll until we find a market
  let markets: Awaited<ReturnType<typeof pollNextPhase1>> = null;
  for (;;) {
    markets = await pollNextPhase1(ponderUrl);
    if (markets && markets.length > 0) {
      console.log("   Found market(s) ready for Phase 1 reveal:", markets.map((m) => m.marketId).join(", "));
      break;
    }
    console.log(`   [${new Date().toISOString()}] No markets yet, polling again in ${pollInterval / 1000}s...`);
    await new Promise((r) => setTimeout(r, pollInterval));
  }

  const market = markets![0];
  const marketId = BigInt(market.marketId);
  console.log("\n2. Processing market", marketId.toString(), "(decrypt, compute shares, merkle)...");

  const result = await workflow.processInfoReveal(marketId);
  console.log("   Consensus:", result.consensusOutcome === 1 ? "YES" : "NO");
  console.log("   Valid submissions:", result.validSubmissions.toString());
  console.log("   Merkle root:", result.merkleRoot);

  // 3. Write leaves to JSON (leaves = h(agent, yesShares, noShares) — participants use this for proofs)
  const leavesForJson = result.leaves.map((l) => ({
    agent: l.agent,
    yesShares: l.yesShares.toString(),
    noShares: l.noShares.toString(),
  }));

  const output = {
    marketId: marketId.toString(),
    merkleRoot: result.merkleRoot,
    consensusOutcome: result.consensusOutcome === 1 ? "YES" : "NO",
    totalYesShares: result.totalYesShares.toString(),
    totalNoShares: result.totalNoShares.toString(),
    leavesURI: "file://./phase1-output.json", // mock — we have JSON locally
    leaves: leavesForJson,
  };

  const outputPath = resolve(process.cwd(), "scripts", "phase-1-test", "phase1-output.json");
  writeFileSync(outputPath, JSON.stringify(output, null, 2));
  console.log("\n3. Wrote leaves to", outputPath);

  // 4. Post on-chain: root + leavesURI (empty — we have JSON locally)
  console.log("\n4. Submitting revealInfoPhase on-chain (root + leavesURI mock)...");
  const { request } = await (workflow as any).publicClient.simulateContract({
    address: contractAddress as `0x${string}`,
    abi: MINIMARKET_ABI,
    functionName: "revealInfoPhase",
    args: [
      marketId,
      result.merkleRoot,
      result.consensusOutcome,
      result.totalReserveYes,
      result.totalReserveNo,
      result.validSubmissions,
      result.totalYesShares,
      result.totalNoShares,
      "", // leavesURI — mock; leaves are in phase1-output.json
    ],
    account: (workflow as any).walletClient.account,
  });

  const revealHash = await (workflow as any).walletClient.writeContract(request);
  console.log("   Reveal tx:", revealHash);

  // 5. Participants claim via merkle proof (h(agent, yesShares, noShares))
  const publicClient = createPublicClient({
    chain: LOCALHOST_CHAIN as any,
    transport: http(rpcUrl),
  });

  console.log("\n5. Claiming shares for each participant (merkle proof)...");
  const keyByAddress = new Map<string, string>();
  for (const key of ANVIL_KEYS) {
    const acc = privateKeyToAccount(key as `0x${string}`);
    keyByAddress.set(acc.address.toLowerCase(), key);
  }
  for (let i = 0; i < result.leaves.length; i++) {
    const leaf = result.leaves[i];
    const proof = result.getProof(i);
    const key = keyByAddress.get(leaf.agent.toLowerCase());
    if (!key) {
      console.warn(`   No key for leaf agent ${leaf.agent}, skipping`);
      continue;
    }
    const account = privateKeyToAccount(key as `0x${string}`);

    const walletClient = createWalletClient({
      chain: LOCALHOST_CHAIN as any,
      transport: http(rpcUrl),
      account,
    });

    try {
      const { request } = await publicClient.simulateContract({
        address: contractAddress as `0x${string}`,
        abi: MINIMARKET_ABI,
        functionName: "claimShares",
        args: [
          marketId,
          {
            root: result.merkleRoot,
            proof,
            index: BigInt(i),
            agent: leaf.agent,
            yesShares: leaf.yesShares,
            noShares: leaf.noShares,
          },
        ],
        account,
      });

      const hash = await walletClient.writeContract(request);
      console.log(`   Claimed for ${leaf.agent}: ${hash}`);
    } catch (e) {
      console.error(`   Failed to claim for ${leaf.agent}:`, e);
    }
  }

  // 6. Assert: after 30s refetch, resolved market must NOT appear in next-phase1
  console.log("\n6. Waiting 30s, then asserting market no longer in /workflows/next-phase1...");
  await new Promise((r) => setTimeout(r, 30_000));
  const round = process.env.BYPASS_DRAND_ROUND === "1" ? "999999999999" : currentDrandRound().toString();
  const refetchRes = await fetch(`${ponderUrl}/workflows/next-phase1?currentDrandRound=${round}`);
  if (!refetchRes.ok) {
    console.error("   Failed to refetch next-phase1:", refetchRes.status);
    process.exit(1);
  }
  const refetchData = await refetchRes.json();
  const refetchMarkets = Array.isArray(refetchData) ? refetchData : [];
  const stillInList = refetchMarkets.some((m: { marketId: string }) => m.marketId === marketId.toString());
  if (stillInList) {
    console.error("   ASSERTION FAILED: Market", marketId, "still in next-phase1 after resolve. Refetch returned:", refetchMarkets.map((m: { marketId: string }) => m.marketId));
    process.exit(1);
  }
  console.log("   OK: Market", marketId, "correctly removed from next-phase1 list");

  console.log("\n=== CRE Workflow Simulator complete ===");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
