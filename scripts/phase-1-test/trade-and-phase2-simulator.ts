#!/usr/bin/env bun
/**
 * Trade + Phase 2 Simulator — after phase 1 claims:
 * 1. Place/take orders on OrderbookMarket (fuzzy trades)
 * 2. Fast-forward so trading deadline passes
 * 3. Resolve market via Gemini 2.5 Flash with Google Search grounding
 *    (falls back to agent consensus if GEMINI_API_KEY / MARKET_QUESTION not set)
 * 4. Compute penalty factors from original Phase 1 leaves
 * 5. Submit penalty factors on-chain (CRE only — setPenaltyFactors)
 * 6. Resolve market on-chain (resolveMarket)
 * 7. Winners claim payouts (claimPayout — penalty applied automatically)
 *
 * Environment:
 *   MARKET_ADDRESS, ORDERBOOK_ADDRESS (or from deployed.json)
 *   RPC_URL, KEYSTORE, KEYSTORE_PASSWORD
 *   PHASE1_OUTPUT   path to phase1-output.json (default: scripts/phase-1-test/phase1-output.json)
 *   GEMINI_API_KEY  Google Gemini API key (auto-loaded from .env)
 *   GEMINI_MODEL    Model override (default: gemini-2.5-flash)
 *   MARKET_QUESTION The question being resolved
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

const SHARE_PRECISION = BigInt(1e6);
const PRICE_PRECISION = BigInt(1e18);

// ---------------------------------------------------------------------------
// Gemini resolution
// ---------------------------------------------------------------------------

async function resolveWithGemini(
  question: string,
  apiKey: string,
  model = "gemini-2.5-flash",
): Promise<{ outcome: "YES" | "NO"; reasoning: string }> {
  model = process.env.GEMINI_MODEL ?? model;
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

  const body = {
    contents: [
      {
        role: "user",
        parts: [
          {
            text: `You are resolving a binary prediction market. Use Google Search to find the most current, factual information, then answer YES or NO to this question:\n\n"${question}"\n\nStart your response with exactly YES or NO (all caps), then briefly explain your reasoning.`,
          },
        ],
      },
    ],
    tools: [{ google_search: {} }],
    generationConfig: {
      temperature: 0,
      maxOutputTokens: 200,
    },
  };

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Gemini API ${res.status}: ${errText.slice(0, 300)}`);
  }

  const data = (await res.json()) as any;
  const rawText: string =
    data.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
  const trimmed = rawText.trim();
  const upper = trimmed.toUpperCase();

  let outcome: "YES" | "NO";
  if (upper.startsWith("YES")) {
    outcome = "YES";
  } else if (upper.startsWith("NO")) {
    outcome = "NO";
  } else if (upper.includes("YES") && !upper.includes(" NO ") && !upper.startsWith("NO")) {
    outcome = "YES";
  } else if (upper.includes("NO") && !upper.includes(" YES ") && !upper.startsWith("YES")) {
    outcome = "NO";
  } else {
    throw new Error(
      `Ambiguous Gemini response — could not parse YES/NO from: "${trimmed.slice(0, 120)}"`,
    );
  }

  // Show grounding sources if available
  const chunks = data.candidates?.[0]?.groundingMetadata?.groundingChunks ?? [];
  const sources = chunks
    .slice(0, 3)
    .map((c: any) => c.web?.uri ?? c.retrievedContext?.uri ?? "")
    .filter(Boolean);

  return { outcome, reasoning: trimmed, sources } as any;
}

// ---------------------------------------------------------------------------
// Penalty computation
// ---------------------------------------------------------------------------

type PenaltyInfo = {
  agent: string;
  yesRatioBp: number;
  wrongConfidence: number;
  penaltyFactorBps: number;
};

function computePenalties(
  leaves: Array<{ agent: string; yesShares: string; noShares: string }>,
  winningOutcome: 1 | 2,
): PenaltyInfo[] {
  return leaves.map((leaf) => {
    const yes = BigInt(leaf.yesShares);
    const no = BigInt(leaf.noShares);
    const total = yes + no;
    const yesRatioBp = total > 0n ? Number((yes * 1000n) / total) : 500;
    const wrongConfidence =
      winningOutcome === 1 ? 1000 - yesRatioBp : yesRatioBp;
    let penaltyFactorBps = 0;
    if (wrongConfidence > 550) {
      penaltyFactorBps = Math.round(((wrongConfidence - 550) / 450) * 10000);
    }
    return { agent: leaf.agent, yesRatioBp, wrongConfidence, penaltyFactorBps };
  });
}

function formatTable(penalties: PenaltyInfo[], winningOutcome: 1 | 2): string {
  const outcomeStr = winningOutcome === 1 ? "YES" : "NO";
  const losingSide = winningOutcome === 1 ? "NO" : "YES";
  const lines: string[] = [
    `\n  Penalty Summary (resolved: ${outcomeStr}, losing side: ${losingSide})`,
    `  ${"Agent".padEnd(12)} ${"yes%".padStart(5)} ${"wrongConf".padStart(10)} ${"penaltyBps".padStart(11)} ${"penalized?".padStart(11)}`,
    `  ${"-".repeat(55)}`,
  ];
  for (const p of penalties) {
    const penalized =
      p.penaltyFactorBps > 0
        ? `YES (${(p.penaltyFactorBps / 100).toFixed(2)}%)`
        : "no";
    lines.push(
      `  ${p.agent.slice(0, 10)}... ${String(p.yesRatioBp).padStart(5)} ${String(p.wrongConfidence).padStart(10)} ${String(p.penaltyFactorBps).padStart(11)} ${penalized.padStart(11)}`,
    );
  }
  return lines.join("\n");
}

// ---------------------------------------------------------------------------

async function main() {
  const rpcUrl = process.env.RPC_URL ?? "http://127.0.0.1:8545";

  let contractAddress = process.env.MARKET_ADDRESS;
  let orderbookAddress = process.env.ORDERBOOK_ADDRESS;
  const deployedPath = resolve(
    process.cwd(),
    "scripts/phase-1-test/deployed.json",
  );
  if (existsSync(deployedPath)) {
    const deployed = JSON.parse(readFileSync(deployedPath, "utf-8"));
    const local = deployed.localhost ?? deployed;
    contractAddress = contractAddress ?? local.MiniMarket;
    orderbookAddress = orderbookAddress ?? local.OrderbookMarket;
  }
  if (!contractAddress || !orderbookAddress) {
    console.error(
      "Set MARKET_ADDRESS and ORDERBOOK_ADDRESS or have deployed.json",
    );
    process.exit(1);
  }

  const phase1Path =
    process.env.PHASE1_OUTPUT ??
    resolve(process.cwd(), "scripts/phase-1-test/phase1-output.json");
  if (!existsSync(phase1Path)) {
    console.error("Phase 1 output not found:", phase1Path);
    process.exit(1);
  }
  const phase1 = JSON.parse(readFileSync(phase1Path, "utf-8"));
  const marketId = BigInt(phase1.marketId);
  const agentConsensus: "YES" | "NO" = phase1.consensusOutcome; // agents' collective prediction

  let privateKey = process.env.PRIVATE_KEY;
  if (!privateKey?.startsWith("0x")) privateKey = "0x" + (privateKey ?? "");
  if (!privateKey || privateKey === "0x") {
    const keystorePath =
      process.env.KEYSTORE ??
      join(process.env.HOME ?? "~", ".foundry", "keystores", "chack");
    const password = process.env.KEYSTORE_PASSWORD;
    if (!password) {
      console.error("Set PRIVATE_KEY or KEYSTORE_PASSWORD");
      process.exit(1);
    }
    const wallet = await Wallet.fromEncryptedJson(
      readFileSync(keystorePath, "utf-8"),
      password,
    );
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
  console.log("Agent consensus:", agentConsensus);
  console.log("");

  // ── 0. Resolve outcome via Gemini ──────────────────────────────────────────
  const geminiApiKey = process.env.GEMINI_API_KEY;
  const marketQuestion = process.env.MARKET_QUESTION;

  // Parse schema JSON to get resolution config
  let schema: any = null;
  const schemaJsonStr = process.env.SCHEMA_JSON;
  if (schemaJsonStr) {
    try { schema = JSON.parse(schemaJsonStr); } catch {}
  }
  const resolutionPrompt: string = schema?.resolution?.prompt ?? marketQuestion ?? "";
  const resolutionModel: string = schema?.resolution?.model ?? "gemini-2.5-flash";

  let resolvedOutcome: "YES" | "NO" = agentConsensus; // fallback

  if (geminiApiKey && resolutionPrompt) {
    const modelDisplay = resolutionModel !== "gemini-2.5-flash" ? ` (${resolutionModel})` : "";
    console.log(`0. Resolving via Gemini${modelDisplay} (Google Search grounding)...`);
    console.log(`   Prompt: "${resolutionPrompt}"`);
    if (schema?.resolution?.prompt && marketQuestion && schema.resolution.prompt !== marketQuestion) {
      console.log(`   Original question: "${marketQuestion}"`);
    }
    try {
      const { outcome, reasoning, sources } = await resolveWithGemini(
        resolutionPrompt,
        geminiApiKey,
        resolutionModel,
      ) as any;
      resolvedOutcome = outcome;
      console.log(`   Gemini verdict : ${outcome}`);
      console.log(`   Reasoning      : ${reasoning.slice(0, 180)}${reasoning.length > 180 ? "..." : ""}`);
      if (sources?.length) {
        console.log(`   Sources        : ${sources.slice(0, 2).join(", ")}`);
      }
      if (outcome !== agentConsensus) {
        console.log(`   NOTE: Agents predicted ${agentConsensus} — Gemini says ${outcome}. Market resolves ${outcome}.`);
      } else {
        console.log(`   Agents and Gemini agree: ${outcome}`);
      }
    } catch (e) {
      console.warn(
        `   Gemini failed — using agent consensus (${agentConsensus}) as fallback:`,
        (e as Error).message,
      );
    }
  } else {
    if (!geminiApiKey)
      console.log(`[!] GEMINI_API_KEY not set — using agent consensus (${agentConsensus}) for resolution.`);
    if (!resolutionPrompt)
      console.log(`[!] No resolution prompt (set MARKET_QUESTION or SCHEMA_JSON) — using agent consensus.`);
    if (!marketQuestion)
      console.log(`[!] MARKET_QUESTION not set — using agent consensus for resolution.`);
  }

  const winningOutcome: 1 | 2 = resolvedOutcome === "YES" ? 1 : 2;
  console.log(`\n    Final resolution: ${resolvedOutcome} (${winningOutcome})`);

  // ── 1. Fuzzy trading ───────────────────────────────────────────────────────
  console.log("\n1. Trading on orderbook (place + take orders)...");
  const leaves = phase1.leaves as Array<{
    agent: string;
    yesShares: string;
    noShares: string;
  }>;
  const agentsWithKeys = leaves
    .map((l) => ({ ...l, key: keyByAddress.get(l.agent.toLowerCase()) }))
    .filter((a) => a.key) as Array<{
    agent: string;
    yesShares: string;
    noShares: string;
    key: string;
  }>;

  const trades = [
    {
      makerIdx: 0,
      takerIdx: 1,
      sellYes: true,
      amount: SHARE_PRECISION / 100n,
      price: (55n * PRICE_PRECISION) / 100n,
    },
    {
      makerIdx: 1,
      takerIdx: 2,
      sellYes: false,
      amount: SHARE_PRECISION / 100n,
      price: (45n * PRICE_PRECISION) / 100n,
    },
    {
      makerIdx: 2,
      takerIdx: 3,
      sellYes: true,
      amount: SHARE_PRECISION / 100n,
      price: (5n * PRICE_PRECISION) / 10n,
    },
    {
      makerIdx: 3,
      takerIdx: 4,
      sellYes: false,
      amount: SHARE_PRECISION / 100n,
      price: (52n * PRICE_PRECISION) / 100n,
    },
  ];

  for (const t of trades) {
    if (
      t.makerIdx >= agentsWithKeys.length ||
      t.takerIdx >= agentsWithKeys.length
    )
      continue;
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
      console.log(
        `   Trade: ${maker.agent.slice(0, 10)}... → ${taker.agent.slice(0, 10)}... ${hash}`,
      );
    } catch (e) {
      console.warn(
        `   Trade skipped (${maker.agent.slice(0, 8)}→${taker.agent.slice(0, 8)}):`,
        (e as Error).message?.slice(0, 60),
      );
    }
  }

  // ── 2. Fast-forward past trading deadline ──────────────────────────────────
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

  // ── 3. Compute penalty factors ─────────────────────────────────────────────
  console.log("\n3. Computing penalty factors from phase1 leaves...");
  const penalties = computePenalties(leaves, winningOutcome);
  console.log(formatTable(penalties, winningOutcome));
  const penalizedAgents = penalties.filter((p) => p.penaltyFactorBps > 0);
  console.log(`\n   ${penalizedAgents.length}/${penalties.length} agents penalized`);

  // ── 4. Submit penalty factors on-chain ─────────────────────────────────────
  console.log("\n4. Submitting penalty factors on-chain (setPenaltyFactors)...");
  const creAccount = privateKeyToAccount(privateKey as `0x${string}`);
  const creWallet = createWalletClient({
    chain: LOCALHOST_CHAIN as any,
    transport: http(rpcUrl),
    account: creAccount,
  });

  const agentAddrs = penalties.map((p) => p.agent as `0x${string}`);
  const factorValues = penalties.map((p) => BigInt(p.penaltyFactorBps));

  try {
    const { request: penaltyReq } = await publicClient.simulateContract({
      address: contractAddress as `0x${string}`,
      abi: MINIMARKET_ABI,
      functionName: "setPenaltyFactors",
      args: [marketId, agentAddrs, factorValues],
      account: creAccount,
    });
    const penaltyHash = await creWallet.writeContract(penaltyReq);
    console.log("   setPenaltyFactors tx:", penaltyHash);
  } catch (e) {
    console.error(
      "   Failed to set penalty factors:",
      (e as Error).message?.slice(0, 120),
    );
  }

  // ── 5. Resolve market on-chain ─────────────────────────────────────────────
  console.log(
    `\n5. Resolving market on-chain (outcome: ${resolvedOutcome})...`,
  );
  const { request: resolveReq } = await publicClient.simulateContract({
    address: contractAddress as `0x${string}`,
    abi: MINIMARKET_ABI,
    functionName: "resolveMarket",
    args: [marketId, winningOutcome],
    account: creAccount,
  });
  const resolveHash = await creWallet.writeContract(resolveReq);
  console.log("   Resolve tx:", resolveHash);

  // ── 6. Winners claim payouts ───────────────────────────────────────────────
  console.log("\n6. Claiming payouts (penalty applied by contract)...");
  for (const leaf of leaves) {
    const key = keyByAddress.get(leaf.agent.toLowerCase());
    if (!key) continue;
    const account = privateKeyToAccount(key as `0x${string}`);
    const winningShares =
      winningOutcome === 1
        ? BigInt(leaf.yesShares)
        : BigInt(leaf.noShares);
    if (winningShares === 0n) {
      console.log(`   Skip ${leaf.agent.slice(0, 10)}... (no winning shares)`);
      continue;
    }
    const wallet = createWalletClient({
      chain: LOCALHOST_CHAIN as any,
      transport: http(rpcUrl),
      account,
    });
    const penaltyInfo = penalties.find(
      (p) => p.agent.toLowerCase() === leaf.agent.toLowerCase(),
    );
    const penaltyPct = penaltyInfo
      ? (penaltyInfo.penaltyFactorBps / 100).toFixed(2)
      : "0.00";
    try {
      const { request } = await publicClient.simulateContract({
        address: contractAddress as `0x${string}`,
        abi: MINIMARKET_ABI,
        functionName: "claimPayout",
        args: [marketId],
        account,
      });
      const hash = await wallet.writeContract(request);
      console.log(
        `   Claimed for ${leaf.agent.slice(0, 10)}... (penalty: ${penaltyPct}%) tx: ${hash}`,
      );
    } catch (e) {
      console.error(
        `   Failed to claim for ${leaf.agent}:`,
        (e as Error).message?.slice(0, 80),
      );
    }
  }

  console.log("\n=== Trade + Phase 2 Simulator complete ===");
  console.log(`   Question  : "${marketQuestion ?? "(not set)"}"`);
  console.log(`   Agent consensus : ${agentConsensus}`);
  console.log(`   Gemini verdict  : ${resolvedOutcome}`);
  console.log(
    `   Penalized agents: ${penalizedAgents.length}/${penalties.length}`,
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
