#!/usr/bin/env bun
/**
 * Phase 1 workflow: fetch from Ponder, decrypt, build merkle, reveal, claim.
 * Uses localhost RPC and Ponder API.
 *
 * Usage:
 *   bun run scripts/phase-1-test/phase1-workflow.ts <marketId>
 *
 * Environment:
 *   MARKET_ADDRESS   Contract address
 *   RPC_URL          RPC (default: http://127.0.0.1:8545)
 *   PONDER_URL       Ponder API (default: http://localhost:42069)
 *   PRIVATE_KEY      CRE forwarder key (for reveal) - or KEYSTORE + KEYSTORE_PASSWORD
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

async function main() {
  const args = process.argv.slice(2);
  if (args.length < 1) {
    console.error("Usage: bun run scripts/phase-1-test/phase1-workflow.ts <marketId>");
    process.exit(1);
  }

  const marketId = BigInt(args[0]);
  const rpcUrl = process.env.RPC_URL ?? "http://127.0.0.1:8545";
  const ponderUrl = (process.env.PONDER_URL ?? "http://localhost:42069").replace(/\/$/, "");

  let contractAddress = process.env.MARKET_ADDRESS;
  if (!contractAddress) {
    const deployedPath = resolve(process.cwd(), "deployed-addresses.json");
    if (existsSync(deployedPath)) {
      const deployed = JSON.parse(readFileSync(deployedPath, "utf-8"));
      contractAddress = deployed.baseSepolia?.MiniMarket ?? deployed.localhost?.MiniMarket;
    }
  }
  if (!contractAddress) {
    console.error("Set MARKET_ADDRESS or have deployed-addresses.json");
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

  console.log("=== Phase 1 Workflow ===");
  console.log("Market:", marketId.toString());
  console.log("Contract:", contractAddress);
  console.log("Ponder:", ponderUrl);
  console.log("");

  // 1. Fetch from Ponder /workflows/next-phase1
  console.log("1. Fetching from Ponder /workflows/next-phase1...");
  const currentRound = BigInt(Math.floor((Date.now() / 1000 - 1692803367) / 3));
  const ponderRes = await fetch(`${ponderUrl}/workflows/next-phase1?currentDrandRound=${currentRound}`);
  if (!ponderRes.ok) {
    console.error("Ponder fetch failed:", ponderRes.status, await ponderRes.text());
    process.exit(1);
  }
  const markets = (await ponderRes.json()) as Array<{
    marketId: string;
    drandTargetRound: string;
    submissionCount: number;
    submissions: Array<{ agent: string; validationHash: string }>;
  }>;
  const ourMarket = markets.find((m) => m.marketId === marketId.toString());
  if (!ourMarket) {
    console.error("Market", marketId, "not in Ponder next-phase1 list. Ensure indexer has indexed it.");
    process.exit(1);
  }
  console.log("   Found market in Ponder, submissions:", ourMarket.submissionCount);

  // 2. Process from contract (decrypt, merkle, shares)
  console.log("\n2. Fetching submissions from contract and processing...");
  const result = await workflow.processInfoReveal(marketId);
  console.log("   Consensus:", result.consensusOutcome === 1 ? "YES" : "NO");
  console.log("   Valid submissions:", result.validSubmissions.toString());
  console.log("   Merkle root:", result.merkleRoot);

  // 3. Print JSON for leaves/root
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
    leavesURI: "", // blank for this test
    leaves: leavesForJson,
  };

  const outputPath = resolve(process.cwd(), "scripts", "phase-1-test", "phase1-output.json");
  writeFileSync(outputPath, JSON.stringify(output, null, 2));
  console.log("\n3. Wrote phase1-output.json:", outputPath);

  // 4. Submit reveal onchain (revealInfoPhase with leavesURI)
  console.log("\n4. Submitting reveal onchain...");
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
      "", // leavesURI - blank for test
    ],
    account: (workflow as any).walletClient.account,
  });

  const revealHash = await (workflow as any).walletClient.writeContract(request);
  console.log("   Reveal tx:", revealHash);

  // 5. Claim for each address
  const publicClient = createPublicClient({
    chain: LOCALHOST_CHAIN as any,
    transport: http(rpcUrl),
  });

  const anvilKeys = [
    "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80",
    "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d",
    "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a",
    "0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6",
    "0x47e179ec197488593b187f80a00eb0da91f1b9d0b13f8733639f19c30a34926a",
    "0x8b3a350cf5c34c9194ca85829a2df0ec3153be0318b5e2d3348e872092edffba",
    "0x92db14e403b83dfe3df233f83dfa3a0d7096f21ca9b0d6d6b8d88b2b4ec1564e",
    "0x4bbbf85ce3377467afe5d46f804f221813b2bb87f24d81f60f1fcdbf7cbf4356",
    "0xdbda1821b80551c9d65939329250298aa3472ba22feea921c0cf5d620ea67b97",
    "0x2a871d0798f97d79848a013d4936a73bf4cc922c825d33c1cf7073dff6d409c6",
  ];

  console.log("\n5. Claiming shares for each participant...");
  for (let i = 0; i < result.leaves.length; i++) {
    const leaf = result.leaves[i];
    const proof = result.getProof(i);
    const key = anvilKeys[i] ?? anvilKeys[0];
    const account = privateKeyToAccount(key as `0x${string}`);

    if (account.address.toLowerCase() !== leaf.agent.toLowerCase()) {
      console.warn(`   Key ${i + 1} address ${account.address} != leaf agent ${leaf.agent}, skipping`);
      continue;
    }

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

  console.log("\n=== Phase 1 complete ===");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
