import { Hono } from "hono";
import { db } from "ponder:api";
import { market, submission, agent, agentMarket, swap, payout } from "../ponder.schema";

const app = new Hono();

app.get("/markets", async (c) => {
  const limit = c.req.query("limit") ? parseInt(c.req.query("limit")!) : 10;
  const offset = c.req.query("offset") ? parseInt(c.req.query("offset")!) : 0;

  const markets = await db.select().from(market).orderBy(market.createdAt).limit(limit).offset(offset);

  return c.json(markets);
});

app.get("/markets/:id", async (c) => {
  const id = BigInt(c.req.param("id"));
  const m = await db.select().from(market).where(eq(market.id, id));
  
  if (!m[0]) {
    return c.text("Market not found", 404);
  }
  
  return c.json(m[0]);
});

app.get("/markets/:id/submissions", async (c) => {
  const marketId = BigInt(c.req.param("id"));
  
  const submissionsList = await db.select().from(submission).where(eq(submission.marketId, marketId));
  
  return c.json(submissionsList);
});

app.get("/agents/:id", async (c) => {
  const agentId = c.req.param("id");
  
  const agents = await db.select().from(agent).where(eq(agent.id, agentId));
  
  if (!agents[0]) {
    return c.text("Agent not found", 404);
  }
  
  return c.json(agents[0]);
});

app.get("/swaps", async (c) => {
  const limit = c.req.query("limit") ? parseInt(c.req.query("limit")!) : 50;
  const offset = c.req.query("offset") ? parseInt(c.req.query("offset")!) : 0;
  
  const swapsList = await db.select().from(swap).limit(limit).offset(offset);
  
  return c.json(swapsList);
});

app.get("/payouts", async (c) => {
  const limit = c.req.query("limit") ? parseInt(c.req.query("limit")!) : 50;
  const offset = c.req.query("offset") ? parseInt(c.req.query("offset")!) : 0;
  
  const payoutsList = await db.select().from(payout).limit(limit).offset(offset);
  
  return c.json(payoutsList);
});

export default app;
