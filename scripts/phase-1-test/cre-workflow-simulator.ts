#!/usr/bin/env bun
/**
 * CRE Workflow Simulator — simulates what the CRE workflow would do:
 * 1. Poll Ponder every 30s for markets ready to resolve (GET /workflows/next-phase1)
 * 2. When found: fetch all submissions in 1 contract call (getAllSubmissions)
 * 3. Decrypt, compute shares, build merkle trees (one per submarket)
 * 4. Upload leaves JSON to Pinata (1 upload)
 * 5. Post on-chain: batchRevealInfoPhase (1 tx for all submarkets)
 * 6. Participants claim via merkle proof (batchClaimShares per agent)
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
 *   PINATA_JWT_SECRET or PINATA_JWT — upload leaves JSON to Pinata, use URL as leavesURI
 */

import { readFileSync, existsSync, writeFileSync } from "fs";
import { PinataSDK } from "pinata";
import { resolve, join } from "path";
import {
  createPublicClient,
  createWalletClient,
  http,
  keccak256,
  encodeAbiParameters,
  parseAbiParameters,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { Wallet } from "ethers";
import { CREWorkflow } from "../../ts/src/cre/workflow";
import { MINIMARKET_ABI } from "../../ts/src/market/abi";

/** Compute bytes32 submarketId = keccak256(abi.encode(parentId, optionIndex)) */
function getSubmarketId(parentId: bigint, optionIndex: bigint): `0x${string}` {
  return keccak256(
    encodeAbiParameters(parseAbiParameters("uint256, uint256"), [parentId, optionIndex])
  );
}

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

async function pollNextPhase1(
  ponderUrl: string
): Promise<Array<{
  marketId: string;
  drandTargetRound: string;
  submissionCount: number;
  submissions: Array<{ agent: string; validationHash: string }>;
}> | null> {
  const round =
    process.env.BYPASS_DRAND_ROUND === "1"
      ? "999999999999"
      : currentDrandRound().toString();
  const res = await fetch(
    `${ponderUrl}/workflows/next-phase1?currentDrandRound=${round}&single=true`
  );
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
    const keystorePath =
      process.env.KEYSTORE ?? join(process.env.HOME ?? "~", ".foundry", "keystores", "chack");
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

  const publicClient = createPublicClient({
    chain: LOCALHOST_CHAIN as any,
    transport: http(rpcUrl),
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
      console.log(
        "   Found market(s) ready for Phase 1 reveal:",
        markets.map((m) => m.marketId).join(", ")
      );
      break;
    }
    console.log(
      `   [${new Date().toISOString()}] No markets yet, polling again in ${pollInterval / 1000}s...`
    );
    await new Promise((r) => setTimeout(r, pollInterval));
  }

  const market = markets![0];
  const marketId = BigInt(market.marketId);
  console.log("\n2. Processing market", marketId.toString(), "...");

  // 2. Read optionCount from contract
  const configs_pre = (await publicClient.readContract({
    address: contractAddress as `0x${string}`,
    abi: MINIMARKET_ABI,
    functionName: "configs",
    args: [marketId],
  })) as readonly any[];
  const optionCount = Number(configs_pre[12]) || 1;

  // 3. Read all submissions in ONE contract call (getAllSubmissions)
  // processInfoReveal internally calls getSubmissions which uses getSubmission loop.
  // We override by calling getAllSubmissions directly first to log, then let workflow use it.
  console.log(`\n3. Fetching all submissions (1 contract call)...`);
  const allSubmissionsRaw = (await publicClient.readContract({
    address: contractAddress as `0x${string}`,
    abi: MINIMARKET_ABI,
    functionName: "getAllSubmissions",
    args: [marketId],
  })) as Array<{ agent: string; ciphertext: `0x${string}`; validationHash: `0x${string}`; targetRound: bigint }>;
  console.log(`   ${allSubmissionsRaw.length} submission(s) found`);

  // 4. Decrypt and compute per-submarket results
  console.log(`\n4. Decrypting and computing shares for ${optionCount} submarket(s)...`);
  const perSubmarketResults = await workflow.processInfoReveal(marketId, optionCount);
  const result0 = perSubmarketResults[0];
  console.log("   Consensus (option 0):", result0.consensusOutcome === 1 ? "YES" : "NO");
  console.log("   Valid submissions:", result0.validSubmissions.toString());

  // 5. Build option labels from schema
  const optionLabels: string[] = [];
  const schemaEnv = process.env.SCHEMA_JSON;
  if (schemaEnv) {
    try {
      const schema = JSON.parse(schemaEnv);
      if (Array.isArray(schema.options)) {
        for (const opt of schema.options) {
          optionLabels[opt.index] = opt.label;
        }
      }
    } catch {
      /* ignore */
    }
  }
  for (let i = 0; i < optionCount; i++) {
    if (!optionLabels[i]) optionLabels[i] = optionCount === 1 ? "YES/NO" : `Option ${i}`;
  }
  console.log(
    `\n5. ${optionCount} submarket(s):`,
    optionLabels.slice(0, optionCount).map((l, i) => `[${i}] ${l}`).join(", ")
  );

  // 6. Upload leaves JSON to Pinata (one upload for the whole market)
  let leavesURI = "";
  const pinataJwt = process.env.PINATA_JWT_SECRET ?? process.env.PINATA_JWT;
  const outputPath = resolve(process.cwd(), "scripts", "phase-1-test", "phase1-output.json");

  const leavesForJson = result0.leaves.map((l) => ({
    agent: l.agent,
    yesShares: l.yesShares.toString(),
    noShares: l.noShares.toString(),
  }));

  if (pinataJwt) {
    console.log("\n6. Uploading leaves JSON to Pinata...");
    const pinata = new PinataSDK({ pinataJwt });
    const allSubLeavesForUpload = perSubmarketResults.map((r, i) => ({
      index: i,
      label: optionLabels[i],
      leaves: r.leaves.map((l) => ({ agent: l.agent, yesShares: l.yesShares.toString(), noShares: l.noShares.toString() })),
    }));
    const blob = new Blob(
      [JSON.stringify({ marketId: marketId.toString(), submarkets: allSubLeavesForUpload }, null, 2)],
      { type: "application/json" }
    );
    const file = new File([blob], `phase1-market-${marketId}-leaves.json`, {
      type: "application/json",
    });
    const upload = await pinata.upload.public.file(file);
    leavesURI = `https://gateway.pinata.cloud/ipfs/${upload.cid}`;
    console.log(`   Uploaded: ${leavesURI}`);
  } else {
    console.log("\n6. Skipping Pinata upload (set PINATA_JWT_SECRET or PINATA_JWT to upload)");
  }

  // 7. batchRevealInfoPhase — ONE transaction for all submarkets
  console.log(`\n7. Submitting batchRevealInfoPhase (1 tx for ${optionCount} submarket(s))...`);
  const n = BigInt(optionCount);
  const batchSubmarketIds: `0x${string}`[] = [];
  const batchMerkleRoots: `0x${string}`[] = [];
  const batchConsensusOutcomes: number[] = [];
  const batchReserveYes: bigint[] = [];
  const batchReserveNo: bigint[] = [];
  const batchValidSubmissions: bigint[] = [];
  const batchTotalYesShares: bigint[] = [];
  const batchTotalNoShares: bigint[] = [];

  const submarketOutputs: Array<{
    index: number;
    submarketId: string;
    label: string;
    leaves: typeof leavesForJson;
  }> = [];

  for (let optIdx = 0; optIdx < optionCount; optIdx++) {
    const smResult = perSubmarketResults[optIdx] ?? perSubmarketResults[0];
    const submarketId = getSubmarketId(marketId, BigInt(optIdx));
    const reserveYes = smResult.totalReserveYes / n;
    const reserveNo = smResult.totalReserveNo / n;

    batchSubmarketIds.push(submarketId);
    batchMerkleRoots.push(smResult.merkleRoot);
    batchConsensusOutcomes.push(smResult.consensusOutcome);
    batchReserveYes.push(reserveYes);
    batchReserveNo.push(reserveNo);
    batchValidSubmissions.push(smResult.validSubmissions);
    batchTotalYesShares.push(smResult.totalYesShares);
    batchTotalNoShares.push(smResult.totalNoShares);

    const smLeavesForJson = smResult.leaves.map((l) => ({
      agent: l.agent,
      yesShares: l.yesShares.toString(),
      noShares: l.noShares.toString(),
    }));
    submarketOutputs.push({ index: optIdx, submarketId, label: optionLabels[optIdx], leaves: smLeavesForJson });

    console.log(
      `   [${optIdx}] "${optionLabels[optIdx]}" → ${submarketId.slice(0, 18)}... consensus=${smResult.consensusOutcome === 1 ? "YES" : "NO"} reserveYes=${reserveYes} reserveNo=${reserveNo}`
    );
  }

  const { request: batchRevealReq } = await (workflow as any).publicClient.simulateContract({
    address: contractAddress as `0x${string}`,
    abi: MINIMARKET_ABI,
    functionName: "batchRevealInfoPhase",
    args: [
      batchSubmarketIds,
      batchMerkleRoots,
      batchConsensusOutcomes,
      batchReserveYes,
      batchReserveNo,
      batchValidSubmissions,
      batchTotalYesShares,
      batchTotalNoShares,
      leavesURI,
    ],
    account: (workflow as any).walletClient.account,
  });
  const batchRevealHash = await (workflow as any).walletClient.writeContract(batchRevealReq);
  console.log(`   batchRevealInfoPhase tx: ${batchRevealHash}`);

  // 8. batchClaimShares for each agent (one tx per agent, covers all submarkets)
  console.log(`\n8. Claiming shares (batchClaimShares per agent)...`);
  const keyByAddress = new Map<string, string>();
  for (const key of ANVIL_KEYS) {
    const acc = privateKeyToAccount(key as `0x${string}`);
    keyByAddress.set(acc.address.toLowerCase(), key);
  }

  // Gather participating agents (from leaves of submarket 0)
  const participatingAgents = perSubmarketResults[0].leaves.map((l) => l.agent);

  for (const agentAddr of participatingAgents) {
    const key = keyByAddress.get(agentAddr.toLowerCase());
    if (!key) {
      console.warn(`   No key for agent ${agentAddr}, skipping`);
      continue;
    }
    const account = privateKeyToAccount(key as `0x${string}`);
    const walletClient = createWalletClient({
      chain: LOCALHOST_CHAIN as any,
      transport: http(rpcUrl),
      account,
    });

    // Build proofs for all submarkets this agent participates in
    const claimSubmarketIds: `0x${string}`[] = [];
    const claimProofs: Array<{
      root: `0x${string}`;
      proof: `0x${string}`[];
      index: bigint;
      agent: `0x${string}`;
      yesShares: bigint;
      noShares: bigint;
    }> = [];

    for (let optIdx = 0; optIdx < optionCount; optIdx++) {
      const smResult = perSubmarketResults[optIdx] ?? perSubmarketResults[0];
      const leafIdx = smResult.leaves.findIndex(
        (l) => l.agent.toLowerCase() === agentAddr.toLowerCase()
      );
      if (leafIdx < 0) continue;
      const leaf = smResult.leaves[leafIdx];
      if (leaf.yesShares === 0n && leaf.noShares === 0n) continue;

      claimSubmarketIds.push(batchSubmarketIds[optIdx]);
      claimProofs.push({
        root: smResult.merkleRoot,
        proof: smResult.getProof(leafIdx),
        index: BigInt(leafIdx),
        agent: agentAddr as `0x${string}`,
        yesShares: leaf.yesShares,
        noShares: leaf.noShares,
      });
    }

    if (claimSubmarketIds.length === 0) continue;

    try {
      const { request } = await publicClient.simulateContract({
        address: contractAddress as `0x${string}`,
        abi: MINIMARKET_ABI,
        functionName: "batchClaimShares",
        args: [claimSubmarketIds, claimProofs],
        account,
      });
      const hash = await walletClient.writeContract(request);
      console.log(
        `   Claimed ${claimSubmarketIds.length} submarket(s) for ${agentAddr.slice(0, 10)}...: ${hash.slice(0, 16)}...`
      );
    } catch (e) {
      console.error(`   Failed batchClaimShares for ${agentAddr}:`, (e as Error).message?.slice(0, 100));
    }
  }

  // 9. Write phase1-output.json
  const output: Record<string, any> = {
    marketId: marketId.toString(),
    question: process.env.MARKET_QUESTION ?? "",
    merkleRoot: result0.merkleRoot,
    consensusOutcome: result0.consensusOutcome === 1 ? "YES" : "NO",
    totalYesShares: result0.totalYesShares.toString(),
    totalNoShares: result0.totalNoShares.toString(),
    leavesURI,
    leaves: leavesForJson,
    submarkets: submarketOutputs,
    submarketId: submarketOutputs[0]?.submarketId ?? "",
  };
  writeFileSync(outputPath, JSON.stringify(output, null, 2));
  console.log(`\n9. Wrote phase1-output.json (${optionCount} submarket(s)) → ${outputPath}`);

  // 10. Assert: after 30s refetch, resolved market must NOT appear in next-phase1
  console.log("\n10. Waiting 30s, then asserting market no longer in /workflows/next-phase1...");
  await new Promise((r) => setTimeout(r, 30_000));
  const round =
    process.env.BYPASS_DRAND_ROUND === "1" ? "999999999999" : currentDrandRound().toString();
  const refetchRes = await fetch(
    `${ponderUrl}/workflows/next-phase1?currentDrandRound=${round}`
  );
  if (!refetchRes.ok) {
    console.error("   Failed to refetch next-phase1:", refetchRes.status);
    process.exit(1);
  }
  const refetchData = await refetchRes.json();
  const refetchMarkets = Array.isArray(refetchData) ? refetchData : [];
  const stillInList = refetchMarkets.some(
    (m: { marketId: string }) => m.marketId === marketId.toString()
  );
  if (stillInList) {
    console.error(
      "   ASSERTION FAILED: Market",
      marketId,
      "still in next-phase1 after resolve. Refetch returned:",
      refetchMarkets.map((m: { marketId: string }) => m.marketId)
    );
    process.exit(1);
  }
  console.log("   OK: Market", marketId, "correctly removed from next-phase1 list");

  console.log("\n=== CRE Workflow Simulator complete ===");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
