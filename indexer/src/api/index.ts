import { Hono } from "hono";
import { db } from "ponder:api";
import { eq, inArray, and } from "ponder";
import { market, submarket, submission, agent, agentMarket, agentSubmarket, swap, payout, priceHistory, order } from "ponder:schema";

const app = new Hono();

// Hono's c.json() uses JSON.stringify which can't handle BigInt. Use this helper instead.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const jsonBigInt = (c: any, data: unknown, status = 200) => {
  const body = JSON.stringify(data, (_, value) =>
    typeof value === 'bigint' ? value.toString() : value
  );
  return c.body(body, status, { 'Content-Type': 'application/json; charset=UTF-8' });
};

// ── Markets ───────────────────────────────────────────────────────────────────

app.get("/markets", async (c) => {
  const limit = c.req.query("limit") ? parseInt(c.req.query("limit")!) : 10;
  const offset = c.req.query("offset") ? parseInt(c.req.query("offset")!) : 0;
  const labelFilter = c.req.query("label");

  const markets = labelFilter
    ? await db.select().from(market).where(eq(market.label, labelFilter)).orderBy(market.createdAt).limit(limit).offset(offset)
    : await db.select().from(market).orderBy(market.createdAt).limit(limit).offset(offset);

  return jsonBigInt(c, markets);
});

app.get("/markets/:id", async (c) => {
  const id = BigInt(c.req.param("id"));
  const m = await db.select().from(market).where(eq(market.id, id));
  if (!m[0]) return c.text("Market not found", 404);
  return jsonBigInt(c, m[0]);
});

app.get("/markets/:id/submissions", async (c) => {
  const marketId = BigInt(c.req.param("id"));
  const submissionsList = await db.select().from(submission).where(eq(submission.marketId, marketId));
  return jsonBigInt(c, submissionsList);
});

// ── Submarkets ────────────────────────────────────────────────────────────────

app.get("/markets/:id/submarkets", async (c) => {
  const parentMarketId = BigInt(c.req.param("id"));
  const submarkets = await db.select().from(submarket).where(eq(submarket.parentMarketId, parentMarketId));
  submarkets.sort((a, b) => a.optionIndex - b.optionIndex);
  return jsonBigInt(c, submarkets);
});

app.get("/submarkets/:id", async (c) => {
  const id = c.req.param("id") as `0x${string}`;
  const rows = await db.select().from(submarket).where(eq(submarket.id, id));
  if (!rows[0]) return c.text("Submarket not found", 404);
  return jsonBigInt(c, rows[0]);
});

app.get("/submarkets/:id/orders", async (c) => {
  const submarketId = c.req.param("id") as `0x${string}`;
  const statusFilter = c.req.query("status");
  const orders = await db
    .select()
    .from(order)
    .where(
      statusFilter
        ? and(eq(order.submarketId, submarketId), eq(order.status, statusFilter))
        : eq(order.submarketId, submarketId)
    )
    .orderBy(order.timestamp);
  return jsonBigInt(c, orders);
});

app.get("/submarkets/:id/price-history", async (c) => {
  const submarketId = c.req.param("id") as `0x${string}`;
  const history = await db
    .select()
    .from(priceHistory)
    .where(eq(priceHistory.submarketId, submarketId))
    .orderBy(priceHistory.timestamp)
    .limit(1000);
  return jsonBigInt(c, history);
});

// Legacy parent-market order/price routes — delegates to first submarket
app.get("/markets/:id/orders", async (c) => {
  const parentMarketId = BigInt(c.req.param("id"));
  const statusFilter = c.req.query("status");
  const orders = await db
    .select()
    .from(order)
    .where(
      statusFilter
        ? and(eq(order.parentMarketId, parentMarketId), eq(order.status, statusFilter))
        : eq(order.parentMarketId, parentMarketId)
    )
    .orderBy(order.timestamp);
  return jsonBigInt(c, orders);
});

app.get("/markets/:id/price-history", async (c) => {
  const parentMarketId = BigInt(c.req.param("id"));
  const history = await db
    .select()
    .from(priceHistory)
    .where(eq(priceHistory.parentMarketId, parentMarketId))
    .orderBy(priceHistory.timestamp)
    .limit(1000);
  return jsonBigInt(c, history);
});

// ── Agents ────────────────────────────────────────────────────────────────────

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

app.get("/agents/:id", async (c) => {
  const agentId = c.req.param("id");
  const agents = await db.select().from(agent).where(eq(agent.id, agentId));
  if (!agents[0]) return c.text("Agent not found", 404);
  return jsonBigInt(c, agents[0]);
});

app.get("/agents/:id/markets", async (c) => {
  const agentId = c.req.param("id").toLowerCase() as `0x${string}`;
  const limit = c.req.query("limit") ? parseInt(c.req.query("limit")!) : 20;
  const offset = c.req.query("offset") ? parseInt(c.req.query("offset")!) : 0;

  const agentMarkets = await db
    .select()
    .from(agentMarket)
    .where(eq(agentMarket.agent, agentId))
    .limit(limit)
    .offset(offset);

  if (agentMarkets.length === 0) return jsonBigInt(c, []);

  const marketIds = [...new Set(agentMarkets.map((am) => am.marketId))];
  const marketRows = await db.select().from(market).where(inArray(market.id, marketIds));
  const marketMap = new Map(marketRows.map((m) => [m.id.toString(), m]));

  const result = agentMarkets.map((am) => {
    const mkt = marketMap.get(am.marketId.toString());
    return {
      ...am,
      marketQuestion: mkt?.question ?? null,
      ticketCost: mkt?.ticketCost ?? null,
      marketLabel: mkt?.label ?? null,
    };
  });
  return jsonBigInt(c, result);
});

app.get("/markets/:id/agents/:address", async (c) => {
  const marketId = BigInt(c.req.param("id"));
  const address = c.req.param("address").toLowerCase() as `0x${string}`;
  const rows = await db.select().from(agentMarket).where(eq(agentMarket.id, `${address}-${marketId}`));
  if (!rows[0]) return c.text("Not found", 404);
  return jsonBigInt(c, rows[0]);
});

// ── Swaps / Payouts ───────────────────────────────────────────────────────────

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

// ── Workflow endpoints ────────────────────────────────────────────────────────

/**
 * GET /workflows/next-phase1
 * Returns parent markets ready for Phase 1 (encrypted infomarket reveal).
 *
 * A parent market is ready when:
 *   - It has at least one submarket still in phase 0 (INFO_COLLECTION / unrevealed)
 *   - drandTargetRound <= currentDrandRound (if supplied)
 *   - At least 1 encrypted submission exists
 */
app.get("/workflows/next-phase1", async (c) => {
  const currentDrandRoundParam = c.req.query("currentDrandRound");
  const currentDrandRound = currentDrandRoundParam ? BigInt(currentDrandRoundParam) : null;

  // All parent markets
  const allMarkets = await db.select().from(market).orderBy(market.createdAt);
  // All submissions grouped by parentMarketId
  const allSubmissions = await db.select().from(submission);
  const submissionCountByMarket = new Map<string, number>();
  const submissionsByMarket = new Map<string, typeof allSubmissions>();
  for (const sub of allSubmissions) {
    const key = sub.marketId.toString();
    submissionCountByMarket.set(key, (submissionCountByMarket.get(key) ?? 0) + 1);
    if (!submissionsByMarket.has(key)) submissionsByMarket.set(key, []);
    submissionsByMarket.get(key)!.push(sub);
  }
  // All submarkets grouped by parentMarketId — to check if any are still in phase 0
  const allSubmarkets = await db.select().from(submarket);
  const unresolvedSubmarketsByParent = new Map<string, boolean>();
  for (const sm of allSubmarkets) {
    const key = sm.parentMarketId.toString();
    if (sm.phase === 0) unresolvedSubmarketsByParent.set(key, true);
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
    const key = m.id.toString();
    // Must have at least one unrevealed submarket
    if (!unresolvedSubmarketsByParent.get(key)) continue;
    // Must have submissions
    const count = submissionCountByMarket.get(key) ?? 0;
    if (count === 0) continue;
    // drand round must have passed
    if (currentDrandRound != null && BigInt(m.drandTargetRound) > currentDrandRound) continue;

    const subs = submissionsByMarket.get(key) ?? [];
    results.push({
      marketId: key,
      drandTargetRound: m.drandTargetRound.toString(),
      deadline: m.drandTargetRound.toString(),
      drandChainHash: m.drandChainHash ?? "0x0",
      submissionCount: count,
      submissions: subs.map((s) => ({ agent: s.agent, validationHash: s.validationHash })),
    });
  }

  results.sort((a, b) => {
    const da = BigInt(a.deadline);
    const db_ = BigInt(b.deadline);
    return da < db_ ? -1 : da > db_ ? 1 : 0;
  });

  const single = c.req.query("single") === "true";
  const out = single ? (results[0] ? [results[0]] : []) : results;
  return c.json(out);
});

/**
 * GET /workflows/next-phase2
 * Returns submarkets ready for Phase 2 resolution (Gemini resolves the real-world outcome).
 *
 * A submarket is ready when:
 *   - phase = 1 (TRADING, after shares claimed)
 *   - resolvedOutcome is null
 *   - parent market's trading window has closed (createdAt + tradingDuration <= now)
 */
app.get("/workflows/next-phase2", async (c) => {
  const now = Math.floor(Date.now() / 1000);

  const allSubmarkets = await db.select().from(submarket);
  const allMarkets = await db.select().from(market);
  const marketMap = new Map(allMarkets.map((m) => [m.id.toString(), m]));

  const results: Array<{
    submarketId: string;
    parentMarketId: string;
    optionIndex: number;
    optionLabel: string | null;
    question: string;
    tradingEnd: number;
    deadline: number;
    schema: Record<string, unknown> | null;
  }> = [];

  for (const sm of allSubmarkets) {
    if (sm.phase !== 1) continue;
    if (sm.resolvedOutcome != null) continue;

    const m = marketMap.get(sm.parentMarketId.toString());
    if (!m) continue;

    const createdAt = Number(m.createdAt);
    const tradingDuration = Number(m.tradingDuration ?? 0);
    const tradingEnd = createdAt + tradingDuration;
    if (now < tradingEnd) continue;

    let schema: Record<string, unknown> | null = null;
    try { schema = JSON.parse(m.schema ?? ""); } catch { /* invalid JSON */ }

    results.push({
      submarketId: sm.id,
      parentMarketId: sm.parentMarketId.toString(),
      optionIndex: sm.optionIndex,
      optionLabel: sm.optionLabel ?? null,
      question: m.question ?? "",
      tradingEnd,
      deadline: tradingEnd,
      schema,
    });
  }

  results.sort((a, b) => a.deadline - b.deadline);
  const single = c.req.query("single") === "true";
  const out = single ? (results[0] ? [results[0]] : []) : results;
  return c.json(out);
});

export default app;
