#!/usr/bin/env bun
/**
 * Base Sepolia demo orchestrator.
 *
 * What this does:
 *   1. Prompts for market parameters (question, options, trading duration, ticket cost)
 *   2. Creates the market on-chain (deployer approves USDC → createMarket)
 *   3. Deploys fake agent contracts 0-4 via FakeAgentFactory (CREATE2, skips existing)
 *   4. Funds each agent with USDC (deployer approves factory → batchFundAgents)
 *   5. For each agent: encrypts vote with tlock, approves USDC via factory.execute,
 *      then calls market.submitEncrypted via factory.execute
 *   6. Writes indexer/.env.local and frontend/.env.local for Base Sepolia
 *   7. Prompts you to start Ponder (pnpm dev:base-sepolia in indexer/)
 *   8. Shows a live countdown until the drand round is available
 *   9. Prints the commands to run the CRE workflow next
 *
 * Environment (set by sepolia-demo.sh):
 *   MARKET_ADDRESS, ORDERBOOK_ADDRESS, FACTORY_ADDRESS,
 *   RPC_URL, KEYSTORE, KEYSTORE_PASSWORD, CHAIN_ID, USDC_ADDRESS, DEPLOY_BLOCK
 */

import {
  createPublicClient,
  createWalletClient,
  http,
  encodeFunctionData,
  parseEventLogs,
  maxUint256,
  type Address,
} from "viem";
import { baseSepolia } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";
import { Wallet } from "ethers";
import { readFileSync, writeFileSync } from "fs";
import { join, resolve } from "path";
import { createInterface } from "readline";
import {
  encryptPredictionBasisPoints,
  computeValidationHashBasisPoints,
  type PredictionPayloadBasisPoints,
} from "../../ts/src/drand/encryption";
import { DRAND_QUICKNET, currentRound, roundToTime, timeUntilRound } from "../../ts/src/drand/network";

// ─── Constants ────────────────────────────────────────────────────────────────

const BASIS_POINTS = 1000;
const DRAND_CHAIN_HASH =
  "0x52db9ba70e0cc0f6eaf7803dd07447a1f5477735fd3f661792ba94600c84e971" as `0x${string}`;

// Default vote ratios (yesPercent 0-1000); agent count = maxSlots (2 slots → 2 agents, 5 slots → 5 agents)
const DEFAULT_VOTES = [700, 200, 500, 900, 100];

// ─── Inline ABIs ──────────────────────────────────────────────────────────────

const ERC20_ABI = [
  {
    type: "function",
    name: "approve",
    inputs: [
      { name: "spender", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ type: "bool" }],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "balanceOf",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ type: "uint256" }],
    stateMutability: "view",
  },
] as const;

const FACTORY_ABI = [
  {
    type: "function",
    name: "deployer",
    inputs: [],
    outputs: [{ type: "address" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "getAgentAddress",
    inputs: [{ name: "index", type: "uint256" }],
    outputs: [{ type: "address" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "deployAgents",
    inputs: [{ name: "indices", type: "uint256[]" }],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "batchFundAgents",
    inputs: [
      { name: "indices", type: "uint256[]" },
      { name: "token", type: "address" },
      { name: "amountEach", type: "uint256" },
    ],
    outputs: [],
    stateMutability: "nonpayable",
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

const MARKET_ABI = [
  {
    type: "function",
    name: "USDC",
    inputs: [],
    outputs: [{ type: "address" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "createMarket",
    inputs: [
      { name: "question", type: "string" },
      { name: "schemaJson", type: "string" },
      { name: "maxSlots", type: "uint256" },
      { name: "ticketCost", type: "uint256" },
      { name: "creatorOffer", type: "uint256" },
      { name: "drandTargetRound", type: "uint64" },
      { name: "drandChainHash", type: "bytes32" },
      { name: "tradingDuration", type: "uint48" },
      { name: "optionCount", type: "uint256" },
    ],
    outputs: [{ name: "marketId", type: "uint256" }],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "submitEncrypted",
    inputs: [
      { name: "marketId", type: "uint256" },
      { name: "ciphertext", type: "bytes" },
      { name: "validationHash", type: "bytes32" },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "event",
    name: "MarketCreated",
    inputs: [
      { name: "marketId", type: "uint256", indexed: true },
      { name: "question", type: "string", indexed: false },
      { name: "schemaJson", type: "string", indexed: false },
      { name: "maxSlots", type: "uint256", indexed: false },
      { name: "ticketCost", type: "uint256", indexed: false },
      { name: "drandTargetRound", type: "uint64", indexed: false },
      { name: "creatorOffer", type: "uint256", indexed: false },
      { name: "optionCount", type: "uint256", indexed: false },
    ],
  },
] as const;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function prompt(q: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(q, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

async function waitForTx(
  publicClient: ReturnType<typeof createPublicClient>,
  hash: `0x${string}`,
  label: string
) {
  process.stdout.write(`   ${label} → ${hash.slice(0, 10)}...`);
  await publicClient.waitForTransactionReceipt({ hash });
  console.log(" ✅");
  // Give RPC time to update nonce before next tx (avoids "nonce too low" on public RPCs)
  await new Promise((r) => setTimeout(r, 2500));
}

/** Retry writeContract on nonce-too-low (public RPCs can lag) */
async function writeContractWithRetry(
  walletClient: ReturnType<typeof createWalletClient>,
  _publicClient: ReturnType<typeof createPublicClient>,
  request: Parameters<NonNullable<ReturnType<typeof createWalletClient>["writeContract"]>>[0]
): Promise<`0x${string}`> {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const hash = await walletClient.writeContract!(request);
      return hash;
    } catch (e: unknown) {
      const msg = String(e).toLowerCase();
      if (msg.includes("nonce") && (msg.includes("lower") || msg.includes("too low")) && attempt < 2) {
        process.stdout.write(`   (nonce lag, retry in 3s...) `);
        await new Promise((r) => setTimeout(r, 3000));
        continue;
      }
      throw e;
    }
  }
  throw new Error("writeContract failed after retries");
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const rootDir = resolve(import.meta.dir, "../../..");

  // ── Load env ───────────────────────────────────────────────────────────────
  const marketAddress = (process.env.MARKET_ADDRESS ?? "") as Address;
  const orderbookAddress = (process.env.ORDERBOOK_ADDRESS ?? "") as Address;
  const factoryAddress = (process.env.FACTORY_ADDRESS ?? "") as Address;
  const rpcUrl = process.env.RPC_URL ?? "https://sepolia.base.org";
  const usdcAddress = (process.env.USDC_ADDRESS ?? "0x036CbD53842c5426634e7929541eC2318f3dCF7e") as Address;
  const deployBlock = parseInt(process.env.DEPLOY_BLOCK ?? "0", 10);

  if (!marketAddress || !factoryAddress) {
    console.error("Missing MARKET_ADDRESS or FACTORY_ADDRESS");
    process.exit(1);
  }

  // ── Decrypt keystore ───────────────────────────────────────────────────────
  let privateKey: `0x${string}`;
  if (process.env.PRIVATE_KEY) {
    privateKey = process.env.PRIVATE_KEY as `0x${string}`;
  } else {
    const keystorePath =
      process.env.KEYSTORE ?? join(process.env.HOME ?? "~", ".foundry", "keystores", "chack");
    const password = process.env.KEYSTORE_PASSWORD;
    if (!password) {
      console.error("Set KEYSTORE_PASSWORD (or PRIVATE_KEY)");
      process.exit(1);
    }
    const keystoreJson = readFileSync(keystorePath, "utf-8");
    process.stdout.write("   Decrypting keystore... ");
    const wallet = await Wallet.fromEncryptedJson(keystoreJson, password);
    privateKey = wallet.privateKey as `0x${string}`;
    console.log("done");
  }

  const account = privateKeyToAccount(privateKey);

  const publicClient = createPublicClient({ chain: baseSepolia, transport: http(rpcUrl) });
  const walletClient = createWalletClient({ chain: baseSepolia, transport: http(rpcUrl), account });

  console.log(`   Deployer: ${account.address}`);

  // ── USDC balance check ─────────────────────────────────────────────────────
  const usdcBalance = await publicClient.readContract({
    address: usdcAddress,
    abi: ERC20_ABI,
    functionName: "balanceOf",
    args: [account.address],
  });
  console.log(`   USDC balance: ${Number(usdcBalance) / 1e6} USDC (${usdcBalance} raw)`);

  // ─── Prompt for market parameters ─────────────────────────────────────────
  console.log("");
  console.log("┌─ Market Parameters ─────────────────────────────────────┐");

  const labelInput = await prompt("│  Category [other]: ");
  const label = labelInput || "other";

  const optCountInput = await prompt("│  Number of options (1=binary, 2+=multi) [1]: ");
  const optionCount = Math.max(1, parseInt(optCountInput || "1", 10));

  const optionLabels: Array<{ index: number; label: string }> = [];
  if (optionCount > 1) {
    console.log("│  Option labels:");
    for (let i = 0; i < optionCount; i++) {
      const lbl = await prompt(`│    Option ${i}: `);
      optionLabels.push({ index: i, label: lbl || `Option ${i}` });
    }
  }

  const question = await prompt("│  Market question: ");
  if (!question) {
    console.error("Question is required");
    process.exit(1);
  }

  const tradingDurInput = await prompt("│  Trading duration in seconds [300]: ");
  const tradingDuration = parseInt(tradingDurInput || "300", 10);

  const phase1MinInput = await prompt("│  Phase 1 duration in minutes (until drand reveal) [5]: ");
  const phase1Minutes = Math.max(1, parseInt(phase1MinInput || "5", 10));

  const ticketCostInput = await prompt("│  Ticket cost in USDC raw units [1000 = 0.001 USDC]: ");
  const ticketCostRaw = (ticketCostInput || "1000").trim();
  // Accept decimal (e.g. 0.001) → treat as USDC, convert to raw (6 decimals)
  const ticketCost = ticketCostRaw.includes(".")
    ? BigInt(Math.round(parseFloat(ticketCostRaw) * 1e6))
    : BigInt(ticketCostRaw);

  const maxSlotsInput = await prompt("│  Max slots [5]: ");
  const maxSlots = BigInt(maxSlotsInput || "5");
  const agentCount = Number(maxSlots);
  const agentIndices = Array.from({ length: agentCount }, (_, i) => i);

  const creatorOfferInput = await prompt("│  Creator offer per submarket in raw USDC [0]: ");
  const creatorOffer = BigInt(creatorOfferInput || "0");

  // Agent vote ratios: yesPercent 0-1000 per agent (700 = 70% yes, 30% no); one per slot
  const defaultVotesStr = DEFAULT_VOTES.slice(0, agentCount).join(",");
  const votesInput = await prompt(
    `│  Agent vote ratios (comma-separated yesPercent 0-1000, e.g. 700,300) [${defaultVotesStr}]: `
  );
  const votes: number[] =
    votesInput && votesInput.trim()
      ? votesInput
          .split(",")
          .map((s) => parseInt(s.trim(), 10))
          .filter((n) => !Number.isNaN(n) && n >= 0 && n <= BASIS_POINTS)
      : DEFAULT_VOTES.slice(0, agentCount);
  // Pad or trim to match agent count
  while (votes.length < agentCount) votes.push(DEFAULT_VOTES[votes.length] ?? 500);
  const agentVotes = votes.slice(0, agentCount);

  console.log("└─────────────────────────────────────────────────────────┘");
  console.log("");

  // ── Compute drand target round from Phase 1 duration ───────────────────────
  // Drand quicknet: 3s per round → phase1Minutes * 60 / 3 = rounds
  // Add BUFFER_ROUNDS (20 ≈ 1 min) for create/deploy/fund/submit tx confirmations
  const BUFFER_ROUNDS = 20n;
  const roundsFromPhase1 = BigInt(Math.floor((phase1Minutes * 60) / DRAND_QUICKNET.period));
  const drandTargetRound = currentRound(DRAND_QUICKNET) + roundsFromPhase1 + BUFFER_ROUNDS;
  const roundAvailableAt = roundToTime(drandTargetRound, DRAND_QUICKNET);

  if (phase1Minutes < 3) {
    console.warn("   ⚠️  Phase 1 < 3 min may cause RoundAlreadyPassed — setup txs take ~1–2 min.");
  }
  console.log(`   Phase 1: ${phase1Minutes} min until drand reveal (+1 min buffer for txs)`);
  console.log(`   Drand target round: ${drandTargetRound}`);
  console.log(`   Round available at: ${roundAvailableAt.toLocaleString()}`);
  console.log("");

  // ── Build schema JSON ──────────────────────────────────────────────────────
  const deadline = Math.floor(Date.now() / 1000) + tradingDuration + 120;
  const optionsJson =
    optionLabels.length > 0
      ? optionLabels.map((o) => ({ index: o.index, label: o.label }))
      : [];
  const schemaJson = JSON.stringify({
    version: "1.0",
    label,
    description: question,
    deadline,
    options: optionsJson,
    resolution: {
      method: "ai",
      provider: "gemini",
      model: "gemini-2.5-flash",
      prompt: question,
      grounding: "google_search",
    },
  });

  // ── Effective option count for createMarket ────────────────────────────────
  const effectiveOptionCount = BigInt(Math.max(optionCount, 1));
  const marketCap = maxSlots * ticketCost; // creator deposit (contract stores this)
  const totalDeposit = marketCap + creatorOffer * effectiveOptionCount;

  console.log("   Market summary:");
  console.log(`     question:       ${question}`);
  console.log(`     maxSlots:       ${maxSlots}`);
  console.log(`     ticketCost:     ${ticketCost} raw (${Number(ticketCost) / 1e6} USDC)`);
  console.log(`     tradingDuration: ${tradingDuration}s`);
  console.log(`     optionCount:    ${effectiveOptionCount}`);
  console.log(`     totalDeposit:   ${totalDeposit} raw (${Number(totalDeposit) / 1e6} USDC)`);
  console.log(`     agent votes:    ${agentVotes.map((v) => `${v}bp`).join(", ")} (yesPercent per agent)`);
  console.log("");

  const fundPerAgent = ticketCost * effectiveOptionCount; // ticketCost per submarket
  if (usdcBalance < totalDeposit + fundPerAgent * BigInt(agentCount)) {
    console.warn(
      `⚠️  USDC balance (${usdcBalance}) may be insufficient for market (${totalDeposit}) + agents (${fundPerAgent * BigInt(agentCount)})`
    );
    const cont = await prompt("   Continue anyway? [y/N]: ");
    if (cont.toLowerCase() !== "y") process.exit(0);
  }

  // ─── STEP 1: Create market ────────────────────────────────────────────────
  console.log("═══ Creating market ═══");

  // Approve max — avoids exact-amount timing issues with public RPC nodes
  let hash = await writeContractWithRetry(walletClient, publicClient, {
    address: usdcAddress,
    abi: ERC20_ABI,
    functionName: "approve",
    args: [marketAddress, maxUint256],
  });
  await waitForTx(publicClient, hash, "USDC.approve(market, max)");

  // createMarket → get marketId from receipt logs
  hash = await writeContractWithRetry(walletClient, publicClient, {
    address: marketAddress,
    abi: MARKET_ABI,
    functionName: "createMarket",
    args: [
      question,
      schemaJson,
      maxSlots,
      ticketCost,
      creatorOffer,
      drandTargetRound,
      DRAND_CHAIN_HASH,
      BigInt(tradingDuration),
      effectiveOptionCount,
    ],
  });
  process.stdout.write(`   createMarket → ${hash.slice(0, 10)}...`);
  const createReceipt = await publicClient.waitForTransactionReceipt({ hash });
  console.log(" ✅");
  await new Promise((r) => setTimeout(r, 2500));

  const createdLogs = parseEventLogs({ abi: MARKET_ABI, logs: createReceipt.logs, eventName: "MarketCreated" });
  const marketId = createdLogs[0]?.args?.marketId ?? 0n;
  console.log(`   Market ID: ${marketId}`);
  console.log("");

  // ─── STEP 2: Deploy fake agents (only as many as maxSlots) ─────────────────
  console.log(`═══ Deploying ${agentCount} fake agents (maxSlots=${maxSlots}) ═══`);

  const agentAddresses: Address[] = [];
  for (const idx of agentIndices) {
    const addr = await publicClient.readContract({
      address: factoryAddress,
      abi: FACTORY_ABI,
      functionName: "getAgentAddress",
      args: [BigInt(idx)],
    });
    agentAddresses.push(addr as Address);
    console.log(`   Agent[${idx}]: ${addr}`);
  }

  hash = await writeContractWithRetry(walletClient, publicClient, {
    address: factoryAddress,
    abi: FACTORY_ABI,
    functionName: "deployAgents",
    args: [agentIndices.map(BigInt)],
  });
  await waitForTx(publicClient, hash, `factory.deployAgents([0..${agentCount - 1}])`);
  console.log("");

  // ─── STEP 3: Fund agents with USDC ───────────────────────────────────────
  console.log("═══ Funding agents with USDC ═══");

  // ticketCost per submarket: agents pay ticketCost × optionCount

  hash = await writeContractWithRetry(walletClient, publicClient, {
    address: usdcAddress,
    abi: ERC20_ABI,
    functionName: "approve",
    args: [factoryAddress, maxUint256],
  });
  await waitForTx(publicClient, hash, "USDC.approve(factory, max)");

  hash = await writeContractWithRetry(walletClient, publicClient, {
    address: factoryAddress,
    abi: FACTORY_ABI,
    functionName: "batchFundAgents",
    args: [agentIndices.map(BigInt), usdcAddress, fundPerAgent],
  });
  await waitForTx(publicClient, hash, `factory.batchFundAgents (${Number(fundPerAgent) / 1e6} USDC each)`);
  console.log("");

  // ─── STEP 4: Encrypt votes and submit ────────────────────────────────────
  console.log("═══ Casting encrypted votes ═══");
  console.log("   (1/3) Encrypting all predictions...");

  // Build per-option vote arrays (same vote across all options — enough for demo)
  const buildOptionPredictions = (
    baseYes: number,
    count: number
  ): Array<{ index: number; yesPercent: number; noPercent: number }> | undefined => {
    if (count <= 1) return undefined;
    return Array.from({ length: count }, (_, i) => ({
      index: i,
      yesPercent: baseYes,
      noPercent: BASIS_POINTS - baseYes,
    }));
  };

  const submitAbiFragment = {
    type: "function" as const,
    name: "submitEncrypted",
    inputs: [
      { name: "marketId", type: "uint256" },
      { name: "ciphertext", type: "bytes" },
      { name: "validationHash", type: "bytes32" },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  };

  const approveAbiFragment = {
    type: "function" as const,
    name: "approve",
    inputs: [
      { name: "spender", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ type: "bool" }],
    stateMutability: "nonpayable",
  };

  // Step 4a: Encrypt all votes locally first (sequential — tlock is async but local CPU)
  const allVoteData: Array<{
    agentIndex: number;
    agentAddr: Address;
    approveData: `0x${string}`;
    submitData: `0x${string}`;
  }> = [];

  for (let i = 0; i < agentIndices.length; i++) {
    const agentIndex = agentIndices[i];
    const agentAddr = agentAddresses[i];
    const yesPercent = agentVotes[i];
    const noPercent = BASIS_POINTS - yesPercent;

    process.stdout.write(
      `   agent[${agentIndex}] ${agentAddr.slice(0, 10)}... yes=${yesPercent}bp encrypting...`
    );

    const salt = "0x" + Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("hex");
    const optionPredictions = buildOptionPredictions(yesPercent, optionCount);
    const prediction: PredictionPayloadBasisPoints = {
      yesPercent,
      noPercent,
      agent: agentAddr,
      salt,
      ...(optionPredictions ? { options: optionPredictions } : {}),
    };

    const encrypted = await encryptPredictionBasisPoints(prediction, drandTargetRound, DRAND_QUICKNET);
    const ciphertext = ("0x" + Buffer.from(encrypted.ciphertext, "base64").toString("hex")) as `0x${string}`;
    const validationHash = computeValidationHashBasisPoints(prediction);
    console.log(" done");

    const approveData = encodeFunctionData({
      abi: [approveAbiFragment],
      functionName: "approve",
      args: [marketAddress, fundPerAgent],
    });
    const submitData = encodeFunctionData({
      abi: [submitAbiFragment],
      functionName: "submitEncrypted",
      args: [marketId, ciphertext, validationHash],
    });

    allVoteData.push({ agentIndex, agentAddr, approveData, submitData });
  }

  // Step 4b: Send all approve TXs (no waiting between — use explicit sequential nonces)
  console.log("");
  console.log("   (2/3) Sending all USDC approvals...");
  let nonce = await publicClient.getTransactionCount({ address: account.address, blockTag: "pending" });
  const approveHashes: `0x${string}`[] = [];
  for (const d of allVoteData) {
    const h = await walletClient.writeContract({
      address: factoryAddress,
      abi: FACTORY_ABI,
      functionName: "execute",
      args: [BigInt(d.agentIndex), usdcAddress, 0n, d.approveData],
      nonce: nonce++,
      gas: 150000n,
    });
    approveHashes.push(h);
    console.log(`   agent[${d.agentIndex}] approve → ${h.slice(0, 14)}...`);
  }
  // Wait for all approvals to confirm before proceeding
  process.stdout.write("   Waiting for approvals to land...");
  await Promise.all(approveHashes.map((h) => publicClient.waitForTransactionReceipt({ hash: h })));
  console.log(" ✅");

  // Step 4c: Send all submitEncrypted TXs (no waiting between — continue nonce sequence)
  console.log("   (3/3) Sending all encrypted vote submissions...");
  const submitHashes: `0x${string}`[] = [];
  for (const d of allVoteData) {
    let h: `0x${string}`;
    try {
      h = await walletClient.writeContract({
        address: factoryAddress,
        abi: FACTORY_ABI,
        functionName: "execute",
        args: [BigInt(d.agentIndex), marketAddress, 0n, d.submitData],
        nonce: nonce++,
        gas: 500000n,
      });
    } catch (e) {
      const msg = String((e as Error).message ?? e);
      console.error(`\n   agent[${d.agentIndex}] submit TX send FAILED: ${msg.slice(0, 300)}`);
      if (msg.includes("nonce") || msg.includes("RoundAlreadyPassed")) {
        console.error("   Try: increase Phase 1 duration (6+ min) or check USDC balance.");
      }
      throw e;
    }
    submitHashes.push(h);
    console.log(`   agent[${d.agentIndex}] submit  → ${h.slice(0, 14)}...`);
  }
  // Wait for all submissions
  process.stdout.write("   Waiting for submissions to land...");
  const submitReceipts = await Promise.all(
    submitHashes.map((h) => publicClient.waitForTransactionReceipt({ hash: h }).catch((e) => {
      console.warn(`\n   WARNING: receipt wait failed for ${h.slice(0, 14)}: ${e}`);
      return null;
    }))
  );
  const failed = submitReceipts.filter((r) => r === null || r.status === "reverted");
  if (failed.length > 0) {
    console.log(` ⚠️  (${failed.length} failed)`);
  } else {
    console.log(" ✅");
  }
  console.log("");
  console.log(`✅ All ${agentCount} votes cast for market ${marketId}`);
  console.log("");

  // ─── STEP 5: Update .env files ────────────────────────────────────────────
  console.log("═══ Updating .env.local files ═══");

  const startBlock = Math.max(deployBlock - 1, 0);

  const indexerEnv = [
    `NETWORK=base_sepolia`,
    `RPC_URL=${rpcUrl}`,
    `CONTRACT_ADDRESS=${marketAddress}`,
    `ORDERBOOK_ADDRESS=${orderbookAddress}`,
    `START_BLOCK=${startBlock}`,
  ].join("\n");
  writeFileSync(join(rootDir, "indexer/.env.local"), indexerEnv + "\n");
  console.log("   ✅ indexer/.env.local");

  const frontendEnv = [
    `NEXT_PUBLIC_CHAIN_ID=84532`,
    `NEXT_PUBLIC_MARKET_ADDRESS=${marketAddress}`,
    `NEXT_PUBLIC_ORDERBOOK_ADDRESS=${orderbookAddress}`,
    `NEXT_PUBLIC_FACTORY_ADDRESS=${factoryAddress}`,
    `NEXT_PUBLIC_USDC_ADDRESS=${usdcAddress}`,
    `NEXT_PUBLIC_PONDER_ENDPOINT=http://localhost:42069`,
  ].join("\n");
  writeFileSync(join(rootDir, "frontend/.env.local"), frontendEnv + "\n");
  console.log("   ✅ frontend/.env.local");
  console.log("");

  // ─── STEP 6: Ponder prompt ────────────────────────────────────────────────
  console.log("═══ Start Ponder indexer ═══");
  console.log("");
  console.log("   Open a new terminal and run:");
  console.log("");
  console.log(`     cd ${rootDir}/indexer`);
  console.log("     pnpm dev:base-sepolia");
  console.log("");
  console.log("   Wait until Ponder is indexing (API at http://localhost:42069).");
  console.log("");
  await prompt("   Press Enter when Ponder is running... ");
  console.log("");

  // ─── STEP 7: Countdown to drand round ────────────────────────────────────
  console.log("═══ Countdown to drand reveal ═══");
  console.log(`   Round ${drandTargetRound} available at: ${roundAvailableAt.toLocaleString()}`);
  console.log("");

  await new Promise<void>((resolve) => {
    const tick = () => {
      const secsLeft = timeUntilRound(drandTargetRound, DRAND_QUICKNET);
      if (secsLeft <= 0) {
        process.stdout.write(`\r   Round ${drandTargetRound} is ready!                           \n`);
        resolve();
        return;
      }
      const mins = Math.floor(secsLeft / 60);
      const secs = secsLeft % 60;
      process.stdout.write(
        `\r   Countdown: ${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}   (round ${drandTargetRound})`
      );
      setTimeout(tick, 1000);
    };
    tick();
  });

  // ─── STEP 8: Wait for production CRE workflow, then claim + trade ───────────
  console.log("");
  console.log("╔══════════════════════════════════════════════════════════════╗");
  console.log("║   Drand round ready — run your production CRE workflow      ║");
  console.log("╚══════════════════════════════════════════════════════════════╝");
  console.log("");
  console.log(`   Market ID: ${marketId}`);
  console.log(`   Market:    ${marketAddress}`);
  console.log("");
  await prompt("   Did you run the CRE workflow? Press Enter when done... ");
  console.log("");

  const { runPostWorkflowClaimAndTrade } = await import("./post-workflow-claim-and-trade");
  const { runSepoliaTradeSimulator } = await import("./sepolia-trade-simulator");
  console.log("═══ Claim + Trade (from contract leavesURI) ═══");
  const didClaim = await runPostWorkflowClaimAndTrade({
    marketAddress,
    orderbookAddress,
    factoryAddress,
    marketId,
    optionCount: Math.max(optionCount, 1),
    agentCount,
    agentAddresses,
    walletClient,
    publicClient,
  });
  console.log("");
  if (!didClaim) {
    console.log("   Skipping trading loop (no shares claimed — run CRE workflow first).");
  } else {
    console.log("═══ Trading loop (until phase 2 end) ═══");
    await runSepoliaTradeSimulator({
    marketAddress,
    orderbookAddress,
    factoryAddress,
    marketId,
    optionCount: Math.max(optionCount, 1),
    agentCount,
    walletClient,
    publicClient,
  });
  }
  console.log("═══ Demo complete ═══");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
