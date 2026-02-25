import { onchainTable } from "ponder";

export const market = onchainTable(
  "market",
  (t) => ({
    id: t.bigint().primaryKey(),
    question: t.text().notNull(),
    schema: t.text().optional(),
    maxSlots: t.bigint().notNull(),
    ticketCost: t.bigint().notNull(),
    marketCap: t.bigint().notNull(),
    drandTargetRound: t.bigint().notNull(),
    drandChainHash: t.hex().notNull(),
    createdAt: t.bigint().notNull(),
    tradingDuration: t.bigint().notNull(),
    phase: t.integer().notNull().default(0),
    merkleRoot: t.hex(),
    consensusOutcome: t.integer().default(0),
    reserveYes: t.bigint().default(0n),
    reserveNo: t.bigint().default(0n),
    resolvedOutcome: t.integer().default(0),
    validSubmissions: t.bigint().default(0n),
    totalParticipants: t.bigint().default(0n),
    creator: t.hex(),
    leavesURI: t.text().optional(),
  })
);

export const submission = onchainTable(
  "submission",
  (t) => ({
    id: t.text().primaryKey(),
    marketId: t.bigint().notNull(),
    agent: t.hex().notNull(),
    validationHash: t.hex().notNull(),
    targetRound: t.bigint().notNull(),
    timestamp: t.bigint().notNull(),
    txHash: t.hex().notNull(),
  })
);

export const agent = onchainTable("agent", (t) => ({
  id: t.hex().primaryKey(),
  totalSubmissions: t.bigint().notNull().default(0n),
  totalMarketsParticipated: t.bigint().notNull().default(0n),
  totalStaked: t.bigint().notNull().default(0n),
  totalCorrectPredictions: t.bigint().notNull().default(0n),
  totalWinnings: t.bigint().notNull().default(0n),
  totalSharesClaimed: t.bigint().notNull().default(0n),
  totalSwaps: t.bigint().notNull().default(0n),
  reputation: t.bigint().notNull().default(0n),
  firstSeenAt: t.bigint(),
  lastActiveAt: t.bigint(),
}));

export const agentMarket = onchainTable(
  "agent_market",
  (t) => ({
    id: t.text().primaryKey(),
    agent: t.hex().notNull(),
    marketId: t.bigint().notNull(),
    participated: t.boolean().notNull().default(false),
    predictedOutcome: t.integer(),
    allocatedShares: t.bigint().default(0n),
    claimedShares: t.boolean().notNull().default(false),
    yesShares: t.bigint().default(0n),
    noShares: t.bigint().default(0n),
    totalSwaps: t.bigint().default(0n),
    totalPayout: t.bigint().default(0n),
    wasCorrect: t.boolean(),
  })
);

export const swap = onchainTable(
  "swap",
  (t) => ({
    id: t.text().primaryKey(),
    marketId: t.bigint().notNull(),
    agent: t.hex().notNull(),
    burnedOutcome: t.integer().notNull(),
    mintedOutcome: t.integer().notNull(),
    burnAmount: t.bigint().notNull(),
    mintAmount: t.bigint().notNull(),
    timestamp: t.bigint().notNull(),
    txHash: t.hex().notNull(),
  })
);

export const payout = onchainTable(
  "payout",
  (t) => ({
    id: t.text().primaryKey(),
    marketId: t.bigint().notNull(),
    agent: t.hex().notNull(),
    amount: t.bigint().notNull(),
    timestamp: t.bigint().notNull(),
    txHash: t.hex().notNull(),
  })
);

export const priceHistory = onchainTable(
  "price_history",
  (t) => ({
    id: t.text().primaryKey(),
    marketId: t.bigint().notNull(),
    timestamp: t.bigint().notNull(),
    priceYes: t.bigint().notNull(),
    priceNo: t.bigint().notNull(),
    reserveYes: t.bigint().notNull(),
    reserveNo: t.bigint().notNull(),
    eventType: t.text().notNull(),
    txHash: t.hex().notNull(),
  })
);
