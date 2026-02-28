import { onchainTable } from "ponder";

export const market = onchainTable(
  "market",
  (t) => ({
    id: t.bigint().primaryKey(),
    question: t.text().notNull(),
    schema: t.text(),
    label: t.text(), // parsed from schema.label (e.g. "sport", "crypto", "politics")
    maxSlots: t.bigint().notNull(),
    ticketCost: t.bigint().notNull(),
    marketCap: t.bigint().notNull(),
    drandTargetRound: t.bigint().notNull(),
    drandChainHash: t.hex().notNull(),
    createdAt: t.bigint().notNull(),
    tradingDuration: t.bigint().notNull(),
    creator: t.hex(),
    creatorOffer: t.bigint().default(0n),
    optionCount: t.integer().notNull().default(1),
    totalParticipants: t.bigint().default(0n),
  })
);

export const submarket = onchainTable(
  "submarket",
  (t) => ({
    id: t.hex().primaryKey(),           // bytes32 submarketId
    parentMarketId: t.bigint().notNull(),
    optionIndex: t.integer().notNull(),
    optionLabel: t.text(),
    phase: t.integer().notNull().default(0),
    merkleRoot: t.hex(),
    consensusOutcome: t.integer(),
    reserveYes: t.bigint().default(0n),
    reserveNo: t.bigint().default(0n),
    totalClaimedYes: t.bigint().default(0n),
    totalClaimedNo: t.bigint().default(0n),
    resolvedOutcome: t.integer(),
    validSubmissions: t.bigint().default(0n),
    totalYesShares: t.bigint().default(0n),
    totalNoShares: t.bigint().default(0n),
    leavesURI: t.text(),
    totalPenaltyCollected: t.bigint().default(0n),
    createdAt: t.bigint().notNull(),
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
  // sum of per-market confidenceScore values (0–10000 bps each)
  totalConfidenceScore: t.bigint().notNull().default(0n),
  // number of resolved markets where this agent claimed payout
  totalResolvedMarkets: t.bigint().notNull().default(0n),
  firstSeenAt: t.bigint(),
  lastActiveAt: t.bigint(),
}));

// Per parent-market participation (phase 1 info collection)
export const agentMarket = onchainTable(
  "agent_market",
  (t) => ({
    id: t.text().primaryKey(),         // "{agent}-{parentMarketId}"
    agent: t.hex().notNull(),
    marketId: t.bigint().notNull(),
    participated: t.boolean().notNull().default(false),
  })
);

// Per-submarket shares and payout tracking
export const agentSubmarket = onchainTable(
  "agent_submarket",
  (t) => ({
    id: t.text().primaryKey(),          // "{agent}-{submarketId}"
    agent: t.hex().notNull(),
    submarketId: t.hex().notNull(),
    parentMarketId: t.bigint().notNull(),
    optionIndex: t.integer().notNull(),
    yesShares: t.bigint().default(0n),
    noShares: t.bigint().default(0n),
    claimedShares: t.boolean().notNull().default(false),
    totalSwaps: t.bigint().default(0n),
    totalPayout: t.bigint().default(0n),
    wasCorrect: t.boolean(),
    penaltyFactor: t.bigint().default(0n), // 0–10000 bps
    confidenceScore: t.bigint().default(0n),
  })
);

export const swap = onchainTable(
  "swap",
  (t) => ({
    id: t.text().primaryKey(),
    submarketId: t.hex().notNull(),
    parentMarketId: t.bigint().notNull(),
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
    submarketId: t.hex().notNull(),
    parentMarketId: t.bigint().notNull(),
    agent: t.hex().notNull(),
    amount: t.bigint().notNull(),
    penaltyAmount: t.bigint().default(0n), // withheld penalty sent to creator
    timestamp: t.bigint().notNull(),
    txHash: t.hex().notNull(),
  })
);

export const order = onchainTable(
  "order",
  (t) => ({
    id: t.text().primaryKey(), // orderId.toString() — global counter, always unique
    orderId: t.bigint().notNull(),
    submarketId: t.hex().notNull(),
    parentMarketId: t.bigint().notNull(),
    maker: t.hex().notNull(),
    sellYes: t.boolean().notNull(),
    amount: t.bigint().notNull(),   // shares (1e6 precision)
    price: t.bigint().notNull(),    // 1e18 precision: cost in other-outcome per 1 share
    status: t.text().notNull(),     // "open" | "filled" | "cancelled"
    taker: t.hex(),
    sharesAmount: t.bigint(),       // filled amount (set on OrderFilled)
    takerPaysAmount: t.bigint(),    // taker paid (set on OrderFilled)
    timestamp: t.bigint().notNull(),
    txHash: t.hex().notNull(),
  })
);

export const priceHistory = onchainTable(
  "price_history",
  (t) => ({
    id: t.text().primaryKey(),
    submarketId: t.hex().notNull(),
    parentMarketId: t.bigint().notNull(),
    timestamp: t.bigint().notNull(),
    priceYes: t.bigint().notNull(),
    priceNo: t.bigint().notNull(),
    reserveYes: t.bigint().notNull(),
    reserveNo: t.bigint().notNull(),
    eventType: t.text().notNull(),
    txHash: t.hex().notNull(),
  })
);
