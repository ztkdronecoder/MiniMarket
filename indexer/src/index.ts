import { ponder } from "ponder:registry";
import { market, submission, agent, agentMarket, swap, payout, priceHistory, order } from "ponder:schema";

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

ponder.on("MiniMarket:MarketCreated", async ({ event, context }) => {
  const { marketId, question, schemaJson, maxSlots, ticketCost, drandTargetRound, creatorOffer } = event.args;

  // Use event data only — avoid readContract (configs returns large uint256/bytes32 that viem can't decode safely)
  const marketCap = maxSlots * ticketCost;
  const drandChainHash = "0x0000000000000000000000000000000000000000000000000000000000000000";
  const tradingDuration = 300n; // default 5 min; CreateMarket script sets TRADING_DURATION

  // Parse label from schemaJson
  let marketLabel: string | null = null;
  if (schemaJson) {
    try {
      const parsed = JSON.parse(schemaJson);
      if (typeof parsed.label === 'string' && parsed.label) marketLabel = parsed.label;
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
      phase: 0,
      totalParticipants: 0n,
      creator: event.transaction.from,
      creatorOffer: BigInt(creatorOffer),
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

  // Read ticketCost so we can track how much the agent spent
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
      totalSwaps: 0n,
    });
    
    if (agentRecord) {
      await context.db.update(agent, { id: agentAddr }).set({
        totalMarketsParticipated: agentRecord.totalMarketsParticipated + 1n,
      });
    }
  }
});

/**
 * Phase1Resolved: CRE has processed phase 1 (reveal) via revealInfoPhase.
 * Updates market so it is removed from /workflows/next-phase1 list.
 * (InfoPhaseRevealed has ABI mismatch with contract, so we use Phase1Resolved instead.)
 */
ponder.on("MiniMarket:Phase1Resolved", async ({ event, context }) => {
  const { marketId } = event.args;
  await context.db.update(market, { id: marketId }).set({ phase: 1 });
});

ponder.on("MiniMarket:SharesClaimed", async ({ event, context }) => {
  const { marketId, agent: agentAddr, yesShares, noShares } = event.args;
  const timestamp = BigInt(event.block.timestamp);
  const totalShares = BigInt(yesShares) + BigInt(noShares);

  const agentMarketId = `${agentAddr}-${marketId}`;
  const agentMarketRecord = await context.db.find(agentMarket, { id: agentMarketId });
  
  if (agentMarketRecord) {
    await context.db.update(agentMarket, { id: agentMarketId }).set({
      yesShares: BigInt(yesShares),
      noShares: BigInt(noShares),
      allocatedShares: totalShares,
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
  const { marketId, agent: agentAddr, burnedOutcome, mintedOutcome, burnAmount, mintAmount } = event.args;
  const timestamp = BigInt(event.block.timestamp);
  const txHash = event.transaction.hash;

  await context.db.insert(swap).values({
    id: `${marketId}-${agentAddr}-${txHash}`,
    marketId,
    agent: agentAddr,
    burnedOutcome,
    mintedOutcome,
    burnAmount: BigInt(burnAmount),
    mintAmount: BigInt(mintAmount),
    timestamp,
    txHash,
  });

  const agentMarketId = `${agentAddr}-${marketId}`;
  const agentMarketRecord = await context.db.find(agentMarket, { id: agentMarketId });
  
  if (agentMarketRecord) {
    await context.db.update(agentMarket, { id: agentMarketId }).set({
      totalSwaps: (agentMarketRecord.totalSwaps || 0n) + 1n,
    });
  }

  const agentRecord = await context.db.find(agent, { id: agentAddr });
  if (agentRecord) {
    await context.db.update(agent, { id: agentAddr }).set({
      totalSwaps: agentRecord.totalSwaps + 1n,
      lastActiveAt: timestamp,
    });
  }

  const marketRecord = await context.db.find(market, { id: marketId });
  if (marketRecord) {
    let newReserveYes = marketRecord.reserveYes || 0n;
    let newReserveNo = marketRecord.reserveNo || 0n;

    if (burnedOutcome === 1) {
      newReserveYes = newReserveYes + BigInt(burnAmount);
      newReserveNo = newReserveNo - BigInt(mintAmount);
    } else {
      newReserveNo = newReserveNo + BigInt(burnAmount);
      newReserveYes = newReserveYes - BigInt(mintAmount);
    }

    await context.db.update(market, { id: marketId }).set({
      reserveYes: newReserveYes,
      reserveNo: newReserveNo,
    });

    const { priceYes, priceNo } = calculatePrices(newReserveYes, newReserveNo);

    await context.db.insert(priceHistory).values({
      id: `${marketId}-swap-${txHash}`,
      marketId,
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
  const { marketId, outcome } = event.args;

  await context.db.update(market, { id: marketId }).set({
    phase: 2,
    resolvedOutcome: outcome,
  });
});

/**
 * Phase2Resolved: CRE has processed phase 2 via onReport.
 * Update market so it is removed from /workflows/next-phase2 list.
 */
// Phase2Resolved fires in the same tx as MarketResolved (see _resolveMarket).
// MarketResolved already writes the correct resolvedOutcome — don't overwrite it.
ponder.on("MiniMarket:Phase2Resolved", async ({ event, context }) => {
  const { marketId } = event.args;
  await context.db.update(market, { id: marketId }).set({ phase: 2 });
});

ponder.on("MiniMarket:PenaltyCollected", async ({ event, context }) => {
  const { marketId, agent: agentAddr, penaltyAmount } = event.args;
  const txHash = event.transaction.hash;

  // PayoutClaimed fires before PenaltyCollected in the same tx, so the payout record exists.
  const payoutId = `${marketId}-${agentAddr}-${txHash}`;
  const payoutRecord = await context.db.find(payout, { id: payoutId });
  if (payoutRecord) {
    await context.db.update(payout, { id: payoutId }).set({
      penaltyAmount: BigInt(penaltyAmount),
    });

    // Compute penalty factor in bps: penaltyAmount / (agentPayout + penaltyAmount) * 10000
    const agentPayoutAmt = payoutRecord.amount;
    const fullPayout = agentPayoutAmt + BigInt(penaltyAmount);
    const factorBps = fullPayout > 0n ? (BigInt(penaltyAmount) * 10000n) / fullPayout : 0n;

    const agentMarketId = `${agentAddr}-${marketId}`;
    const agentMarketRecord = await context.db.find(agentMarket, { id: agentMarketId });
    if (agentMarketRecord) {
      await context.db.update(agentMarket, { id: agentMarketId }).set({
        penaltyFactor: factorBps,
      });
    }
  }

  // Accumulate total penalties received by creator for this market
  const marketRecord = await context.db.find(market, { id: marketId });
  if (marketRecord) {
    await context.db.update(market, { id: marketId }).set({
      totalPenaltyCollected: (marketRecord.totalPenaltyCollected ?? 0n) + BigInt(penaltyAmount),
    });
  }
});

ponder.on("MiniMarket:PayoutClaimed", async ({ event, context }) => {
  const { marketId, agent: agentAddr, amount } = event.args;
  const timestamp = BigInt(event.block.timestamp);
  const txHash = event.transaction.hash;

  await context.db.insert(payout).values({
    id: `${marketId}-${agentAddr}-${txHash}`,
    marketId,
    agent: agentAddr,
    amount: BigInt(amount),
    timestamp,
    txHash,
  });

  const agentMarketId = `${agentAddr}-${marketId}`;
  const agentMarketRecord = await context.db.find(agentMarket, { id: agentMarketId });
  const marketRecord = await context.db.find(market, { id: marketId });
  
  if (agentMarketRecord && marketRecord) {
    const yesShares = agentMarketRecord.yesShares ?? 0n;
    const noShares = agentMarketRecord.noShares ?? 0n;
    const totalShares = yesShares + noShares;

    // confidenceScore: winning_shares / total_shares * 10000 bps
    let winningShares = 0n;
    if (marketRecord.resolvedOutcome === 1) winningShares = yesShares; // YES won
    else if (marketRecord.resolvedOutcome === 2) winningShares = noShares; // NO won
    const confidenceScore = totalShares > 0n ? (winningShares * 10000n) / totalShares : 0n;

    // wasCorrect: majority of shares on winning side
    const wasCorrect =
      marketRecord.resolvedOutcome === 1
        ? yesShares > noShares
        : marketRecord.resolvedOutcome === 2
          ? noShares > yesShares
          : null;

    await context.db.update(agentMarket, { id: agentMarketId }).set({
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
  const { orderId, maker, marketId, sellYes, amount, price } = event.args;
  await context.db.insert(order).values({
    id: orderId.toString(),
    orderId,
    marketId,
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
