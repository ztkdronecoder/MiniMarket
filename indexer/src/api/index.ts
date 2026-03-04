import { Hono } from "hono";
import { db } from "ponder:api";
import { eq, inArray, and } from "ponder";
import { market, submarket, submission, agent, agentMarket, agentSubmarket, agentLabelReputation, marketParticipant, swap, payout, priceHistory, order } from "ponder:schema";

// Normalize a hex value — PGLite may return Buffer/Uint8Array for t.hex() columns
const normHex = (v: unknown): string => {
  if (v == null) return "";
  let hex = "";
  if (typeof v === "string") hex = v.trim();
  else if (Buffer.isBuffer(v)) hex = "0x" + v.toString("hex");
  else if (v instanceof Uint8Array) hex = "0x" + Buffer.from(v).toString("hex");
  else hex = String(v).trim();
  if (!hex) return "";
  return (hex.startsWith("0x") ? hex : "0x" + hex).toLowerCase();
};

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
  const labelFilter = c.req.query("label");

  let agents;
  if (labelFilter) {
    const labelReps = await db.select().from(agentLabelReputation).where(eq(agentLabelReputation.label, labelFilter));
    const agentIds = [...new Set(labelReps.map((r) => r.agent))];
    if (agentIds.length === 0) return jsonBigInt(c, []);
    agents = await db.select().from(agent).where(inArray(agent.id, agentIds));
  } else {
    agents = await db.select().from(agent).limit(Math.min(500, limit + offset + 100));
  }
  agents.sort((a, b) => {
    const aVal = BigInt(String((a as Record<string, unknown>)[orderByField] ?? 0));
    const bVal = BigInt(String((b as Record<string, unknown>)[orderByField] ?? 0));
    return bVal > aVal ? 1 : bVal < aVal ? -1 : 0;
  });
  const paginated = agents.slice(offset, offset + limit);

  // Augment paginated agents with confidence computed from agentSubmarket data.
  // This handles losers who never received a PayoutClaimed event (their totalConfidenceScore stays 0).
  const allAgentSubmarkets = await db.select().from(agentSubmarket);
  const paginatedIds = new Set(paginated.map((a) => normHex(a.id)));
  const relevantAsm = allAgentSubmarkets.filter((asm) => paginatedIds.has(normHex(asm.agent)));

  let augmented: typeof paginated = paginated;
  if (relevantAsm.length > 0) {
    const smIds = [...new Set(relevantAsm.map((r) => normHex(r.submarketId)).filter(Boolean))];
    const smRows = smIds.length > 0
      ? await db.select().from(submarket).where(inArray(submarket.id, smIds as `0x${string}`[]))
      : [];
    const smMap = new Map(smRows.map((s) => [normHex(s.id), s]));

    // Compute per-agent confidence and effective total winnings (includes expectedPayout for unclaimed)
    const agentConfMap = new Map<string, { total: bigint; count: number }>();
    const agentEffectiveWinningsMap = new Map<string, bigint>();
    for (const asm of relevantAsm) {
      const sid = normHex(asm.submarketId);
      const sm = smMap.get(sid);
      if (!sm || sm.resolvedOutcome == null) continue;

      let conf: bigint;
      const storedConf = asm.confidenceScore ?? 0n;
      if (storedConf > 0n) {
        conf = storedConf;
      } else {
        const yesShares = asm.yesShares ?? 0n;
        const noShares = asm.noShares ?? 0n;
        const totalShares = yesShares + noShares;
        if (totalShares === 0n) continue;
        const majorityShares = yesShares >= noShares ? yesShares : noShares;
        conf = (majorityShares * 10000n) / totalShares;
      }

      const aid = normHex(asm.agent);
      const cur = agentConfMap.get(aid) ?? { total: 0n, count: 0 };
      agentConfMap.set(aid, { total: cur.total + conf, count: cur.count + 1 });

      // Effective payout: actual if claimed (post-penalty), else expectedPayout - expectedPenalty
      const totalPayout = asm.totalPayout ?? 0n;
      const expectedPayout = asm.expectedPayout ?? 0n;
      const expectedPenalty = asm.expectedPenalty ?? 0n;
      const payout = totalPayout > 0n ? totalPayout : (expectedPayout > expectedPenalty ? expectedPayout - expectedPenalty : 0n);
      agentEffectiveWinningsMap.set(aid, (agentEffectiveWinningsMap.get(aid) ?? 0n) + payout);
    }

    // Override totalConfidenceScore, totalResolvedMarkets, totalWinnings when we have richer data
    augmented = paginated.map((a) => {
      const aid = normHex(a.id);
      const conf = agentConfMap.get(aid);
      const effectiveWinnings = agentEffectiveWinningsMap.get(aid) ?? 0n;
      let out = a;
      if (conf && conf.count > 0) {
        const storedResolved = Number(a.totalResolvedMarkets ?? 0);
        if (conf.count > storedResolved) {
          out = { ...out, totalConfidenceScore: conf.total, totalResolvedMarkets: BigInt(conf.count) };
        }
      }
      // Use effective winnings (includes expected for unclaimed) when it exceeds stored
      if (effectiveWinnings > BigInt(String(out.totalWinnings ?? 0))) {
        out = { ...out, totalWinnings: effectiveWinnings };
      }
      return out;
    });
  }

  return jsonBigInt(c, augmented);
});

app.get("/creators", async (c) => {
  const labelFilter = c.req.query("label");
  const limit = c.req.query("limit") ? parseInt(c.req.query("limit")!) : 20;
  const offset = c.req.query("offset") ? parseInt(c.req.query("offset")!) : 0;

  const markets = await db.select().from(market);
  const submarkets = await db.select().from(submarket);

  const subByParent = new Map<string, typeof submarkets>();
  for (const sm of submarkets) {
    const key = sm.parentMarketId.toString();
    if (!subByParent.has(key)) subByParent.set(key, []);
    subByParent.get(key)!.push(sm);
  }

  const creatorStats = new Map<string, {
    creator: string;
    totalMarkets: number;
    totalPnL: bigint;
    totalPremium: bigint;
    labels: Record<string, { markets: number; pnl: bigint }>;
  }>();

  // Normalize hex (PGLite may return Buffer/Uint8Array or string)
  const toCreatorHex = (v: unknown): string => {
    if (v == null) return "";
    let hex = "";
    if (typeof v === "string") hex = v.trim();
    else if (Buffer.isBuffer(v)) hex = v.toString("hex");
    else if (v instanceof Uint8Array) hex = Buffer.from(v).toString("hex");
    else hex = String(v).trim();
    if (!hex) return "";
    return (hex.startsWith("0x") ? hex : "0x" + hex).toLowerCase();
  };

  for (const m of markets) {
    // creator can be null if indexed before field existed - include with placeholder so we show markets
    const rawCreator = toCreatorHex(m.creator);
    const creatorAddr = rawCreator || "0x0000000000000000000000000000000000000000";
    const key = creatorAddr.toLowerCase();
    if (labelFilter && m.label !== labelFilter) continue;

    const subs = subByParent.get(m.id.toString()) ?? [];
    const penaltyCollected = subs.reduce((sum, s) => sum + (s.totalPenaltyCollected ?? 0n), 0n);
    const expectedPenalty = subs.reduce((sum, s) => sum + (s.totalExpectedPenalty ?? 0n), 0n);
    const creatorFallbackAmount = subs.reduce((sum, s) => sum + (s.creatorFallbackAmount ?? 0n), 0n);
    const effectivePenalty = penaltyCollected > 0n ? penaltyCollected : (expectedPenalty > 0n ? expectedPenalty : creatorFallbackAmount);
    const creatorOffer = m.creatorOffer ?? 0n;
    const optionCount = Math.max(1, m.optionCount ?? 1);
    const premiumPaid = creatorOffer * BigInt(optionCount);

    if (!creatorStats.has(key)) {
      creatorStats.set(key, {
        creator: creatorAddr,
        totalMarkets: 0,
        totalPnL: 0n,
        totalPremium: 0n,
        labels: {},
      });
    }
    const stat = creatorStats.get(key)!;
    stat.totalMarkets += 1;
    stat.totalPnL += effectivePenalty - premiumPaid;
    stat.totalPremium += premiumPaid;
    const lbl = m.label ?? "other";
    if (!stat.labels[lbl]) stat.labels[lbl] = { markets: 0, pnl: 0n };
    stat.labels[lbl].markets += 1;
    stat.labels[lbl].pnl += effectivePenalty - premiumPaid;
  }

  const sorted = [...creatorStats.values()]
    .sort((a, b) => (b.totalPnL > a.totalPnL ? 1 : b.totalPnL < a.totalPnL ? -1 : 0))
    .slice(offset, offset + limit);

  return jsonBigInt(c, sorted.map((s) => ({
    creator: s.creator,
    totalMarkets: s.totalMarkets,
    totalPnL: s.totalPnL.toString(),
    totalPremium: s.totalPremium.toString(),
    labels: Object.fromEntries(
      Object.entries(s.labels).map(([k, v]) => [k, { markets: v.markets, pnl: v.pnl.toString() }])
    ),
  })));
});

app.get("/creators/:address/markets", async (c) => {
  const addressParam = c.req.param("address");
  const addr = (addressParam.startsWith("0x") ? addressParam : `0x${addressParam}`).toLowerCase();
  const limit = c.req.query("limit") ? parseInt(c.req.query("limit")!) : 20;
  const offset = c.req.query("offset") ? parseInt(c.req.query("offset")!) : 0;

  const toCreatorHex = (v: unknown): string => {
    if (v == null) return "";
    let hex = "";
    if (typeof v === "string") hex = v.trim();
    else if (Buffer.isBuffer(v)) hex = v.toString("hex");
    else if (v instanceof Uint8Array) hex = Buffer.from(v).toString("hex");
    else hex = String(v).trim();
    if (!hex) return "";
    return (hex.startsWith("0x") ? hex : "0x" + hex).toLowerCase();
  };

  const allMarkets = await db.select().from(market).orderBy(market.createdAt);
  const creatorMarkets = allMarkets.filter((m) => toCreatorHex(m.creator).toLowerCase() === addr);
  const paginated = creatorMarkets.slice(offset, offset + limit);
  return jsonBigInt(c, paginated);
});

app.get("/creators/:address", async (c) => {
  const addressParam = c.req.param("address");
  const addr = (addressParam.startsWith("0x") ? addressParam : `0x${addressParam}`).toLowerCase();

  const markets = await db.select().from(market);
  const submarkets = await db.select().from(submarket);

  const subByParent = new Map<string, typeof submarkets>();
  for (const sm of submarkets) {
    const key = sm.parentMarketId.toString();
    if (!subByParent.has(key)) subByParent.set(key, []);
    subByParent.get(key)!.push(sm);
  }

  const toCreatorHex = (v: unknown): string => {
    if (v == null) return "";
    let hex = "";
    if (typeof v === "string") hex = v.trim();
    else if (Buffer.isBuffer(v)) hex = v.toString("hex");
    else if (v instanceof Uint8Array) hex = Buffer.from(v).toString("hex");
    else hex = String(v).trim();
    if (!hex) return "";
    return (hex.startsWith("0x") ? hex : "0x" + hex).toLowerCase();
  };

  let totalMarkets = 0;
  let totalPnL = 0n;
  let totalPremium = 0n;
  const labels: Record<string, { markets: number; pnl: string }> = {};

  for (const m of markets) {
    const rawCreator = toCreatorHex(m.creator);
    const creatorAddr = rawCreator || "0x0000000000000000000000000000000000000000";
    if (creatorAddr.toLowerCase() !== addr) continue;

    const subs = subByParent.get(m.id.toString()) ?? [];
    const penaltyCollected = subs.reduce((sum, s) => sum + (s.totalPenaltyCollected ?? 0n), 0n);
    const expectedPenalty = subs.reduce((sum, s) => sum + (s.totalExpectedPenalty ?? 0n), 0n);
    const creatorFallbackAmount = subs.reduce((sum, s) => sum + (s.creatorFallbackAmount ?? 0n), 0n);
    const effectivePenalty = penaltyCollected > 0n ? penaltyCollected : (expectedPenalty > 0n ? expectedPenalty : creatorFallbackAmount);
    const creatorOffer = m.creatorOffer ?? 0n;
    const optionCount = Math.max(1, m.optionCount ?? 1);
    const premiumPaid = creatorOffer * BigInt(optionCount);

    totalMarkets += 1;
    totalPnL += effectivePenalty - premiumPaid;
    totalPremium += premiumPaid;
    const lbl = m.label ?? "other";
    if (!labels[lbl]) labels[lbl] = { markets: 0, pnl: "0" };
    labels[lbl].markets += 1;
    labels[lbl].pnl = (BigInt(labels[lbl].pnl) + effectivePenalty - premiumPaid).toString();
  }

  if (totalMarkets === 0) return c.text("Creator not found", 404);

  return jsonBigInt(c, {
    creator: addr,
    totalMarkets,
    totalPnL: totalPnL.toString(),
    totalPremium: totalPremium.toString(),
    labels,
  });
});

app.get("/labels", async (c) => {
  const [repRows, marketRows] = await Promise.all([
    db.select({ label: agentLabelReputation.label }).from(agentLabelReputation),
    db.select({ label: market.label }).from(market),
  ]);
  const labels = [...new Set([
    ...repRows.map((r) => r.label).filter(Boolean),
    ...marketRows.map((m) => m.label).filter(Boolean),
  ])].sort();
  return jsonBigInt(c, labels);
});

app.get("/agents/:id", async (c) => {
  const agentId = c.req.param("id").toLowerCase() as `0x${string}`;
  const agents = await db.select().from(agent).where(eq(agent.id, agentId));
  if (!agents[0]) return c.text("Agent not found", 404);
  const a = agents[0];
  // Augment totalWinnings with expectedPayout for resolved submarkets where not yet claimed
  const asmRows = await db.select().from(agentSubmarket).where(eq(agentSubmarket.agent, agentId));
  const smIds = [...new Set(asmRows.map((r) => normHex(r.submarketId)).filter(Boolean))];
  const smRows = smIds.length > 0
    ? await db.select().from(submarket).where(inArray(submarket.id, smIds as `0x${string}`[]))
    : [];
  const smResolved = new Set(smRows.filter((s) => s.resolvedOutcome != null).map((s) => normHex(s.id)));
  let effectiveWinnings = 0n;
  for (const asm of asmRows) {
    if (!smResolved.has(normHex(asm.submarketId))) continue;
    const totalPayout = asm.totalPayout ?? 0n;
    const expectedPayout = asm.expectedPayout ?? 0n;
    const expectedPenalty = asm.expectedPenalty ?? 0n;
    const payout = totalPayout > 0n ? totalPayout : (expectedPayout > expectedPenalty ? expectedPayout - expectedPenalty : 0n);
    effectiveWinnings += payout;
  }
  // Use effective (includes expected for unclaimed); fallback to stored if we have no submarket data
  const out = effectiveWinnings > 0n ? { ...a, totalWinnings: effectiveWinnings } : a;
  return jsonBigInt(c, out);
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
  const [marketRows, submarketRows] = await Promise.all([
    db.select().from(market).where(inArray(market.id, marketIds)),
    db.select().from(submarket).where(inArray(submarket.parentMarketId, marketIds)),
  ]);

  const marketMap = new Map(marketRows.map((m) => [m.id.toString(), m]));

  // Group submarkets by parentMarketId
  const submarketsByParent = new Map<string, typeof submarketRows>();
  for (const sm of submarketRows) {
    const key = sm.parentMarketId.toString();
    if (!submarketsByParent.has(key)) submarketsByParent.set(key, []);
    submarketsByParent.get(key)!.push(sm);
  }

  // Try to fetch agentSubmarket rows — first by parentMarketId, then fallback by computed id
  let agentSubmarketRows = await db.select().from(agentSubmarket).where(
    and(eq(agentSubmarket.agent, agentId), inArray(agentSubmarket.parentMarketId, marketIds))
  );

  // Fallback: if primary query returned nothing, look up by primary key {agent}-{submarketId}
  if (agentSubmarketRows.length === 0 && submarketRows.length > 0) {
    const ids = submarketRows.map((s) => `${agentId}-${normHex(s.id)}`);
    agentSubmarketRows = await db.select().from(agentSubmarket).where(
      inArray(agentSubmarket.id, ids)
    );
  }

  // Build agentSubmarket lookup by normalized submarketId
  const agentSubmarketBySid = new Map<string, (typeof agentSubmarketRows)[0]>();
  for (const asm of agentSubmarketRows) {
    agentSubmarketBySid.set(normHex(asm.submarketId), asm);
  }

  const result = agentMarkets.map((am) => {
    const mkt = marketMap.get(am.marketId.toString());
    const marketSubs = (submarketsByParent.get(am.marketId.toString()) ?? [])
      .sort((a, b) => a.optionIndex - b.optionIndex);

    // Build per-submarket stats from the submarket table (always available),
    // enriched with agentSubmarket data where it exists.
    const submarketStats = marketSubs.map((sm) => {
      const sid = normHex(sm.id);
      const agentSm = agentSubmarketBySid.get(sid);

      const yesShares = agentSm?.yesShares ?? 0n;
      const noShares = agentSm?.noShares ?? 0n;
      const totalShares = yesShares + noShares;

      // Use stored values; compute on-the-fly if missing (e.g. loser who skipped claimPayout)
      let wasCorrect = agentSm?.wasCorrect ?? null;
      let confidenceScore = agentSm?.confidenceScore ?? 0n;

      if (wasCorrect === null && sm.resolvedOutcome != null && totalShares > 0n) {
        // Confidence = majority of position (max(yes,no)/total)
        const majorityShares = yesShares >= noShares ? yesShares : noShares;
        confidenceScore = (majorityShares * 10000n) / totalShares;
        wasCorrect = sm.resolvedOutcome === 1 ? yesShares > noShares : noShares > yesShares;
      }

      // Use actual payout when claimed (already post-penalty), else expectedPayout - expectedPenalty
      const totalPayout = agentSm?.totalPayout ?? 0n;
      const expectedPayout = agentSm?.expectedPayout ?? 0n;
      const expectedPenalty = agentSm?.expectedPenalty ?? 0n;
      const effectivePayout = totalPayout > 0n ? totalPayout : (expectedPayout > expectedPenalty ? expectedPayout - expectedPenalty : 0n);

      return {
        submarketId: sid,
        optionIndex: sm.optionIndex,
        optionLabel: sm.optionLabel ?? null,
        yesShares,
        noShares,
        totalSwaps: agentSm?.totalSwaps ?? 0n,
        totalPayout: effectivePayout,
        wasCorrect,
        confidenceScore,
      };
    });

    return {
      id: am.id,
      agent: am.agent,
      marketId: am.marketId,
      participated: am.participated,
      marketQuestion: mkt?.question ?? null,
      ticketCost: mkt?.ticketCost ?? null,
      marketLabel: mkt?.label ?? null,
      submarkets: submarketStats,
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

app.get("/agents/:id/reputation", async (c) => {
  const agentId = c.req.param("id").toLowerCase() as `0x${string}`;
  const rows = await db.select().from(agentLabelReputation).where(eq(agentLabelReputation.agent, agentId));
  rows.sort((a, b) => Number(b.reputation - a.reputation));
  return jsonBigInt(c, rows);
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
 * GET /workflows/market-data/:marketId
 * Single-call endpoint for CRE workflows: returns market config + all submarkets + submission list.
 * The ciphertext bytes are NOT stored in ponder; the workflow must read them from the contract.
 * This endpoint replaces multiple ponder calls for the phase-1 workflow.
 */
app.get("/workflows/market-data/:marketId", async (c) => {
  const marketId = BigInt(c.req.param("marketId"));

  const [marketRow, submarketRows, submissionRows] = await Promise.all([
    db.select().from(market).where(eq(market.id, marketId)),
    db.select().from(submarket).where(eq(submarket.parentMarketId, marketId)),
    db.select().from(submission).where(eq(submission.marketId, marketId)),
  ]);

  if (!marketRow[0]) return c.text("Market not found", 404);

  submarketRows.sort((a, b) => a.optionIndex - b.optionIndex);

  return jsonBigInt(c, {
    market: marketRow[0],
    submarkets: submarketRows,
    submissions: submissionRows.map((s) => ({
      agent: s.agent,
      validationHash: s.validationHash,
      targetRound: s.targetRound,
    })),
    submissionCount: submissionRows.length,
  });
});

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
  // All submarkets grouped by parentMarketId
  const allSubmarkets = await db.select().from(submarket);
  // Track total and revealed submarket counts per parent
  const submarketTotalByParent = new Map<string, number>();
  const submarketRevealedByParent = new Map<string, number>();
  for (const sm of allSubmarkets) {
    const key = sm.parentMarketId.toString();
    submarketTotalByParent.set(key, (submarketTotalByParent.get(key) ?? 0) + 1);
    if (sm.phase >= 1) {
      submarketRevealedByParent.set(key, (submarketRevealedByParent.get(key) ?? 0) + 1);
    }
  }

  const results: Array<{
    marketId: string;
    optionCount: number;
    drandTargetRound: string;
    deadline: string;
    drandChainHash: string;
    submissionCount: number;
    submissions: Array<{ agent: string; validationHash: string; ciphertext: string }>;
  }> = [];

  for (const m of allMarkets) {
    const key = m.id.toString();
    // Skip if ALL submarkets already revealed — check both the submarket phase tracking
    // and the reliable market-level counter updated by Phase1Resolved events
    const optCount = m.optionCount ?? 1;
    const total = submarketTotalByParent.get(key) ?? 0;
    const revealed = submarketRevealedByParent.get(key) ?? 0;
    const phase1RevealedCount = m.phase1RevealedCount ?? 0;
    if (phase1RevealedCount >= optCount) continue;
    if (total > 0 && revealed >= total) continue;
    // Skip if no submissions
    const count = submissionCountByMarket.get(key) ?? 0;
    if (count === 0) continue;
    // drand round must have passed
    if (currentDrandRound != null && BigInt(m.drandTargetRound) > currentDrandRound) continue;

    const subs = submissionsByMarket.get(key) ?? [];
    results.push({
      marketId: key,
      optionCount: optCount,
      drandTargetRound: m.drandTargetRound.toString(),
      deadline: m.drandTargetRound.toString(),
      drandChainHash: m.drandChainHash ?? "0x0",
      submissionCount: count,
      submissions: subs.map((s) => ({
        agent: s.agent,
        validationHash: s.validationHash,
        ciphertext: s.ciphertext ?? "",
      })),
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

  // Group pending submarkets by parent market
  type PendingSM = { submarketId: string; optionIndex: number; optionLabel: string };
  const pendingByParent = new Map<string, { tradingEnd: number; items: PendingSM[] }>();

  for (const sm of allSubmarkets) {
    if (sm.phase !== 1) continue;
    if (sm.resolvedOutcome != null) continue;

    const m = marketMap.get(sm.parentMarketId.toString());
    if (!m) continue;

    const tradingEnd = Number(m.createdAt) + Number(m.tradingDuration ?? 0);
    if (now < tradingEnd) continue;

    const key = sm.parentMarketId.toString();
    if (!pendingByParent.has(key)) pendingByParent.set(key, { tradingEnd, items: [] });
    pendingByParent.get(key)!.items.push({
      submarketId: sm.id,
      optionIndex: sm.optionIndex,
      optionLabel: sm.optionLabel ?? "",
    });
  }

  const results: Array<{
    marketId: string;
    question: string;
    tradingEnd: number;
    schema: Record<string, unknown>;
    submarkets: PendingSM[];
  }> = [];

  for (const [marketIdStr, { tradingEnd, items }] of pendingByParent) {
    const m = marketMap.get(marketIdStr)!;
    let schema: Record<string, unknown> = {};
    try { schema = JSON.parse(m.schema ?? "") ?? {}; } catch { /* invalid JSON */ }

    results.push({
      marketId: marketIdStr,
      question: m.question ?? "",
      tradingEnd,
      schema,
      submarkets: items.sort((a, b) => a.optionIndex - b.optionIndex),
    });
  }

  results.sort((a, b) => a.tradingEnd - b.tradingEnd);
  const single = c.req.query("single") === "true";
  const out = single ? (results[0] ? [results[0]] : []) : results;
  return c.json(out);
});

export default app;
