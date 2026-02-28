import { ponder } from "ponder:registry";
import { market, submarket, submission, agent, agentMarket, agentSubmarket, swap, payout, priceHistory, order } from "ponder:schema";

const PRECISION = 1_000_000_000_000_000_000n;

function calculatePrices(reserveYes: bigint, reserveNo: bigint): { priceYes: bigint; priceNo: bigint } {
  const totalReserve = reserveYes + reserveNo;
  if (totalReserve === 0n) {
    return { priceYes: PRECISION / 2n, priceNo: PRECISION / 2n };
  }
  const priceYes = (reserveNo * PRECISION) / totalReserve;
  const priceNo = (reserveYes * PRECISION) / totalReserve;
  return { priceYes, priceNo };
}

// ---------------------------------------------------------------------------
// Parent-market events (uint256 marketId)
// ---------------------------------------------------------------------------

ponder.on("MiniMarket:MarketCreated", async ({ event, context }) => {
  const { marketId, question, schemaJson, maxSlots, ticketCost, drandTargetRound, creatorOffer } = event.args;

  const marketCap = maxSlots * ticketCost;
  const drandChainHash = "0x0000000000000000000000000000000000000000000000000000000000000000";
  const tradingDuration = 300n;

  let marketLabel: string | null = null;
  if (schemaJson) {
    try {
      const parsed = JSON.parse(schemaJson);
      if (typeof parsed.label === "string" && parsed.label) marketLabel = parsed.label;
    } catch {}
  }

  await context.db
    .insert(market)
    .values({
      id: marketId,
      question,
      schema: schemaJson || null,
      label: marketLabel,
      maxSlots,
      ticketCost,
      marketCap,
      drandTargetRound: BigInt(drandTargetRound),
      drandChainHash,
      createdAt: BigInt(event.block.timestamp),
      tradingDuration,
      totalParticipants: 0n,
      creator: event.transaction.from,
      creatorOffer: BigInt(creatorOffer),
      optionCount: 1,
    })
    .onConflictDoUpdate({
      question,
      schema: schemaJson || null,
      label: marketLabel,
      maxSlots,
      ticketCost,
      marketCap,
      drandTargetRound: BigInt(drandTargetRound),
      drandChainHash,
      createdAt: BigInt(event.block.timestamp),
      tradingDuration,
      creator: event.transaction.from,
      creatorOffer: BigInt(creatorOffer),
    });
});

ponder.on("MiniMarket:SubmarketCreated", async ({ event, context }) => {
  const { parentMarketId, submarketId, optionIndex, optionLabel } = event.args;

  await context.db
    .insert(submarket)
    .values({
      id: submarketId,
      parentMarketId,
      optionIndex,
      optionLabel: optionLabel || null,
      phase: 0,
      createdAt: BigInt(event.block.timestamp),
    })
    .onConflictDoNothing();

  // Update optionCount on parent market
  const marketRecord = await context.db.find(market, { id: parentMarketId });
  if (marketRecord) {
    const newCount = Math.max(marketRecord.optionCount ?? 1, Number(optionIndex) + 1);
    await context.db.update(market, { id: parentMarketId }).set({ optionCount: newCount });
  }
});

ponder.on("MiniMarket:EncryptedSubmissionReceived", async ({ event, context }) => {
  const { marketId, agent: agentAddr, validationHash, targetRound } = event.args;
  const timestamp = BigInt(event.block.timestamp);
  const txHash = event.transaction.hash;

  await context.db.insert(submission).values({
    id: `${marketId}-${agentAddr}-${txHash}`,
    marketId,
    agent: agentAddr,
    validationHash,
    targetRound: BigInt(targetRound),
    timestamp,
    txHash,
  });

  const marketRecord = await context.db.find(market, { id: marketId });
  const ticketCost = marketRecord?.ticketCost ?? 0n;

  const agentRecord = await context.db.find(agent, { id: agentAddr });

  if (!agentRecord) {
    await context.db.insert(agent).values({
      id: agentAddr,
      totalSubmissions: 1n,
      totalMarketsParticipated: 1n,
      totalStaked: ticketCost,
      totalCorrectPredictions: 0n,
      totalWinnings: 0n,
      totalSharesClaimed: 0n,
      totalSwaps: 0n,
      reputation: 0n,
      totalConfidenceScore: 0n,
      totalResolvedMarkets: 0n,
      firstSeenAt: timestamp,
      lastActiveAt: timestamp,
    });
  } else {
    await context.db.update(agent, { id: agentAddr }).set({
      totalSubmissions: agentRecord.totalSubmissions + 1n,
      totalStaked: agentRecord.totalStaked + ticketCost,
      lastActiveAt: timestamp,
    });
  }

  if (marketRecord) {
    await context.db.update(market, { id: marketId }).set({
      totalParticipants: marketRecord.totalParticipants + 1n,
    });
  }

  const agentMarketId = `${agentAddr}-${marketId}`;
  const agentMarketRecord = await context.db.find(agentMarket, { id: agentMarketId });

  if (!agentMarketRecord) {
    await context.db.insert(agentMarket).values({
      id: agentMarketId,
      agent: agentAddr,
      marketId,
      participated: true,
    });

    if (agentRecord) {
      await context.db.update(agent, { id: agentAddr }).set({
        totalMarketsParticipated: agentRecord.totalMarketsParticipated + 1n,
      });
    }
  }
});

// ---------------------------------------------------------------------------
// Submarket-level events (bytes32 submarketId)
// ---------------------------------------------------------------------------

ponder.on("MiniMarket:InfoPhaseRevealed", async ({ event, context }) => {
  const {
    submarketId,
    merkleRoot,
    consensusOutcome,
    totalReserveYes,
    totalReserveNo,
    validSubmissions: validSubs,
    totalYesShares,
    totalNoShares,
    leavesURI,
  } = event.args;

  await context.db
    .insert(submarket)
    .values({
      id: submarketId,
      parentMarketId: 0n, // will be set by SubmarketCreated; update below if record exists
      optionIndex: 0,
      phase: 1,
      merkleRoot,
      consensusOutcome,
      reserveYes: BigInt(totalReserveYes),
      reserveNo: BigInt(totalReserveNo),
      validSubmissions: BigInt(validSubs),
      totalYesShares: BigInt(totalYesShares),
      totalNoShares: BigInt(totalNoShares),
      leavesURI: leavesURI || null,
      createdAt: BigInt(event.block.timestamp),
    })
    .onConflictDoUpdate({
      phase: 1,
      merkleRoot,
      consensusOutcome,
      reserveYes: BigInt(totalReserveYes),
      reserveNo: BigInt(totalReserveNo),
      validSubmissions: BigInt(validSubs),
      totalYesShares: BigInt(totalYesShares),
      totalNoShares: BigInt(totalNoShares),
      leavesURI: leavesURI || null,
    });

  // Insert initial price history snapshot
  const { priceYes, priceNo } = calculatePrices(BigInt(totalReserveYes), BigInt(totalReserveNo));
  const submarketRecord = await context.db.find(submarket, { id: submarketId });
  await context.db.insert(priceHistory).values({
    id: `${submarketId}-reveal-${event.transaction.hash}`,
    submarketId,
    parentMarketId: submarketRecord?.parentMarketId ?? 0n,
    timestamp: BigInt(event.block.timestamp),
    priceYes,
    priceNo,
    reserveYes: BigInt(totalReserveYes),
    reserveNo: BigInt(totalReserveNo),
    eventType: "reveal",
    txHash: event.transaction.hash,
  });
});

/**
 * Phase1Resolved: CRE has processed phase 1 (reveal) via revealInfoPhase.
 */
ponder.on("MiniMarket:Phase1Resolved", async ({ event, context }) => {
  const { submarketId } = event.args;
  const existing = await context.db.find(submarket, { id: submarketId });
  if (existing) {
    await context.db.update(submarket, { id: submarketId }).set({ phase: 1 });
  }
});

ponder.on("MiniMarket:SharesClaimed", async ({ event, context }) => {
  const { submarketId, agent: agentAddr, yesShares, noShares } = event.args;
  const timestamp = BigInt(event.block.timestamp);
  const totalShares = BigInt(yesShares) + BigInt(noShares);

  const submarketRecord = await context.db.find(submarket, { id: submarketId });

  const agentSubmarketId = `${agentAddr}-${submarketId}`;
  const existing = await context.db.find(agentSubmarket, { id: agentSubmarketId });

  if (existing) {
    await context.db.update(agentSubmarket, { id: agentSubmarketId }).set({
      yesShares: BigInt(yesShares),
      noShares: BigInt(noShares),
      claimedShares: true,
    });
  } else {
    await context.db.insert(agentSubmarket).values({
      id: agentSubmarketId,
      agent: agentAddr,
      submarketId,
      parentMarketId: submarketRecord?.parentMarketId ?? 0n,
      optionIndex: submarketRecord?.optionIndex ?? 0,
      yesShares: BigInt(yesShares),
      noShares: BigInt(noShares),
      claimedShares: true,
    });
  }

  const agentRecord = await context.db.find(agent, { id: agentAddr });
  if (agentRecord) {
    await context.db.update(agent, { id: agentAddr }).set({
      totalSharesClaimed: agentRecord.totalSharesClaimed + totalShares,
      lastActiveAt: timestamp,
    });
  }
});

ponder.on("MiniMarket:SharesSwapped", async ({ event, context }) => {
  const { submarketId, agent: agentAddr, burnedOutcome, mintedOutcome, burnAmount, mintAmount } = event.args;
  const timestamp = BigInt(event.block.timestamp);
  const txHash = event.transaction.hash;

  const submarketRecord = await context.db.find(submarket, { id: submarketId });
  const parentMarketId = submarketRecord?.parentMarketId ?? 0n;

  await context.db.insert(swap).values({
    id: `${submarketId}-${agentAddr}-${txHash}`,
    submarketId,
    parentMarketId,
    agent: agentAddr,
    burnedOutcome,
    mintedOutcome,
    burnAmount: BigInt(burnAmount),
    mintAmount: BigInt(mintAmount),
    timestamp,
    txHash,
  });

  const agentSubmarketId = `${agentAddr}-${submarketId}`;
  const agentSubmarketRecord = await context.db.find(agentSubmarket, { id: agentSubmarketId });

  if (agentSubmarketRecord) {
    await context.db.update(agentSubmarket, { id: agentSubmarketId }).set({
      totalSwaps: (agentSubmarketRecord.totalSwaps || 0n) + 1n,
    });
  }

  const agentRecord = await context.db.find(agent, { id: agentAddr });
  if (agentRecord) {
    await context.db.update(agent, { id: agentAddr }).set({
      totalSwaps: agentRecord.totalSwaps + 1n,
      lastActiveAt: timestamp,
    });
  }

  if (submarketRecord) {
    let newReserveYes = submarketRecord.reserveYes || 0n;
    let newReserveNo = submarketRecord.reserveNo || 0n;

    if (burnedOutcome === 1) {
      newReserveYes = newReserveYes + BigInt(burnAmount);
      newReserveNo = newReserveNo - BigInt(mintAmount);
    } else {
      newReserveNo = newReserveNo + BigInt(burnAmount);
      newReserveYes = newReserveYes - BigInt(mintAmount);
    }

    await context.db.update(submarket, { id: submarketId }).set({
      reserveYes: newReserveYes,
      reserveNo: newReserveNo,
    });

    const { priceYes, priceNo } = calculatePrices(newReserveYes, newReserveNo);

    await context.db.insert(priceHistory).values({
      id: `${submarketId}-swap-${txHash}`,
      submarketId,
      parentMarketId,
      timestamp,
      priceYes,
      priceNo,
      reserveYes: newReserveYes,
      reserveNo: newReserveNo,
      eventType: "swap",
      txHash,
    });
  }
});

ponder.on("MiniMarket:MarketResolved", async ({ event, context }) => {
  const { submarketId, outcome } = event.args;

  const existing = await context.db.find(submarket, { id: submarketId });
  if (existing) {
    await context.db.update(submarket, { id: submarketId }).set({
      resolvedOutcome: outcome,
    });
  }
});

/**
 * Phase2Resolved: CRE has processed phase 2 via onReport.
 */
ponder.on("MiniMarket:Phase2Resolved", async ({ event, context }) => {
  const { submarketId } = event.args;
  const existing = await context.db.find(submarket, { id: submarketId });
  if (existing) {
    await context.db.update(submarket, { id: submarketId }).set({ phase: 2 });
  }
});

ponder.on("MiniMarket:PenaltyCollected", async ({ event, context }) => {
  const { submarketId, agent: agentAddr, penaltyAmount } = event.args;
  const txHash = event.transaction.hash;

  // PayoutClaimed fires before PenaltyCollected in the same tx
  const payoutId = `${submarketId}-${agentAddr}-${txHash}`;
  const payoutRecord = await context.db.find(payout, { id: payoutId });
  if (payoutRecord) {
    await context.db.update(payout, { id: payoutId }).set({
      penaltyAmount: BigInt(penaltyAmount),
    });

    const agentPayoutAmt = payoutRecord.amount;
    const fullPayout = agentPayoutAmt + BigInt(penaltyAmount);
    const factorBps = fullPayout > 0n ? (BigInt(penaltyAmount) * 10000n) / fullPayout : 0n;

    const agentSubmarketId = `${agentAddr}-${submarketId}`;
    const agentSubmarketRecord = await context.db.find(agentSubmarket, { id: agentSubmarketId });
    if (agentSubmarketRecord) {
      await context.db.update(agentSubmarket, { id: agentSubmarketId }).set({
        penaltyFactor: factorBps,
      });
    }
  }

  const submarketRecord = await context.db.find(submarket, { id: submarketId });
  if (submarketRecord) {
    await context.db.update(submarket, { id: submarketId }).set({
      totalPenaltyCollected: (submarketRecord.totalPenaltyCollected ?? 0n) + BigInt(penaltyAmount),
    });
  }
});

ponder.on("MiniMarket:PayoutClaimed", async ({ event, context }) => {
  const { submarketId, agent: agentAddr, amount } = event.args;
  const timestamp = BigInt(event.block.timestamp);
  const txHash = event.transaction.hash;

  const submarketRecord = await context.db.find(submarket, { id: submarketId });
  const parentMarketId = submarketRecord?.parentMarketId ?? 0n;

  await context.db.insert(payout).values({
    id: `${submarketId}-${agentAddr}-${txHash}`,
    submarketId,
    parentMarketId,
    agent: agentAddr,
    amount: BigInt(amount),
    timestamp,
    txHash,
  });

  const agentSubmarketId = `${agentAddr}-${submarketId}`;
  const agentSubmarketRecord = await context.db.find(agentSubmarket, { id: agentSubmarketId });

  if (agentSubmarketRecord && submarketRecord) {
    const yesShares = agentSubmarketRecord.yesShares ?? 0n;
    const noShares = agentSubmarketRecord.noShares ?? 0n;
    const totalShares = yesShares + noShares;

    let winningShares = 0n;
    if (submarketRecord.resolvedOutcome === 1) winningShares = yesShares;
    else if (submarketRecord.resolvedOutcome === 2) winningShares = noShares;
    const confidenceScore = totalShares > 0n ? (winningShares * 10000n) / totalShares : 0n;

    const wasCorrect =
      submarketRecord.resolvedOutcome === 1
        ? yesShares > noShares
        : submarketRecord.resolvedOutcome === 2
          ? noShares > yesShares
          : null;

    await context.db.update(agentSubmarket, { id: agentSubmarketId }).set({
      totalPayout: BigInt(amount),
      wasCorrect,
      confidenceScore,
    });

    const agentRecord = await context.db.find(agent, { id: agentAddr });
    if (agentRecord) {
      await context.db.update(agent, { id: agentAddr }).set({
        totalCorrectPredictions: wasCorrect
          ? agentRecord.totalCorrectPredictions + 1n
          : agentRecord.totalCorrectPredictions,
        totalConfidenceScore: agentRecord.totalConfidenceScore + confidenceScore,
        totalResolvedMarkets: agentRecord.totalResolvedMarkets + 1n,
      });
    }
  }

  const agentRecord = await context.db.find(agent, { id: agentAddr });
  if (agentRecord) {
    await context.db.update(agent, { id: agentAddr }).set({
      totalWinnings: agentRecord.totalWinnings + BigInt(amount),
      lastActiveAt: timestamp,
    });
  }
});

// ---------------------------------------------------------------------------
// Orderbook events
// ---------------------------------------------------------------------------

ponder.on("OrderbookMarket:OrderPlaced", async ({ event, context }) => {
  const { orderId, maker, submarketId, sellYes, amount, price } = event.args;

  const submarketRecord = await context.db.find(submarket, { id: submarketId });
  const parentMarketId = submarketRecord?.parentMarketId ?? 0n;

  await context.db.insert(order).values({
    id: orderId.toString(),
    orderId,
    submarketId,
    parentMarketId,
    maker,
    sellYes,
    amount,
    price,
    status: "open",
    timestamp: BigInt(event.block.timestamp),
    txHash: event.transaction.hash,
  });
});

ponder.on("OrderbookMarket:OrderCancelled", async ({ event, context }) => {
  const { orderId } = event.args;
  const existing = await context.db.find(order, { id: orderId.toString() });
  if (existing) {
    await context.db.update(order, { id: orderId.toString() }).set({ status: "cancelled" });
  }
});

ponder.on("OrderbookMarket:OrderFilled", async ({ event, context }) => {
  const { orderId, taker, sharesAmount, takerPaysAmount } = event.args;
  const existing = await context.db.find(order, { id: orderId.toString() });
  if (existing) {
    await context.db.update(order, { id: orderId.toString() }).set({
      status: "filled",
      taker,
      sharesAmount,
      takerPaysAmount,
    });
  }
});
