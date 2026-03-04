#!/usr/bin/env bun
/**
 * Trade + Phase 2 Simulator — after phase 1 claims:
 * 1. Place/take orders on OrderbookMarket (fuzzy trades per submarket)
 * 2. Fast-forward so trading deadline passes
 * 3. Resolve all submarkets via Gemini 2.5 Flash with Google Search grounding
 *    (structured-output JSON: [{submarketIndex, outcome}])
 * 4. Compute penalty factors per submarket from Phase 1 leaves
 * 5. Submit penalty factors on-chain per submarket (setPenaltyFactors)
 * 6. Resolve each submarket on-chain (resolveMarket)
 * 7. Winners claim payouts per submarket (claimPayout)
 *
 * Environment:
 *   MARKET_ADDRESS, ORDERBOOK_ADDRESS (or from deployed.json)
 *   RPC_URL, KEYSTORE, KEYSTORE_PASSWORD
 *   PHASE1_OUTPUT   path to phase1-output.json (default: scripts/phase-1-test/phase1-output.json)
 *   GEMINI_API_KEY  Google Gemini API key — REQUIRED (no fallback)
 *   GEMINI_MODEL    Model override (default: gemini-2.5-flash)
 *   MARKET_QUESTION The market question (also read from phase1-output.json)
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
// Gemini multi-submarket structured-output resolution
// ---------------------------------------------------------------------------

interface SubmarketResolution {
  submarketIndex: number;
  outcome: "YES" | "NO";
}

async function resolveWithGemini(
  marketQuestion: string,
  submarkets: Array<{ index: number; label: string }>,
  apiKey: string,
  model = "gemini-2.5-flash",
): Promise<SubmarketResolution[]> {
  model = process.env.GEMINI_MODEL ?? model;
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

  const systemInstruction =
    `You are a binary prediction market resolver. Your job is to determine the real-world outcome of market conditions using Google Search.\n` +
    `\n` +
    `STRICT OUTPUT RULES — you MUST follow these exactly:\n` +
    `1. Your entire response must be a single valid JSON array. Nothing else.\n` +
    `2. No markdown, no code fences, no explanation text before or after the array.\n` +
    `3. Each element must be: {"submarketIndex": <integer>, "outcome": "<YES or NO>"}\n` +
    `4. "outcome" must be exactly "YES" or "NO" in uppercase.\n` +
    `5. Every submarketIndex listed in the user message must appear in your response.\n` +
    `\n` +
    `Example of a valid response for 3 submarkets:\n` +
    `[{"submarketIndex":0,"outcome":"YES"},{"submarketIndex":1,"outcome":"NO"},{"submarketIndex":2,"outcome":"YES"}]`;

  const submarketLines = submarkets
    .map((s) => `Submarket-${s.index}: ${s.label}`)
    .join("\n");

  const userPrompt =
    `Market question: "${marketQuestion}"\n\n` +
    submarketLines +
    `\n\nUse Google Search to find the real-world outcome. ` +
    `Respond with ONLY the JSON array — no other text.`;

  console.log(`\n   ┌─ Gemini prompt (${model}) ─────────────────────────────────`);
  console.log(`   │ System: ${systemInstruction.split("\n")[0]}...`);
  console.log(`   │ User: ${userPrompt.replace(/\n/g, "\n   │ ")}`);
  console.log(`   └──────────────────────────────────────────────────────────\n`);

  // gemini-2.5-flash: googleSearch grounding does not support responseMimeType/responseJsonSchema.
  // We enforce JSON via the system prompt and parse it from the text response.
  const body = {
    systemInstruction: { parts: [{ text: systemInstruction }] },
    contents: [{ role: "user", parts: [{ text: userPrompt }] }],
    tools: [{ googleSearch: {} }],
    generationConfig: {
      temperature: 0,
      thinkingConfig: { thinkingBudget: 0 },
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

  const candidate = data.candidates?.[0];
  if (!candidate) {
    const block = data.promptFeedback?.blockReason;
    throw new Error(
      `Gemini returned no candidates${block ? ` (blocked: ${block})` : ""}. Full response: ${JSON.stringify(data).slice(0, 400)}`,
    );
  }

  const finishReason: string = candidate.finishReason ?? "UNKNOWN";
  if (finishReason === "SAFETY") {
    throw new Error(`Gemini blocked the response (SAFETY).`);
  }

  const parts: any[] = candidate.content?.parts ?? [];
  const textParts = parts
    .filter((p: any) => typeof p.text === "string" && !p.thought)
    .map((p: any) => p.text as string);

  if (textParts.length === 0) {
    throw new Error(
      `Gemini returned no text parts. finishReason=${finishReason}. Parts: ${JSON.stringify(parts).slice(0, 200)}`,
    );
  }

  const rawText = textParts.join("").trim();
  console.log(`   ┌─ Gemini raw reply ─────────────────────────────────────────`);
  console.log(`   │ ${rawText.slice(0, 600).replace(/\n/g, "\n   │ ")}`);
  if (rawText.length > 600) console.log(`   │ ... (${rawText.length} chars total)`);
  console.log(`   └──────────────────────────────────────────────────────────\n`);

  // Grounding metadata check
  const groundingMeta = candidate.groundingMetadata;
  const searchQueries: string[] = groundingMeta?.webSearchQueries ?? [];
  if (searchQueries.length > 0) {
    console.log(`   🔍 Google Search queries: ${searchQueries.map((q: string) => `"${q}"`).join(", ")}`);
  } else {
    console.warn(`   ⚠️  WARNING: Google Search may NOT have fired (no webSearchQueries in response).`);
  }

  // Extract JSON array — strip markdown fences or surrounding prose if present
  let jsonText = rawText;
  const fenceMatch = jsonText.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  if (fenceMatch) jsonText = fenceMatch[1].trim();
  const arrayMatch = jsonText.match(/\[\s*\{[\s\S]*?\}\s*\]/);
  if (arrayMatch) jsonText = arrayMatch[0];

  let results: SubmarketResolution[];
  try {
    results = JSON.parse(jsonText) as SubmarketResolution[];
  } catch (e) {
    throw new Error(`Failed to parse Gemini JSON response: ${jsonText.slice(0, 200)}`);
  }

  // Validate all required submarkets are present
  for (const sm of submarkets) {
    if (!results.find((r) => r.submarketIndex === sm.index)) {
      throw new Error(`Gemini response missing submarketIndex=${sm.index}`);
    }
  }

  return results;
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
    const wrongConfidence = winningOutcome === 1 ? 1000 - yesRatioBp : yesRatioBp;
    let penaltyFactorBps = 0;
    if (wrongConfidence > 550) {
      penaltyFactorBps = Math.round(((wrongConfidence - 550) / 450) * 10000);
    }
    return { agent: leaf.agent, yesRatioBp, wrongConfidence, penaltyFactorBps };
  });
}

function formatTable(penalties: PenaltyInfo[], winningOutcome: 1 | 2): string {
  const outcomeStr = winningOutcome === 1 ? "YES" : "NO";
  const lines: string[] = [
    `\n  Penalty Summary (resolved: ${outcomeStr})`,
    `  ${"Agent".padEnd(12)} ${"yes%".padStart(5)} ${"wrongConf".padStart(10)} ${"penaltyBps".padStart(11)}`,
    `  ${"-".repeat(45)}`,
  ];
  for (const p of penalties) {
    const penStr = p.penaltyFactorBps > 0 ? `${(p.penaltyFactorBps / 100).toFixed(2)}%` : "—";
    lines.push(
      `  ${p.agent.slice(0, 10)}... ${String(p.yesRatioBp).padStart(5)} ${String(p.wrongConfidence).padStart(10)} ${penStr.padStart(11)}`,
    );
  }
  return lines.join("\n");
}

// ---------------------------------------------------------------------------

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
    console.error("Set MARKET_ADDRESS and ORDERBOOK_ADDRESS or have deployed.json");
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
  const marketQuestion: string = process.env.MARKET_QUESTION ?? phase1.question ?? "";

  // Multi-submarket support: expect phase1.submarkets array
  // Falls back to single-submarket using top-level leaves for backward compat
  type SubmarketEntry = {
    index: number;
    submarketId: string; // bytes32 hex
    label: string;
    leaves: Array<{ agent: string; yesShares: string; noShares: string }>;
  };

  let submarketEntries: SubmarketEntry[];
  if (phase1.submarkets && Array.isArray(phase1.submarkets) && phase1.submarkets.length > 0) {
    submarketEntries = phase1.submarkets as SubmarketEntry[];
  } else {
    // Single submarket backward compat
    const singleId: string = phase1.submarketId ?? "";
    submarketEntries = [
      {
        index: 0,
        submarketId: singleId,
        label: phase1.optionLabel ?? "YES/NO",
        leaves: phase1.leaves ?? [],
      },
    ];
  }

  // Require Gemini API key — no fallback
  const geminiApiKey = process.env.GEMINI_API_KEY;
  if (!geminiApiKey) {
    console.error("[!] GEMINI_API_KEY is required for resolution. Set it in .env or environment.");
    process.exit(1);
  }
  if (!marketQuestion) {
    console.error("[!] MARKET_QUESTION or phase1.question is required for Gemini resolution.");
    process.exit(1);
  }

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

  const creAccount = privateKeyToAccount(privateKey as `0x${string}`);
  const creWallet = createWalletClient({
    chain: LOCALHOST_CHAIN as any,
    transport: http(rpcUrl),
    account: creAccount,
  });

  console.log("=== Trade + Phase 2 Simulator ===");
  console.log("Market:", contractAddress, "ID:", marketId.toString());
  console.log("Orderbook:", orderbookAddress);
  console.log("Question:", marketQuestion);
  console.log("Submarkets:", submarketEntries.map((s) => `[${s.index}] ${s.label}`).join(", "));
  console.log("");

  // ── 0. Resolve all submarkets via Gemini structured output ─────────────────
  const model = process.env.GEMINI_MODEL ?? "gemini-2.5-flash";
  console.log(`0. Resolving ${submarketEntries.length} submarket(s) via Gemini (${model}) with Google Search...`);

  const geminiResults = await resolveWithGemini(
    marketQuestion,
    submarketEntries.map((s) => ({ index: s.index, label: s.label })),
    geminiApiKey,
    model,
  );

  // Map index → outcome
  const outcomeByIndex = new Map<number, "YES" | "NO">();
  for (const r of geminiResults) {
    outcomeByIndex.set(r.submarketIndex, r.outcome);
    console.log(`   Submarket-${r.submarketIndex} (${submarketEntries.find((s) => s.index === r.submarketIndex)?.label ?? "?"}): ${r.outcome}`);
  }
  console.log("");

  // ── 1. Multi-round fuzzy trading per submarket ─────────────────────────────
  // 5 rounds × 4 trades = 20 trades per submarket, spread 20s apart → distinct 1m candles
  const TRADE_ROUNDS = 5;
  const ROUND_TIME_ADVANCE = 20; // evm seconds between rounds

  const rpcBody = (method: string, params: unknown[] = []) =>
    JSON.stringify({ jsonrpc: "2.0", id: 1, method, params });

  console.log(`1. Trading on orderbook (${TRADE_ROUNDS} rounds × 4 trades per submarket)...`);

  for (let round = 0; round < TRADE_ROUNDS; round++) {
    // Advance evm time to create distinct candle timestamps (skip before first round)
    if (round > 0) {
      await fetch(rpcUrl, { method: "POST", headers: { "Content-Type": "application/json" }, body: rpcBody("evm_increaseTime", [ROUND_TIME_ADVANCE]) });
      await fetch(rpcUrl, { method: "POST", headers: { "Content-Type": "application/json" }, body: rpcBody("evm_mine", []) });
    }

    // Prices drift slightly per round to create visible chart movement
    // Round 0→4: YES price drifts from 52% up to 64%, NO from 48% down to 36%
    const drift = BigInt(round * 3); // 0, 3, 6, 9, 12 % drift
    const tradeTemplates = [
      { makerIdx: 0, takerIdx: 1, sellYes: true,  amount: SHARE_PRECISION / 100n, price: ((52n + drift) * PRICE_PRECISION) / 100n },
      { makerIdx: 1, takerIdx: 2, sellYes: false, amount: SHARE_PRECISION / 100n, price: ((48n - drift) * PRICE_PRECISION) / 100n },
      { makerIdx: 2, takerIdx: 3, sellYes: true,  amount: SHARE_PRECISION / 100n, price: ((55n + drift) * PRICE_PRECISION) / 100n },
      { makerIdx: 3, takerIdx: 4, sellYes: false, amount: SHARE_PRECISION / 100n, price: ((50n - drift) * PRICE_PRECISION) / 100n },
    ];

    for (const smEntry of submarketEntries) {
      const submarketId = smEntry.submarketId as `0x${string}`;
      const agentsWithKeys = smEntry.leaves
        .map((l) => ({ ...l, key: keyByAddress.get(l.agent.toLowerCase()) }))
        .filter((a) => a.key) as Array<{ agent: string; yesShares: string; noShares: string; key: string }>;

      for (const t of tradeTemplates) {
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
            args: [submarketId, t.sellYes, t.amount, t.price],
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
            `   [sm${smEntry.index}][r${round}] ${maker.agent.slice(0, 8)}→${taker.agent.slice(0, 8)} ${hash.slice(0, 12)}...`,
          );
        } catch (e) {
          console.warn(
            `   [sm${smEntry.index}][r${round}] skip (${maker.agent.slice(0, 6)}→${taker.agent.slice(0, 6)}):`,
            (e as Error).message?.slice(0, 50),
          );
        }
      }
    }
    console.log(`   Round ${round + 1}/${TRADE_ROUNDS} done`);
  }

  // ── 2. Wait for trading deadline ───────────────────────────────────────────
  console.log("\n2. Waiting for trading deadline...");

  const configResult = await publicClient.readContract({
    address: contractAddress as `0x${string}`,
    abi: MINIMARKET_ABI,
    functionName: "configs",
    args: [marketId],
  }) as any;
  const createdAt = Number(configResult.createdAt ?? configResult[9]);
  const tradingDuration = Number(configResult.tradingDuration ?? configResult[10]);
  const tradingEnd = createdAt + tradingDuration;

  const nowReal = Math.floor(Date.now() / 1000);
  if (tradingEnd > nowReal) {
    const waitMs = (tradingEnd - nowReal + 1) * 1000;
    process.stdout.write(`   Trading window closes at ${new Date(tradingEnd * 1000).toLocaleTimeString()} — waiting ${tradingEnd - nowReal}s...`);
    await new Promise((r) => setTimeout(r, waitMs));
    process.stdout.write(" done\n");
  } else {
    console.log(`   Trading window already closed (${new Date(tradingEnd * 1000).toLocaleTimeString()})`);
  }

  await fetch(rpcUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: rpcBody("evm_setNextBlockTimestamp", [tradingEnd + 1]),
  });
  await fetch(rpcUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: rpcBody("evm_mine", []),
  });
  console.log(`   Block timestamp set to tradingEnd+1 (${new Date((tradingEnd + 1) * 1000).toLocaleTimeString()})`);

  // ── 3. Compute all penalty factors ─────────────────────────────────────────
  console.log("\n3. Computing penalty factors for all submarkets...");
  const penaltiesByIndex = new Map<number, PenaltyInfo[]>();
  for (const smEntry of submarketEntries) {
    const resolvedOutcome = outcomeByIndex.get(smEntry.index);
    if (!resolvedOutcome) continue;
    const winningOutcome: 1 | 2 = resolvedOutcome === "YES" ? 1 : 2;
    const penalties = computePenalties(smEntry.leaves, winningOutcome);
    penaltiesByIndex.set(smEntry.index, penalties);
    console.log(formatTable(penalties, winningOutcome));
    const penalizedAgents = penalties.filter((p) => p.penaltyFactorBps > 0);
    console.log(`   Submarket-${smEntry.index}: ${penalizedAgents.length}/${penalties.length} agents penalized`);
  }

  // ── 4. batchSetPenaltyFactors — one tx for all submarkets ──────────────────
  console.log("\n4. Submitting penalty factors (batchSetPenaltyFactors, 1 tx)...");
  const penaltySubmarketIds: `0x${string}`[] = [];
  const penaltyAgentsPerSm: `0x${string}`[][] = [];
  const penaltyFactorsPerSm: bigint[][] = [];

  for (const smEntry of submarketEntries) {
    const penalties = penaltiesByIndex.get(smEntry.index);
    if (!penalties) continue;
    penaltySubmarketIds.push(smEntry.submarketId as `0x${string}`);
    penaltyAgentsPerSm.push(penalties.map((p) => p.agent as `0x${string}`));
    penaltyFactorsPerSm.push(penalties.map((p) => BigInt(p.penaltyFactorBps)));
  }

  if (penaltySubmarketIds.length > 0) {
    try {
      const { request: batchPenaltyReq } = await publicClient.simulateContract({
        address: contractAddress as `0x${string}`,
        abi: MINIMARKET_ABI,
        functionName: "batchSetPenaltyFactors",
        args: [penaltySubmarketIds, penaltyAgentsPerSm, penaltyFactorsPerSm],
        account: creAccount,
      });
      const batchPenaltyHash = await creWallet.writeContract(batchPenaltyReq);
      console.log("   batchSetPenaltyFactors tx:", batchPenaltyHash);
    } catch (e) {
      console.error("   Failed to set penalty factors:", (e as Error).message?.slice(0, 120));
    }
  }

  // ── 5. batchResolveMarket — one tx for all submarkets ─────────────────────
  console.log("\n5. Resolving all submarkets on-chain (batchResolveMarket, 1 tx)...");
  const resolveSubmarketIds: `0x${string}`[] = [];
  const resolveOutcomes: number[] = [];

  for (const smEntry of submarketEntries) {
    const resolvedOutcome = outcomeByIndex.get(smEntry.index);
    if (!resolvedOutcome) {
      console.warn(`   Skipping submarket-${smEntry.index}: no Gemini outcome`);
      continue;
    }
    const winningOutcome: 1 | 2 = resolvedOutcome === "YES" ? 1 : 2;
    resolveSubmarketIds.push(smEntry.submarketId as `0x${string}`);
    resolveOutcomes.push(winningOutcome);
    console.log(`   [${smEntry.index}] ${smEntry.label} → ${resolvedOutcome}`);
  }

  if (resolveSubmarketIds.length > 0) {
    try {
      const { request: batchResolveReq } = await publicClient.simulateContract({
        address: contractAddress as `0x${string}`,
        abi: MINIMARKET_ABI,
        functionName: "batchResolveMarket",
        args: [resolveSubmarketIds, resolveOutcomes],
        account: creAccount,
      });
      const batchResolveHash = await creWallet.writeContract(batchResolveReq);
      console.log("   batchResolveMarket tx:", batchResolveHash);
    } catch (e) {
      console.error("   Failed to resolve submarkets:", (e as Error).message?.slice(0, 120));
    }
  }

  // ── 6. batchClaimPayout — one tx per agent, covering all their submarkets ──
  console.log("\n6. Claiming payouts (batchClaimPayout per agent, 1 tx each)...");

  // Gather all unique agents from all submarket leaves
  const allAgents = new Set<string>();
  for (const smEntry of submarketEntries) {
    for (const leaf of smEntry.leaves) {
      allAgents.add(leaf.agent.toLowerCase());
    }
  }

  // Build the full list of submarket IDs for batchClaimPayout
  const allSubmarketIds = submarketEntries.map((s) => s.submarketId as `0x${string}`);

  for (const agentAddr of allAgents) {
    const key = keyByAddress.get(agentAddr.toLowerCase());
    if (!key) continue;

    // Check if this agent has any winning shares
    let hasWinning = false;
    for (const smEntry of submarketEntries) {
      const resolvedOutcome = outcomeByIndex.get(smEntry.index);
      if (!resolvedOutcome) continue;
      const winningOutcome: 1 | 2 = resolvedOutcome === "YES" ? 1 : 2;
      const leaf = smEntry.leaves.find((l) => l.agent.toLowerCase() === agentAddr);
      if (!leaf) continue;
      const ws = winningOutcome === 1 ? BigInt(leaf.yesShares) : BigInt(leaf.noShares);
      if (ws > 0n) { hasWinning = true; break; }
    }
    if (!hasWinning) {
      console.log(`   Skip ${agentAddr.slice(0, 10)}... (no winning shares in any submarket)`);
      continue;
    }

    const account = privateKeyToAccount(key as `0x${string}`);
    const wallet = createWalletClient({
      chain: LOCALHOST_CHAIN as any,
      transport: http(rpcUrl),
      account,
    });

    try {
      const { request } = await publicClient.simulateContract({
        address: contractAddress as `0x${string}`,
        abi: MINIMARKET_ABI,
        functionName: "batchClaimPayout",
        args: [allSubmarketIds],
        account,
      });
      const hash = await wallet.writeContract(request);
      console.log(`   batchClaimPayout for ${agentAddr.slice(0, 10)}...: ${hash.slice(0, 16)}...`);
    } catch (e) {
      console.error(`   Failed batchClaimPayout for ${agentAddr}:`, (e as Error).message?.slice(0, 80));
    }
  }

  console.log("\n=== Trade + Phase 2 Simulator complete ===");
  console.log(`   Question  : "${marketQuestion}"`);
  console.log(`   Resolved  : ${submarketEntries.map((s) => `[${s.index}]=${outcomeByIndex.get(s.index) ?? "?"}`).join(", ")}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
