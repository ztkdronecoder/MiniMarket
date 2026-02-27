import { Hono } from "hono";
import { db } from "ponder:api";
import { eq } from "ponder";
import { market, submission, agent, agentMarket, swap, payout, priceHistory } from "ponder:schema";

const app = new Hono();

// Hono's c.json() uses JSON.stringify which can't handle BigInt. Use this helper instead.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const jsonBigInt = (c: any, data: unknown, status = 200) => {
  const body = JSON.stringify(data, (_, value) =>
    typeof value === 'bigint' ? value.toString() : value
  );
  return c.body(body, status, { 'Content-Type': 'application/json; charset=UTF-8' });
};

app.get("/markets", async (c) => {
  const limit = c.req.query("limit") ? parseInt(c.req.query("limit")!) : 10;
  const offset = c.req.query("offset") ? parseInt(c.req.query("offset")!) : 0;

  const markets = await db.select().from(market).orderBy(market.createdAt).limit(limit).offset(offset);

  return jsonBigInt(c, markets);
});

app.get("/markets/:id", async (c) => {
  const id = BigInt(c.req.param("id"));
  const m = await db.select().from(market).where(eq(market.id, id));

  if (!m[0]) {
    return c.text("Market not found", 404);
  }

  return jsonBigInt(c, m[0]);
});

app.get("/markets/:id/submissions", async (c) => {
  const marketId = BigInt(c.req.param("id"));

  const submissionsList = await db.select().from(submission).where(eq(submission.marketId, marketId));

  return jsonBigInt(c, submissionsList);
});

app.get("/agents/:id", async (c) => {
  const agentId = c.req.param("id");

  const agents = await db.select().from(agent).where(eq(agent.id, agentId));

  if (!agents[0]) {
    return c.text("Agent not found", 404);
  }

  return jsonBigInt(c, agents[0]);
});

app.get("/swaps", async (c) => {
  const limit = c.req.query("limit") ? parseInt(c.req.query("limit")!) : 50;
  const offset = c.req.query("offset") ? parseInt(c.req.query("offset")!) : 0;

  const swapsList = await db.select().from(swap).limit(limit).offset(offset);

  return jsonBigInt(c, swapsList);
});

app.get("/payouts", async (c) => {
  const limit = c.req.query("limit") ? parseInt(c.req.query("limit")!) : 50;
  const offset = c.req.query("offset") ? parseInt(c.req.query("offset")!) : 0;

  const payoutsList = await db.select().from(payout).limit(limit).offset(offset);

  return jsonBigInt(c, payoutsList);
});

/**
 * GET /workflows/next-phase1
 * Returns markets ready for Phase 1 (encrypted infomarket reveal).
 * Criteria: phase=0 (INFO_COLLECTION), merkleRoot=null, drand round reached (optional filter),
 * at least 1 submission.
 * Query params: currentDrandRound (optional) - if provided, only return markets where drandTargetRound <= currentDrandRound
 */
app.get("/workflows/next-phase1", async (c) => {
  const currentDrandRoundParam = c.req.query("currentDrandRound");
  const currentDrandRound = currentDrandRoundParam ? BigInt(currentDrandRoundParam) : null;

  const allMarkets = await db.select().from(market).orderBy(market.createdAt);
  const allSubmissions = await db.select().from(submission);

  const submissionCountByMarket = new Map<string, number>();
  const submissionsByMarket = new Map<string, typeof allSubmissions>();
  for (const sub of allSubmissions) {
    const key = sub.marketId.toString();
    submissionCountByMarket.set(key, (submissionCountByMarket.get(key) ?? 0) + 1);
    if (!submissionsByMarket.has(key)) {
      submissionsByMarket.set(key, []);
    }
    submissionsByMarket.get(key)!.push(sub);
  }

  const results: Array<{
    marketId: string;
    drandTargetRound: string;
    deadline: string;
    drandChainHash: string;
    submissionCount: number;
    submissions: Array<{ agent: string; validationHash: string }>;
  }> = [];

  for (const m of allMarkets) {
    if (m.phase !== 0) continue;
    const merkleRoot = m.merkleRoot;
    if (merkleRoot != null && merkleRoot !== "0x" && merkleRoot !== "0x0") continue;

    const count = submissionCountByMarket.get(m.id.toString()) ?? 0;
    if (count === 0) continue;

    if (currentDrandRound != null && BigInt(m.drandTargetRound) > currentDrandRound) continue;

    const subs = submissionsByMarket.get(m.id.toString()) ?? [];
    results.push({
      marketId: m.id.toString(),
      drandTargetRound: m.drandTargetRound.toString(),
      deadline: m.drandTargetRound.toString(),
      drandChainHash: m.drandChainHash ?? "0x0",
      submissionCount: count,
      submissions: subs.map((s) => ({
        agent: s.agent,
        validationHash: s.validationHash,
      })),
    });
  }

  // Sort by deadline ascending (lowest = most urgent, expired longest ago)
  results.sort((a, b) => {
    const da = BigInt(a.deadline);
    const db = BigInt(b.deadline);
    return da < db ? -1 : da > db ? 1 : 0;
  });

  const single = c.req.query("single") === "true";
  const out = single ? (results[0] ? [results[0]] : []) : results;
  return c.json(out);
});

/**
 * GET /workflows/next-phase2
 * Returns markets ready for Phase 2 (plaintext resolution).
 * Criteria: phase=1 (TRADING), resolvedOutcome=null, schemaURI set, trading ended (createdAt + tradingDuration <= now).
 */
app.get("/workflows/next-phase2", async (c) => {
  const now = Math.floor(Date.now() / 1000);

  const allMarkets = await db.select().from(market).orderBy(market.createdAt);

  const results: Array<{
    marketId: string;
    question: string;
    tradingEnd: number;
    deadline: number;
    createdAt: number;
    tradingDuration: number;
    schema: Record<string, unknown> | null;
  }> = [];

  for (const m of allMarkets) {
    if (m.phase !== 1) continue;
    if (m.resolvedOutcome != null && m.resolvedOutcome !== 0) continue;

    const schemaStr = m.schema ?? "";
    if (!schemaStr) continue;

    const createdAt = Number(m.createdAt);
    const tradingDuration = Number(m.tradingDuration ?? 0);
    const tradingEnd = createdAt + tradingDuration;
    if (now < tradingEnd) continue;

    let schema: Record<string, unknown> | null = null;
    try {
      schema = JSON.parse(schemaStr) as Record<string, unknown>;
    } catch {
      // Invalid JSON, leave schema null
    }

    results.push({
      marketId: m.id.toString(),
      question: m.question ?? "Resolve this market",
      tradingEnd,
      deadline: tradingEnd,
      createdAt,
      tradingDuration,
      schema,
    });
  }

  // Sort by deadline ascending (lowest = most urgent, expired longest ago)
  results.sort((a, b) => a.deadline - b.deadline);

  const single = c.req.query("single") === "true";
  const out = single ? (results[0] ? [results[0]] : []) : results;
  return c.json(out);
});

app.get("/agents", async (c) => {
  const limit = c.req.query("limit") ? parseInt(c.req.query("limit")!) : 50;
  const offset = c.req.query("offset") ? parseInt(c.req.query("offset")!) : 0;
  const orderByField = c.req.query("orderBy") || "totalWinnings";

  const agents = await db.select().from(agent).limit(limit).offset(offset);

  agents.sort((a, b) => {
    const aVal = BigInt(String((a as Record<string, unknown>)[orderByField] ?? 0));
    const bVal = BigInt(String((b as Record<string, unknown>)[orderByField] ?? 0));
    return bVal > aVal ? 1 : bVal < aVal ? -1 : 0;
  });

  return jsonBigInt(c, agents);
});

app.get("/agents/:id/markets", async (c) => {
  const agentId = c.req.param("id").toLowerCase() as `0x${string}`;
  const limit = c.req.query("limit") ? parseInt(c.req.query("limit")!) : 20;
  const offset = c.req.query("offset") ? parseInt(c.req.query("offset")!) : 0;

  const markets = await db
    .select()
    .from(agentMarket)
    .where(eq(agentMarket.agent, agentId))
    .limit(limit)
    .offset(offset);

  return jsonBigInt(c, markets);
});

app.get("/markets/:id/agents/:address", async (c) => {
  const marketId = BigInt(c.req.param("id"));
  const address = c.req.param("address").toLowerCase() as `0x${string}`;
  const agentMarketId = `${address}-${marketId}`;

  const rows = await db.select().from(agentMarket).where(eq(agentMarket.id, agentMarketId));

  if (!rows[0]) {
    return c.text("Not found", 404);
  }

  return jsonBigInt(c, rows[0]);
});

app.get("/markets/:id/price-history", async (c) => {
  const marketId = BigInt(c.req.param("id"));

  const history = await db
    .select()
    .from(priceHistory)
    .where(eq(priceHistory.marketId, marketId))
    .orderBy(priceHistory.timestamp)
    .limit(1000);

  return jsonBigInt(c, history);
});

export default app;
