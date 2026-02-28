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
    `You are resolving binary prediction markets. You will receive a market question and a list of submarkets. ` +
    `For each submarket, respond YES if the condition is met, NO if not. ` +
    `Use Google Search to verify the real-world outcome. ` +
    `Respond ONLY in the JSON format specified — no text outside the JSON array. ` +
    `All outcomes must be "YES" or "NO" in uppercase.`;

  const submarketLines = submarkets
    .map((s) => `Submarket-${s.index}: ${s.label}`)
    .join("\n");

  const userPrompt =
    `Market question: "${marketQuestion}"\n\n` +
    submarketLines +
    `\n\nSearch for the actual outcome and resolve each submarket based on real-world data.`;

  console.log(`\n   ┌─ Gemini prompt (${model}) ─────────────────────────────────`);
  console.log(`   │ System: ${systemInstruction.slice(0, 120)}...`);
  console.log(`   │ User: ${userPrompt.replace(/\n/g, "\n   │ ")}`);
  console.log(`   └──────────────────────────────────────────────────────────\n`);

  const body = {
    systemInstruction: { parts: [{ text: systemInstruction }] },
    contents: [{ role: "user", parts: [{ text: userPrompt }] }],
    tools: [{ google_search: {} }],
    generationConfig: {
      responseMimeType: "application/json",
      responseSchema: {
        type: "ARRAY",
        items: {
          type: "OBJECT",
          properties: {
            submarketIndex: { type: "INTEGER" },
            outcome: { type: "STRING", enum: ["YES", "NO"] },
          },
          required: ["submarketIndex", "outcome"],
        },
      },
      temperature: 0,
      thinkingConfig: { thinkingBudget: 1024 },
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

  let results: SubmarketResolution[];
  try {
    results = JSON.parse(rawText) as SubmarketResolution[];
  } catch (e) {
    throw new Error(`Failed to parse Gemini JSON response: ${rawText.slice(0, 200)}`);
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

  // ── 1. Fuzzy trading per submarket ─────────────────────────────────────────
  console.log("1. Trading on orderbook (place + take orders per submarket)...");

  const tradeTemplates = [
    { makerIdx: 0, takerIdx: 1, sellYes: true,  amount: SHARE_PRECISION / 100n, price: (55n * PRICE_PRECISION) / 100n },
    { makerIdx: 1, takerIdx: 2, sellYes: false, amount: SHARE_PRECISION / 100n, price: (45n * PRICE_PRECISION) / 100n },
    { makerIdx: 2, takerIdx: 3, sellYes: true,  amount: SHARE_PRECISION / 100n, price: (5n * PRICE_PRECISION) / 10n },
    { makerIdx: 3, takerIdx: 4, sellYes: false, amount: SHARE_PRECISION / 100n, price: (52n * PRICE_PRECISION) / 100n },
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
          `   [sm${smEntry.index}] Trade: ${maker.agent.slice(0, 10)}... → ${taker.agent.slice(0, 10)}... ${hash}`,
        );
      } catch (e) {
        console.warn(
          `   [sm${smEntry.index}] Trade skipped (${maker.agent.slice(0, 8)}→${taker.agent.slice(0, 8)}):`,
          (e as Error).message?.slice(0, 60),
        );
      }
    }
  }

  // ── 2. Wait for trading deadline ───────────────────────────────────────────
  console.log("\n2. Waiting for trading deadline...");
  const rpcBody = (method: string, params: unknown[] = []) =>
    JSON.stringify({ jsonrpc: "2.0", id: 1, method, params });

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

  // ── 3–6. Per submarket: penalties → resolveMarket → claimPayouts ────────────
  for (const smEntry of submarketEntries) {
    const submarketId = smEntry.submarketId as `0x${string}`;
    const resolvedOutcome = outcomeByIndex.get(smEntry.index);
    if (!resolvedOutcome) {
      console.warn(`\n   Skipping submarket-${smEntry.index}: no Gemini outcome`);
      continue;
    }
    const winningOutcome: 1 | 2 = resolvedOutcome === "YES" ? 1 : 2;

    console.log(`\n── Submarket-${smEntry.index}: ${smEntry.label} → ${resolvedOutcome} ──────────────────`);

    // 3. Compute penalties
    console.log(`3. Computing penalty factors...`);
    const penalties = computePenalties(smEntry.leaves, winningOutcome);
    console.log(formatTable(penalties, winningOutcome));
    const penalizedAgents = penalties.filter((p) => p.penaltyFactorBps > 0);
    console.log(`\n   ${penalizedAgents.length}/${penalties.length} agents penalized`);

    // 4. Submit penalty factors
    console.log(`4. Submitting penalty factors (setPenaltyFactors)...`);
    const agentAddrs = penalties.map((p) => p.agent as `0x${string}`);
    const factorValues = penalties.map((p) => BigInt(p.penaltyFactorBps));

    try {
      const { request: penaltyReq } = await publicClient.simulateContract({
        address: contractAddress as `0x${string}`,
        abi: MINIMARKET_ABI,
        functionName: "setPenaltyFactors",
        args: [submarketId, agentAddrs, factorValues],
        account: creAccount,
      });
      const penaltyHash = await creWallet.writeContract(penaltyReq);
      console.log("   setPenaltyFactors tx:", penaltyHash);
    } catch (e) {
      console.error("   Failed to set penalty factors:", (e as Error).message?.slice(0, 120));
    }

    // 5. Resolve submarket on-chain
    console.log(`5. Resolving submarket on-chain (${resolvedOutcome})...`);
    try {
      const { request: resolveReq } = await publicClient.simulateContract({
        address: contractAddress as `0x${string}`,
        abi: MINIMARKET_ABI,
        functionName: "resolveMarket",
        args: [submarketId, winningOutcome],
        account: creAccount,
      });
      const resolveHash = await creWallet.writeContract(resolveReq);
      console.log("   resolveMarket tx:", resolveHash);
    } catch (e) {
      console.error("   Failed to resolve submarket:", (e as Error).message?.slice(0, 120));
      continue;
    }

    // 6. Winners claim payouts
    console.log(`6. Claiming payouts...`);
    for (const leaf of smEntry.leaves) {
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
      const penaltyInfo = penalties.find((p) => p.agent.toLowerCase() === leaf.agent.toLowerCase());
      const penaltyPct = penaltyInfo ? (penaltyInfo.penaltyFactorBps / 100).toFixed(2) : "0.00";
      try {
        const { request } = await publicClient.simulateContract({
          address: contractAddress as `0x${string}`,
          abi: MINIMARKET_ABI,
          functionName: "claimPayout",
          args: [submarketId],
          account,
        });
        const hash = await wallet.writeContract(request);
        console.log(`   Claimed for ${leaf.agent.slice(0, 10)}... (penalty: ${penaltyPct}%) tx: ${hash}`);
      } catch (e) {
        console.error(`   Failed to claim for ${leaf.agent}:`, (e as Error).message?.slice(0, 80));
      }
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
