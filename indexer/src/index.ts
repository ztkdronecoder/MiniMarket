import { ponder } from "ponder:registry";
import { market, submission, agent, agentMarket, swap, payout } from "ponder:schema";

ponder.on("MiniMarket:MarketCreated", async ({ event, context }) => {
  const { marketId, question, maxSlots, ticketCost, drandTargetRound } = event.args;
  
  await context.db.insert(market).values({
    id: marketId,
    question,
    paymentToken: "0x0000000000000000000000000000000000000000",
    maxSlots,
    ticketCost,
    marketCap: maxSlots * ticketCost,
    drandTargetRound: BigInt(drandTargetRound),
    drandChainHash: "0x0000000000000000000000000000000000000000000000000000000000000000",
    createdAt: BigInt(event.block.timestamp),
    tradingDuration: 0n,
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
  const { marketId, merkleRoot, consensusOutcome, totalReserveYes, totalReserveNo, validSubmissions: validSubs } = event.args;

  await context.db.update(market, { id: marketId }).set({
    phase: 1,
    merkleRoot,
    consensusOutcome,
    reserveYes: BigInt(totalReserveYes),
    reserveNo: BigInt(totalReserveNo),
    validSubmissions: BigInt(validSubs),
  });
});

ponder.on("MiniMarket:SharesClaimed", async ({ event, context }) => {
  const { marketId, agent: agentAddr, outcome, shares } = event.args;
  const timestamp = BigInt(event.block.timestamp);

  const agentMarketId = `${agentAddr}-${marketId}`;
  const agentMarketRecord = await context.db.find(agentMarket, { id: agentMarketId });
  
  if (agentMarketRecord) {
    await context.db.update(agentMarket, { id: agentMarketId }).set({
      predictedOutcome: outcome,
      allocatedShares: BigInt(shares),
      claimedShares: true,
    });
  }

  const agentRecord = await context.db.find(agent, { id: agentAddr });
  if (agentRecord) {
    await context.db.update(agent, { id: agentAddr }).set({
      totalSharesClaimed: agentRecord.totalSharesClaimed + BigInt(shares),
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
});

ponder.on("MiniMarket:MarketResolved", async ({ event, context }) => {
  const { marketId, outcome } = event.args;

  await context.db.update(market, { id: marketId }).set({
    phase: 2,
    resolvedOutcome: outcome,
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
    const wasCorrect = marketRecord.resolvedOutcome === agentMarketRecord.predictedOutcome;
    
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
