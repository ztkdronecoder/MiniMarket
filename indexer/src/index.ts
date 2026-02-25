import { ponder } from "ponder:registry";
import { market, submission, agent, agentMarket, swap, payout, priceHistory } from "ponder:schema";

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
  const { marketId, question, maxSlots, ticketCost, drandTargetRound } = event.args;

  let drandChainHash = "0x0000000000000000000000000000000000000000000000000000000000000000";
  let tradingDuration = 0n;
  let schemaJson: string | null = null;

  try {
    const config = await context.client.readContract({
      abi: context.contracts.MiniMarket.abi,
      address: context.contracts.MiniMarket.address,
      functionName: "configs",
      args: [marketId],
    });
    if (config) {
      const c = config as { drandChainHash?: string; tradingDuration?: bigint; schemaJson?: string };
      drandChainHash = c.drandChainHash ?? drandChainHash;
      tradingDuration = BigInt(c.tradingDuration ?? 0);
      schemaJson = c.schemaJson ?? null;
    }
  } catch {
    // Fallback to defaults if contract read fails
  }

  await context.db.insert(market).values({
    id: marketId,
    question,
    schema: schemaJson,
    maxSlots,
    ticketCost,
    marketCap: maxSlots * ticketCost,
    drandTargetRound: BigInt(drandTargetRound),
    drandChainHash,
    createdAt: BigInt(event.block.timestamp),
    tradingDuration,
    phase: 0,
    totalParticipants: 0n,
    creator: event.transaction.from,
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

  const agentRecord = await context.db.find(agent, { id: agentAddr });
  
  if (!agentRecord) {
    await context.db.insert(agent).values({
      id: agentAddr,
      totalSubmissions: 1n,
      totalMarketsParticipated: 1n,
      totalStaked: 0n,
      totalCorrectPredictions: 0n,
      totalWinnings: 0n,
      totalSharesClaimed: 0n,
      totalSwaps: 0n,
      reputation: 0n,
      firstSeenAt: timestamp,
      lastActiveAt: timestamp,
    });
  } else {
    await context.db.update(agent, { id: agentAddr }).set({
      totalSubmissions: agentRecord.totalSubmissions + 1n,
      lastActiveAt: timestamp,
    });
  }

  const marketRecord = await context.db.find(market, { id: marketId });
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

ponder.on("MiniMarket:InfoPhaseRevealed", async ({ event, context }) => {
  const { marketId, merkleRoot, consensusOutcome, totalReserveYes, totalReserveNo, validSubmissions: validSubs, leavesURI } = event.args;
  const timestamp = BigInt(event.block.timestamp);
  const txHash = event.transaction.hash;

  const reserveYes = BigInt(totalReserveYes);
  const reserveNo = BigInt(totalReserveNo);
  const { priceYes, priceNo } = calculatePrices(reserveYes, reserveNo);

  await context.db.update(market, { id: marketId }).set({
    phase: 1,
    merkleRoot,
    consensusOutcome,
    reserveYes,
    reserveNo,
    validSubmissions: BigInt(validSubs),
    leavesURI: leavesURI ?? null,
  });

  await context.db.insert(priceHistory).values({
    id: `${marketId}-reveal-${txHash}`,
    marketId,
    timestamp,
    priceYes,
    priceNo,
    reserveYes,
    reserveNo,
    eventType: "reveal",
    txHash,
  });
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
ponder.on("MiniMarket:Phase2Resolved", async ({ event, context }) => {
  const { marketId } = event.args;
  let resolvedOutcome = 0;
  try {
    const state = await context.client.readContract({
      abi: context.contracts.MiniMarket.abi,
      address: context.contracts.MiniMarket.address,
      functionName: "states",
      args: [marketId],
    });
    resolvedOutcome = (state as { resolvedOutcome?: number })?.resolvedOutcome ?? 0;
  } catch {
    // Fallback: use 0
  }
  await context.db.update(market, { id: marketId }).set({
    phase: 2,
    resolvedOutcome,
  });
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
    const wasCorrect =
      marketRecord.resolvedOutcome === 1
        ? yesShares > noShares
        : marketRecord.resolvedOutcome === 2
          ? noShares > yesShares
          : null;
    
    await context.db.update(agentMarket, { id: agentMarketId }).set({
      totalPayout: BigInt(amount),
      wasCorrect,
    });
    
    if (wasCorrect) {
      const agentRecord = await context.db.find(agent, { id: agentAddr });
      if (agentRecord) {
        await context.db.update(agent, { id: agentAddr }).set({
          totalCorrectPredictions: agentRecord.totalCorrectPredictions + 1n,
        });
      }
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
