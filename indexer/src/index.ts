import { ponder } from "ponder:registry";
import { market, submarket, submission, agent, agentMarket, agentSubmarket, agentLabelReputation, marketParticipant, swap, payout, priceHistory, order } from "ponder:schema";
import { keccak256, encodeAbiParameters, parseAbiParameters } from "viem";

const PRECISION = 1_000_000_000_000_000_000n;

// ---------------------------------------------------------------------------
// IPFS helpers — fetch per-agent share data from leavesURI
// ---------------------------------------------------------------------------

function extractIpfsCid(uri: string): string | null {
  const ipfs = uri.match(/^ipfs:\/\/(.+)$/);
  if (ipfs) return ipfs[1];
  const http = uri.match(/\/ipfs\/([a-zA-Z0-9]+)/);
  if (http) return http[1];
  return null;
}

async function fetchIpfsJson(uri: string, timeoutMs = 8000): Promise<unknown | null> {
  const cid = extractIpfsCid(uri);
  const urls = cid
    ? [uri, `https://ipfs.io/ipfs/${cid}`, `https://cloudflare-ipfs.com/ipfs/${cid}`]
    : [uri];
  for (const url of urls) {
    try {
      const controller = new AbortController();
      const t = setTimeout(() => controller.abort(), timeoutMs);
      const res = await fetch(url, { signal: controller.signal });
      clearTimeout(t);
      if (res.ok) return await res.json();
    } catch { /* try next */ }
  }
  return null;
}

// PGLite string serializer only accepts string|number. Ensure hex/address values are plain strings.
function toHex(v: unknown): string {
  if (v == null) return "";
  const s = String(v);
  const hex = s.startsWith("0x") ? s : `0x${s}`;
  return hex.toLowerCase();
}
function toStr(v: unknown): string {
  if (v == null) return "";
  if (typeof v === "bigint") return v.toString();
  return String(v);
}

function calculatePrices(reserveYes: bigint, reserveNo: bigint): { priceYes: bigint; priceNo: bigint } {
  const totalReserve = reserveYes + reserveNo;
  if (totalReserve === 0n) {
    return { priceYes: PRECISION / 2n, priceNo: PRECISION / 2n };
  }
  // CRE semantics: reserveYes = allocation for YES outcome, reserveNo = allocation for NO.
  // So priceYes = reserveYes/total (probability of YES), not reserveNo/total.
  const priceYes = (reserveYes * PRECISION) / totalReserve;
  const priceNo = (reserveNo * PRECISION) / totalReserve;
  return { priceYes, priceNo };
}

// ---------------------------------------------------------------------------
// Parent-market events (uint256 marketId)
// ---------------------------------------------------------------------------

ponder.on("MiniMarket:MarketCreated", async ({ event, context }) => {
  const { marketId, question, schemaJson, maxSlots, ticketCost, drandTargetRound, creatorOffer, optionCount } = event.args;

  const marketCap = maxSlots * ticketCost;
  const drandChainHash = "0x0000000000000000000000000000000000000000000000000000000000000000";
  const tradingDuration = 300n;

  let marketLabel: string | null = null;
  let schemaOptions: Array<{ index: number; label: string }> = [];
  if (schemaJson) {
    try {
      const parsed = JSON.parse(schemaJson);
      if (typeof parsed.label === "string" && parsed.label) marketLabel = parsed.label;
      if (Array.isArray(parsed.options)) {
        schemaOptions = parsed.options.filter(
          (o: unknown) => o && typeof (o as { index: unknown }).index === "number"
        );
      }
    } catch {}
  }

  const effectiveOptionCount = Number(optionCount) > 1 ? Number(optionCount) : 1;

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
      creator: toHex(event.transaction.from),
      creatorOffer: BigInt(creatorOffer),
      optionCount: effectiveOptionCount,
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
      creator: toHex(event.transaction.from),
      creatorOffer: BigInt(creatorOffer),
      optionCount: effectiveOptionCount,
    });

  // Create submarket stubs so the indexer has records before SubmarketCreated events arrive.
  // Labels are populated from schemaJson.options when available.
  for (let i = 0; i < effectiveOptionCount; i++) {
    const smId = toHex(keccak256(encodeAbiParameters(
      parseAbiParameters("uint256, uint256"),
      [BigInt(marketId), BigInt(i)]
    )));
    const label = schemaOptions.find((o) => o.index === i)?.label ?? null;
    await context.db
      .insert(submarket)
      .values({
        id: smId,
        parentMarketId: BigInt(marketId),
        optionIndex: i,
        optionLabel: label,
        phase: 0,
        createdAt: BigInt(event.block.timestamp),
      })
      .onConflictDoUpdate({
        // Only update label if we have one (don't overwrite real labels with null)
        ...(label ? { optionLabel: label } : {}),
      });
  }
});

ponder.on("MiniMarket:SubmarketCreated", async ({ event, context }) => {
  const { parentMarketId, submarketId, optionIndex, optionLabel } = event.args;
  const labelValue = optionLabel || null;

  await context.db
    .insert(submarket)
    .values({
      id: toHex(submarketId),
      parentMarketId,
      optionIndex,
      optionLabel: labelValue,
      phase: 0,
      createdAt: BigInt(event.block.timestamp),
    })
    .onConflictDoUpdate({
      // Only update label if the incoming label is non-empty (don't overwrite a real label with empty)
      ...(labelValue ? { optionLabel: labelValue } : {}),
    });

  // Update optionCount on parent market
  const marketRecord = await context.db.find(market, { id: parentMarketId });
  if (marketRecord) {
    const newCount = Math.max(marketRecord.optionCount ?? 1, Number(optionIndex) + 1);
    await context.db.update(market, { id: parentMarketId }).set({ optionCount: newCount });
  }
});

ponder.on("MiniMarket:EncryptedSubmissionReceived", async ({ event, context }) => {
  const { marketId, agent: agentAddr, validationHash, targetRound, ciphertext } = event.args;
  const timestamp = BigInt(event.block.timestamp);
  const txHash = event.transaction.hash;

  await context.db.insert(submission).values({
    id: `${toStr(marketId)}-${toHex(agentAddr)}-${toHex(txHash)}`,
    marketId,
    agent: toHex(agentAddr),
    ciphertext: ciphertext && ciphertext.length > 2 ? ciphertext : "",
    validationHash: toHex(validationHash),
    targetRound: BigInt(targetRound),
    timestamp,
    txHash: toHex(txHash),
  });

  const marketRecord = await context.db.find(market, { id: marketId });
  const ticketCost = marketRecord?.ticketCost ?? 0n;
  const effectiveOptionCount = marketRecord?.optionCount ? BigInt(Math.max(1, marketRecord.optionCount)) : 1n;
  const totalCost = ticketCost * effectiveOptionCount;

  const agentRecord = await context.db.find(agent, { id: toHex(agentAddr) });

  if (!agentRecord) {
    await context.db.insert(agent).values({
      id: toHex(agentAddr),
      totalSubmissions: 1n,
      totalMarketsParticipated: 1n,
      totalStaked: totalCost,
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
    await context.db.update(agent, { id: toHex(agentAddr) }).set({
      totalSubmissions: agentRecord.totalSubmissions + 1n,
      totalStaked: agentRecord.totalStaked + totalCost,
      lastActiveAt: timestamp,
    });
  }

  const agentMarketId = `${toHex(agentAddr)}-${toStr(marketId)}`;
  const agentMarketRecord = await context.db.find(agentMarket, { id: agentMarketId });

  if (!agentMarketRecord) {
    await context.db.insert(agentMarket).values({
      id: agentMarketId,
      agent: toHex(agentAddr),
      marketId,
      participated: true,
    });

    if (agentRecord) {
      await context.db.update(agent, { id: toHex(agentAddr) }).set({
        totalMarketsParticipated: agentRecord.totalMarketsParticipated + 1n,
      });
    }

    // Track agent in sequential participant list so MarketResolved can iterate them
    const participantIndex = Number(marketRecord?.totalParticipants ?? 0);
    await context.db.insert(marketParticipant).values({
      id: `${toStr(marketId)}-${participantIndex}`,
      marketId: BigInt(marketId),
      agent: toHex(agentAddr),
    });

    // Eagerly create agentSubmarket stubs for all options so MarketResolved can find them
    const effectiveOptionCount = marketRecord?.optionCount ?? 1;
    for (let i = 0; i < effectiveOptionCount; i++) {
      const smId = toHex(keccak256(encodeAbiParameters(
        parseAbiParameters("uint256, uint256"),
        [BigInt(marketId), BigInt(i)]
      )));
      const agentSubmarketId = `${toHex(agentAddr)}-${smId}`;
      await context.db
        .insert(agentSubmarket)
        .values({
          id: agentSubmarketId,
          agent: toHex(agentAddr),
          submarketId: smId,
          parentMarketId: BigInt(marketId),
          optionIndex: i,
          yesShares: 0n,
          noShares: 0n,
          claimedShares: false,
        })
        .onConflictDoNothing();
    }

    // Increment totalParticipants only for unique agents (not repeated submissions)
    if (marketRecord) {
      await context.db.update(market, { id: marketId }).set({
        totalParticipants: marketRecord.totalParticipants + 1n,
      });
    }
  }

  // Track per-label staked amount for domain reputation
  const marketLabel = marketRecord?.label ?? null;
  if (marketLabel && totalCost > 0n) {
    const labelRepId = `${toHex(agentAddr)}-${marketLabel}`;
    const labelRepRecord = await context.db.find(agentLabelReputation, { id: labelRepId });
    if (!labelRepRecord) {
      await context.db.insert(agentLabelReputation).values({
        id: labelRepId,
        agent: toHex(agentAddr),
        label: marketLabel,
        reputation: 0n,
        totalPredictions: 0n,
        correctPredictions: 0n,
        totalWinnings: 0n,
        totalStaked: totalCost,
      });
    } else {
      await context.db.update(agentLabelReputation, { id: labelRepId }).set({
        totalStaked: labelRepRecord.totalStaked + totalCost,
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
      id: toHex(submarketId),
      parentMarketId: 0n, // will be set by SubmarketCreated; update below if record exists
      optionIndex: 0,
      phase: 1,
      merkleRoot: merkleRoot ? toHex(merkleRoot) : null,
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
      merkleRoot: merkleRoot ? toHex(merkleRoot) : null,
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
  const submarketRecord = await context.db.find(submarket, { id: toHex(submarketId) });
  await context.db.insert(priceHistory).values({
    id: `${toHex(submarketId)}-reveal-${toHex(event.transaction.hash)}`,
    submarketId: toHex(submarketId),
    parentMarketId: submarketRecord?.parentMarketId ?? 0n,
    timestamp: BigInt(event.block.timestamp),
    priceYes,
    priceNo,
    reserveYes: BigInt(totalReserveYes),
    reserveNo: BigInt(totalReserveNo),
    eventType: "reveal",
    txHash: toHex(event.transaction.hash),
  });

  // Fetch per-agent share data from IPFS leavesURI so we have real shares
  // without agents needing to call claimShares on-chain.
  if (leavesURI && submarketRecord) {
    const sid = toHex(submarketId);
    const optIdx = submarketRecord.optionIndex ?? 0;
    try {
      const raw = await fetchIpfsJson(leavesURI);
      if (raw && typeof raw === "object") {
        // Format: { marketId, submarkets: [{index, leaves: [{agent, yesShares, noShares}]}] }
        // or older: { marketId, leaves: [{agent, yesShares, noShares}] }  (single-submarket)
        type Leaf = { agent: string; yesShares: string; noShares: string };
        type SubmarketEntry = { index: number; leaves: Leaf[] };
        const data = raw as { submarkets?: SubmarketEntry[]; leaves?: Leaf[] };
        const leaves: Leaf[] | undefined =
          data.submarkets?.find((s) => s.index === optIdx)?.leaves ?? (optIdx === 0 ? data.leaves : undefined);
        if (leaves) {
          for (const leaf of leaves) {
            const aaddr = toHex(leaf.agent);
            const yesShares = BigInt(leaf.yesShares ?? 0);
            const noShares = BigInt(leaf.noShares ?? 0);
            if (yesShares === 0n && noShares === 0n) continue;
            const asmId = `${aaddr}-${sid}`;
            const existing = await context.db.find(agentSubmarket, { id: asmId });
            if (existing) {
              await context.db.update(agentSubmarket, { id: asmId }).set({ yesShares, noShares });
            } else {
              await context.db.insert(agentSubmarket).values({
                id: asmId,
                agent: aaddr,
                submarketId: sid,
                parentMarketId: submarketRecord.parentMarketId,
                optionIndex: optIdx,
                yesShares,
                noShares,
                claimedShares: false,
              }).onConflictDoUpdate({ yesShares, noShares });
            }
          }
        }
      }
    } catch { /* IPFS unavailable — fall back to approximation in MarketResolved */ }
  }
});

/**
 * Phase1Resolved: CRE has processed phase 1 (reveal) via revealInfoPhase.
 */
ponder.on("MiniMarket:Phase1Resolved", async ({ event, context }) => {
  const { submarketId } = event.args;
  const sid = toHex(submarketId);
  const existing = await context.db.find(submarket, { id: sid });
  if (existing) {
    await context.db.update(submarket, { id: sid }).set({ phase: 1 });
    // Increment phase1RevealedCount on the parent market so next-phase1 can filter reliably
    const parentMkt = await context.db.find(market, { id: existing.parentMarketId });
    if (parentMkt) {
      await context.db.update(market, { id: existing.parentMarketId }).set({
        phase1RevealedCount: (parentMkt.phase1RevealedCount ?? 0) + 1,
      });
    }
  }
});

ponder.on("MiniMarket:SharesClaimed", async ({ event, context }) => {
  const { submarketId, agent: agentAddr, yesShares, noShares } = event.args;
  const timestamp = BigInt(event.block.timestamp);
  const totalShares = BigInt(yesShares) + BigInt(noShares);
  const sid = toHex(submarketId);
  const aaddr = toHex(agentAddr);

  // One event per claim; add to totals (no double-count — contract emits once per claimShares call)
  const submarketRecord = await context.db.find(submarket, { id: sid });
  if (submarketRecord) {
    await context.db.update(submarket, { id: sid }).set({
      totalClaimedYes: (submarketRecord.totalClaimedYes ?? 0n) + BigInt(yesShares),
      totalClaimedNo: (submarketRecord.totalClaimedNo ?? 0n) + BigInt(noShares),
    });
  }

  const agentSubmarketId = `${aaddr}-${sid}`;
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
      agent: aaddr,
      submarketId: sid,
      parentMarketId: submarketRecord?.parentMarketId ?? 0n,
      optionIndex: submarketRecord?.optionIndex ?? 0,
      yesShares: BigInt(yesShares),
      noShares: BigInt(noShares),
      claimedShares: true,
    });
  }

  const agentRecord = await context.db.find(agent, { id: aaddr });
  if (agentRecord) {
    await context.db.update(agent, { id: aaddr }).set({
      totalSharesClaimed: agentRecord.totalSharesClaimed + totalShares,
      lastActiveAt: timestamp,
    });
  }
});

ponder.on("MiniMarket:SharesSwapped", async ({ event, context }) => {
  const { submarketId, agent: agentAddr, burnedOutcome, mintedOutcome, burnAmount, mintAmount } = event.args;
  const timestamp = BigInt(event.block.timestamp);
  const txHash = toHex(event.transaction.hash);
  const sid = toHex(submarketId);
  const aaddr = toHex(agentAddr);

  const submarketRecord = await context.db.find(submarket, { id: sid });
  const parentMarketId = submarketRecord?.parentMarketId ?? 0n;

  await context.db.insert(swap).values({
    id: `${sid}-${aaddr}-${txHash}`,
    submarketId: sid,
    parentMarketId,
    agent: aaddr,
    burnedOutcome,
    mintedOutcome,
    burnAmount: BigInt(burnAmount),
    mintAmount: BigInt(mintAmount),
    timestamp,
    txHash,
  });

  const agentSubmarketId = `${aaddr}-${sid}`;
  const agentSubmarketRecord = await context.db.find(agentSubmarket, { id: agentSubmarketId });

  // Update agent's yesShares/noShares so MarketResolved can compute correct expectedPayout
  const burnAmt = BigInt(burnAmount);
  const mintAmt = BigInt(mintAmount);
  let newYes = agentSubmarketRecord?.yesShares ?? 0n;
  let newNo = agentSubmarketRecord?.noShares ?? 0n;
  if (burnedOutcome === 1) {
    newYes = newYes >= burnAmt ? newYes - burnAmt : 0n;
    newNo += mintAmt;
  } else {
    newNo = newNo >= burnAmt ? newNo - burnAmt : 0n;
    newYes += mintAmt;
  }

  if (agentSubmarketRecord) {
    await context.db.update(agentSubmarket, { id: agentSubmarketId }).set({
      totalSwaps: (agentSubmarketRecord.totalSwaps || 0n) + 1n,
      yesShares: newYes,
      noShares: newNo,
    });
  } else if (submarketRecord) {
    await context.db.insert(agentSubmarket).values({
      id: agentSubmarketId,
      agent: aaddr,
      submarketId: sid,
      parentMarketId,
      optionIndex: submarketRecord.optionIndex ?? 0,
      yesShares: newYes,
      noShares: newNo,
      claimedShares: false,
      totalSwaps: 1n,
    }).onConflictDoUpdate({
      yesShares: newYes,
      noShares: newNo,
    });
  }

  const agentRecord = await context.db.find(agent, { id: aaddr });
  if (agentRecord) {
    await context.db.update(agent, { id: aaddr }).set({
      totalSwaps: agentRecord.totalSwaps + 1n,
      lastActiveAt: timestamp,
    });
  }

  if (submarketRecord) {
    let newReserveYes = submarketRecord.reserveYes || 0n;
    let newReserveNo = submarketRecord.reserveNo || 0n;
    let newClaimedYes = submarketRecord.totalClaimedYes ?? 0n;
    let newClaimedNo = submarketRecord.totalClaimedNo ?? 0n;

    if (burnedOutcome === 1) {
      newReserveYes = newReserveYes + BigInt(burnAmount);
      newReserveNo = newReserveNo - BigInt(mintAmount);
      newClaimedYes = newClaimedYes >= burnAmt ? newClaimedYes - burnAmt : 0n;
      newClaimedNo += mintAmt;
    } else {
      newReserveNo = newReserveNo + BigInt(burnAmount);
      newReserveYes = newReserveYes - BigInt(mintAmount);
      newClaimedNo = newClaimedNo >= burnAmt ? newClaimedNo - burnAmt : 0n;
      newClaimedYes += mintAmt;
    }

    await context.db.update(submarket, { id: sid }).set({
      reserveYes: newReserveYes,
      reserveNo: newReserveNo,
      totalClaimedYes: newClaimedYes,
      totalClaimedNo: newClaimedNo,
    });

    const { priceYes, priceNo } = calculatePrices(newReserveYes, newReserveNo);

    await context.db.insert(priceHistory).values({
      id: `${sid}-swap-${txHash}`,
      submarketId: sid,
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
  const sid = toHex(submarketId);
  const timestamp = BigInt(event.block.timestamp);

  const submarketRec = await context.db.find(submarket, { id: sid });
  if (submarketRec) {
    await context.db.update(submarket, { id: sid }).set({ resolvedOutcome: outcome });
  }

  if (!submarketRec) return;

  const parentMarketId = submarketRec.parentMarketId;
  const mkt = await context.db.find(market, { id: parentMarketId });
  const nParticipants = Number(mkt?.totalParticipants ?? 0);
  if (nParticipants === 0) return;

  // Approximate confidence from submarket-level totals (majority of pool)
  const totalYes = submarketRec.totalYesShares ?? 0n;
  const totalNo = submarketRec.totalNoShares ?? 0n;
  const totalAll = totalYes + totalNo;
  const majorityTotal = totalYes >= totalNo ? totalYes : totalNo;
  const approxConf = totalAll > 0n ? (majorityTotal * 10000n) / totalAll : 5000n;
  // Whether the consensus matched the actual resolution
  const approxCorrect = submarketRec.consensusOutcome === outcome;
  const marketLabel = mkt?.label ?? null;

  // Compute expected payout for display (before agents claim). Same formula as contract claimPayout.
  // pool = ticketCost * nParticipants + creatorOffer (each participant paid ticketCost per submarket;
  // creator premium per submarket is split among winners proportionally to winning shares)
  const ticketCost = mkt?.ticketCost ?? 0n;
  const creatorOffer = mkt?.creatorOffer ?? 0n;
  const pool = ticketCost * BigInt(nParticipants) + creatorOffer;
  // Use totalClaimedYes/No (matches contract) — fallback to totalYesShares/No if not yet tracked
  const claimedYes = (submarketRec.totalClaimedYes ?? 0n) + (submarketRec.totalClaimedNo ?? 0n) > 0n
    ? (submarketRec.totalClaimedYes ?? 0n)
    : totalYes;
  const claimedNo = (submarketRec.totalClaimedYes ?? 0n) + (submarketRec.totalClaimedNo ?? 0n) > 0n
    ? (submarketRec.totalClaimedNo ?? 0n)
    : totalNo;
  const totalWinning = outcome === 1 ? claimedYes : claimedNo;

  // Fetch Phase 1 leaves to compute expected penalty (PENALTY-DISTRIBUTION formula)
  type Leaf = { agent: string; yesShares: string; noShares: string };
  type SubmarketEntry = { index: number; leaves: Leaf[] };
  let leavesByAgent = new Map<string, Leaf>();
  const leavesURI = submarketRec.leavesURI;
  const optIdx = submarketRec.optionIndex ?? 0;
  if (leavesURI) {
    try {
      const raw = await fetchIpfsJson(leavesURI);
      if (raw && typeof raw === "object") {
        const data = raw as { submarkets?: SubmarketEntry[]; leaves?: Leaf[] };
        const leaves: Leaf[] | undefined =
          data.submarkets?.find((s) => s.index === optIdx)?.leaves ?? (optIdx === 0 ? data.leaves : undefined);
        if (leaves) {
          for (const leaf of leaves) {
            leavesByAgent.set(toHex(leaf.agent), leaf);
          }
        }
      }
    } catch { /* IPFS unavailable */ }
  }

  let totalExpectedPenalty = 0n;

  for (let i = 0; i < nParticipants; i++) {
    const mpRec = await context.db.find(marketParticipant, { id: `${parentMarketId.toString()}-${i}` });
    if (!mpRec) continue;
    const aaddr = toHex(mpRec.agent);
    const agentSubmarketId = `${aaddr}-${sid}`;
    const asmRec = await context.db.find(agentSubmarket, { id: agentSubmarketId });
    if (!asmRec) continue;

    // Skip if already resolved (PayoutClaimed fired first — unlikely but possible)
    if (asmRec.wasCorrect !== null) continue;

    // Use actual per-agent shares if available, otherwise use submarket-level proxy
    const yesShares = asmRec.yesShares ?? 0n;
    const noShares = asmRec.noShares ?? 0n;
    const agentTotal = yesShares + noShares;
    let conf: bigint;
    let wasCorrect: boolean;
    let expectedPayout: bigint;
    if (agentTotal > 0n) {
      // Confidence = majority of position (max(yes,no)/total), not winning-share %
      const majorityShares = yesShares >= noShares ? yesShares : noShares;
      conf = (majorityShares * 10000n) / agentTotal;
      wasCorrect = outcome === 1 ? yesShares > noShares : noShares > yesShares;
      // Expected payout = (winningShares * pool) / totalWinning (contract formula, pre-penalty)
      const winningShares = outcome === 1 ? yesShares : noShares;
      expectedPayout =
        totalWinning > 0n && winningShares > 0n ? (winningShares * pool) / totalWinning : 0n;

      // Compute expected penalty from Phase 1 leaves (PENALTY-DISTRIBUTION formula)
      // MUST match contract + trade-and-phase2-simulator: wrongConfidence, penaltyFactorBps, penalty = fullPayout * factorBps / 10000
      let agentExpectedPenalty = 0n;
      const leaf = leavesByAgent.get(aaddr);
      if (leaf && totalWinning > 0n && winningShares > 0n) {
        const leafYes = BigInt(leaf.yesShares ?? 0);
        const leafNo = BigInt(leaf.noShares ?? 0);
        const leafTotal = leafYes + leafNo;
        if (leafTotal > 0n) {
          const yesRatioBp = Number((leafYes * 1000n) / leafTotal);
          const wrongConfidence = outcome === 1 ? 1000 - yesRatioBp : yesRatioBp;
          let penaltyFactorBps = 0;
          if (wrongConfidence > 550) {
            penaltyFactorBps = Math.round(((wrongConfidence - 550) / 450) * 10000);
            penaltyFactorBps = Math.min(10000, penaltyFactorBps);
          }
          const fullPayout = (winningShares * pool) / totalWinning;
          agentExpectedPenalty = (fullPayout * BigInt(penaltyFactorBps)) / 10000n;
          totalExpectedPenalty += agentExpectedPenalty;
        }
      }

      await context.db.update(agentSubmarket, { id: agentSubmarketId }).set({
        wasCorrect,
        confidenceScore: conf,
        expectedPayout,
        expectedPenalty: agentExpectedPenalty,
        resolvedStatsApplied: true,
      });
    } else {
      conf = approxConf;
      wasCorrect = approxCorrect;
      // No per-agent share data: approximate equal split of pool for winners, 0 for losers.
      // pool / nParticipants = ticketCost / optionCount → net P&L ≈ 0 for winners.
      expectedPayout = wasCorrect ? pool / BigInt(nParticipants) : 0n;

      await context.db.update(agentSubmarket, { id: agentSubmarketId }).set({
        wasCorrect,
        confidenceScore: conf,
        expectedPayout,
        resolvedStatsApplied: true,
      });
    }

    const agentRecord = await context.db.find(agent, { id: aaddr });
    if (agentRecord) {
      await context.db.update(agent, { id: aaddr }).set({
        totalResolvedMarkets: agentRecord.totalResolvedMarkets + 1n,
        totalConfidenceScore: agentRecord.totalConfidenceScore + conf,
        totalCorrectPredictions: wasCorrect
          ? agentRecord.totalCorrectPredictions + 1n
          : agentRecord.totalCorrectPredictions,
        lastActiveAt: timestamp,
      });
    }

    // Update per-label reputation
    if (marketLabel) {
      const labelRepId = `${aaddr}-${marketLabel}`;
      const labelRepRecord = await context.db.find(agentLabelReputation, { id: labelRepId });
      const reputationDelta = wasCorrect ? conf : -((10000n - conf) / 2n);
      if (!labelRepRecord) {
        await context.db.insert(agentLabelReputation).values({
          id: labelRepId,
          agent: aaddr,
          label: marketLabel,
          reputation: reputationDelta > 0n ? reputationDelta : 0n,
          totalPredictions: 1n,
          correctPredictions: wasCorrect ? 1n : 0n,
          totalWinnings: 0n,
          totalStaked: 0n,
        });
      } else {
        const newRep = labelRepRecord.reputation + reputationDelta;
        await context.db.update(agentLabelReputation, { id: labelRepId }).set({
          reputation: newRep < 0n ? 0n : newRep,
          totalPredictions: labelRepRecord.totalPredictions + 1n,
          correctPredictions: wasCorrect
            ? labelRepRecord.correctPredictions + 1n
            : labelRepRecord.correctPredictions,
        });
      }
    }
  }

  // When totalWinning==0 (everyone bet wrong), creator is entitled to full pool — store for display
  const creatorFallbackAmount = totalWinning === 0n ? pool : 0n;
  await context.db.update(submarket, { id: sid }).set({ totalExpectedPenalty, creatorFallbackAmount });
});

/**
 * Phase2Resolved: CRE has processed phase 2 via onReport.
 */
ponder.on("MiniMarket:Phase2Resolved", async ({ event, context }) => {
  const { submarketId } = event.args;
  const sid = toHex(submarketId);
  const existing = await context.db.find(submarket, { id: sid });
  if (existing) {
    await context.db.update(submarket, { id: sid }).set({ phase: 2 });
  }
});

ponder.on("MiniMarket:PenaltyCollected", async ({ event, context }) => {
  const { submarketId, agent: agentAddr, penaltyAmount } = event.args;
  const txHash = toHex(event.transaction.hash);
  const sid = toHex(submarketId);
  const aaddr = toHex(agentAddr);

  // PayoutClaimed fires before PenaltyCollected in the same tx
  const payoutId = `${sid}-${aaddr}-${txHash}`;
  const payoutRecord = await context.db.find(payout, { id: payoutId });
  if (payoutRecord) {
    await context.db.update(payout, { id: payoutId }).set({
      penaltyAmount: BigInt(penaltyAmount),
    });

    const agentPayoutAmt = payoutRecord.amount;
    const fullPayout = agentPayoutAmt + BigInt(penaltyAmount);
    const factorBps = fullPayout > 0n ? (BigInt(penaltyAmount) * 10000n) / fullPayout : 0n;

    const agentSubmarketId = `${aaddr}-${sid}`;
    const agentSubmarketRecord = await context.db.find(agentSubmarket, { id: agentSubmarketId });
    if (agentSubmarketRecord) {
      await context.db.update(agentSubmarket, { id: agentSubmarketId }).set({
        penaltyFactor: factorBps,
      });
    }
  }

  const submarketRecord = await context.db.find(submarket, { id: sid });
  if (submarketRecord) {
    await context.db.update(submarket, { id: sid }).set({
      totalPenaltyCollected: (submarketRecord.totalPenaltyCollected ?? 0n) + BigInt(penaltyAmount),
    });
  }
});

ponder.on("MiniMarket:CreatorFallbackClaimed", async ({ event, context }) => {
  const { submarketId } = event.args;
  const sid = toHex(submarketId);
  await context.db.update(submarket, { id: sid }).set({ creatorFallbackClaimed: true });
});

// One event per claim; totalPayout replaces expectedPayout for display (no double-count)
ponder.on("MiniMarket:PayoutClaimed", async ({ event, context }) => {
  const { submarketId, agent: agentAddr, amount } = event.args;
  const timestamp = BigInt(event.block.timestamp);
  const txHash = toHex(event.transaction.hash);
  const sid = toHex(submarketId);
  const aaddr = toHex(agentAddr);

  const submarketRecord = await context.db.find(submarket, { id: sid });
  const parentMarketId = submarketRecord?.parentMarketId ?? 0n;

  await context.db.insert(payout).values({
    id: `${sid}-${aaddr}-${txHash}`,
    submarketId: sid,
    parentMarketId,
    agent: aaddr,
    amount: BigInt(amount),
    timestamp,
    txHash,
  });

  const agentSubmarketId = `${aaddr}-${sid}`;
  let agentSubmarketRecord = await context.db.find(agentSubmarket, { id: agentSubmarketId });

  // Create agentSubmarket if it doesn't exist (SharesClaimed may not have fired if agent had no shares)
  if (!agentSubmarketRecord && submarketRecord) {
    await context.db.insert(agentSubmarket).values({
      id: agentSubmarketId,
      agent: aaddr,
      submarketId: sid,
      parentMarketId: submarketRecord.parentMarketId,
      optionIndex: submarketRecord.optionIndex,
      yesShares: 0n,
      noShares: 0n,
      claimedShares: false,
    });
    agentSubmarketRecord = await context.db.find(agentSubmarket, { id: agentSubmarketId });
  }

  // Compute accurate confidence and correctness from share data
  let wasCorrect: boolean | null = null;
  let confidenceScore = 0n;

  if (agentSubmarketRecord && submarketRecord) {
    const yesShares = agentSubmarketRecord.yesShares ?? 0n;
    const noShares = agentSubmarketRecord.noShares ?? 0n;
    const totalShares = yesShares + noShares;

    // Confidence = majority of position (max(yes,no)/total), not winning-share %
    const majorityShares = yesShares >= noShares ? yesShares : noShares;
    confidenceScore = totalShares > 0n ? (majorityShares * 10000n) / totalShares : 0n;

    wasCorrect =
      submarketRecord.resolvedOutcome === 1
        ? yesShares > noShares
        : submarketRecord.resolvedOutcome === 2
          ? noShares > yesShares
          : null;

    await context.db.update(agentSubmarket, { id: agentSubmarketId }).set({
      totalPayout: BigInt(amount),
      wasCorrect,
      confidenceScore,
      resolvedStatsApplied: false, // clear the flag — accurate stats now applied
    });
  }

  // If MarketResolved already applied approximate stats, undo them first to avoid double-counting
  let agentRecord = await context.db.find(agent, { id: aaddr });
  if (agentRecord && agentSubmarketRecord?.resolvedStatsApplied) {
    const approxConf = agentSubmarketRecord.confidenceScore ?? 0n;
    const approxCorrect = agentSubmarketRecord.wasCorrect ?? false;
    await context.db.update(agent, { id: aaddr }).set({
      totalResolvedMarkets: agentRecord.totalResolvedMarkets - 1n,
      totalConfidenceScore: agentRecord.totalConfidenceScore - approxConf,
      totalCorrectPredictions: approxCorrect
        ? agentRecord.totalCorrectPredictions - 1n
        : agentRecord.totalCorrectPredictions,
    });
    agentRecord = await context.db.find(agent, { id: aaddr });

    // Also undo per-label reputation from MarketResolved
    const parentMarketId = submarketRecord?.parentMarketId ?? 0n;
    const mkt = await context.db.find(market, { id: parentMarketId });
    const marketLabel = mkt?.label ?? null;
    if (marketLabel) {
      const labelRepId = `${aaddr}-${marketLabel}`;
      const labelRepRecord = await context.db.find(agentLabelReputation, { id: labelRepId });
      if (labelRepRecord) {
        const undoRepDelta = approxCorrect ? approxConf : -((10000n - approxConf) / 2n);
        const restoredRep = labelRepRecord.reputation - undoRepDelta;
        await context.db.update(agentLabelReputation, { id: labelRepId }).set({
          reputation: restoredRep < 0n ? 0n : restoredRep,
          totalPredictions: labelRepRecord.totalPredictions > 0n
            ? labelRepRecord.totalPredictions - 1n
            : 0n,
          correctPredictions: approxCorrect && labelRepRecord.correctPredictions > 0n
            ? labelRepRecord.correctPredictions - 1n
            : labelRepRecord.correctPredictions,
        });
      }
    }
  }

  // Apply accurate agent stats
  if (agentRecord) {
    await context.db.update(agent, { id: aaddr }).set({
      totalCorrectPredictions: wasCorrect === true
        ? agentRecord.totalCorrectPredictions + 1n
        : agentRecord.totalCorrectPredictions,
      totalConfidenceScore: agentRecord.totalConfidenceScore + confidenceScore,
      totalResolvedMarkets: agentRecord.totalResolvedMarkets + 1n,
      totalWinnings: agentRecord.totalWinnings + BigInt(amount),
      lastActiveAt: timestamp,
    });
  }

  // Update per-label domain reputation
  if (wasCorrect !== null && submarketRecord) {
    const marketRecord = await context.db.find(market, { id: parentMarketId });
    const marketLabel = marketRecord?.label;
    if (marketLabel) {
      const labelRepId = `${aaddr}-${marketLabel}`;
      const labelRepRecord = await context.db.find(agentLabelReputation, { id: labelRepId });

      const reputationDelta = wasCorrect
        ? confidenceScore
        : -((10000n - confidenceScore) / 2n);

      if (!labelRepRecord) {
        const initRep = reputationDelta > 0n ? reputationDelta : 0n;
        await context.db.insert(agentLabelReputation).values({
          id: labelRepId,
          agent: aaddr,
          label: marketLabel,
          reputation: initRep,
          totalPredictions: 1n,
          correctPredictions: wasCorrect ? 1n : 0n,
          totalWinnings: BigInt(amount),
          totalStaked: 0n,
        });
      } else {
        const newRep = labelRepRecord.reputation + reputationDelta;
        await context.db.update(agentLabelReputation, { id: labelRepId }).set({
          reputation: newRep < 0n ? 0n : newRep,
          totalPredictions: labelRepRecord.totalPredictions + 1n,
          correctPredictions: wasCorrect
            ? labelRepRecord.correctPredictions + 1n
            : labelRepRecord.correctPredictions,
          totalWinnings: labelRepRecord.totalWinnings + BigInt(amount),
        });
      }
    }
  }
});

// ---------------------------------------------------------------------------
// Orderbook events
// ---------------------------------------------------------------------------

ponder.on("OrderbookMarket:OrderPlaced", async ({ event, context }) => {
  const { orderId, maker, submarketId, sellYes, amount, price } = event.args;
  const sid = toHex(submarketId);

  const submarketRecord = await context.db.find(submarket, { id: sid });
  const parentMarketId = submarketRecord?.parentMarketId ?? 0n;

  await context.db.insert(order).values({
    id: toStr(orderId),
    orderId,
    submarketId: sid,
    parentMarketId,
    maker: toHex(maker),
    sellYes,
    amount,
    price,
    status: "open",
    timestamp: BigInt(event.block.timestamp),
    txHash: toHex(event.transaction.hash),
  });
});

ponder.on("OrderbookMarket:OrderCancelled", async ({ event, context }) => {
  const { orderId } = event.args;
  const oid = toStr(orderId);
  const existing = await context.db.find(order, { id: oid });
  if (existing) {
    await context.db.update(order, { id: oid }).set({ status: "cancelled" });
  }
});

ponder.on("OrderbookMarket:OrderFilled", async ({ event, context }) => {
  const { orderId, taker, sharesAmount, takerPaysAmount } = event.args;
  const oid = toStr(orderId);
  const existing = await context.db.find(order, { id: oid });
  if (existing) {
    await context.db.update(order, { id: oid }).set({
      status: "filled",
      taker: taker ? toHex(taker) : null,
      sharesAmount,
      takerPaysAmount,
    });

    // Update taker's agentSubmarket (maker is updated by SharesSwapped from same tx)
    if (taker) {
      const sid = toHex(existing.submarketId);
      const takerAddr = toHex(taker);
      const takerAsmId = `${takerAddr}-${sid}`;
      const takerAsm = await context.db.find(agentSubmarket, { id: takerAsmId });
      const submarketRec = await context.db.find(submarket, { id: sid });
      const sharesAmt = BigInt(sharesAmount);
      const paysAmt = BigInt(takerPaysAmount);

      let newYes = takerAsm?.yesShares ?? 0n;
      let newNo = takerAsm?.noShares ?? 0n;
      if (existing.sellYes) {
        newYes += sharesAmt;
        newNo = newNo >= paysAmt ? newNo - paysAmt : 0n;
      } else {
        newNo += sharesAmt;
        newYes = newYes >= paysAmt ? newYes - paysAmt : 0n;
      }

      if (takerAsm) {
        await context.db.update(agentSubmarket, { id: takerAsmId }).set({
          yesShares: newYes,
          noShares: newNo,
          totalSwaps: (takerAsm.totalSwaps ?? 0n) + 1n,
        });
      } else if (submarketRec) {
        await context.db.insert(agentSubmarket).values({
          id: takerAsmId,
          agent: takerAddr,
          submarketId: sid,
          parentMarketId: submarketRec.parentMarketId,
          optionIndex: submarketRec.optionIndex ?? 0,
          yesShares: newYes,
          noShares: newNo,
          claimedShares: true,
          totalSwaps: 1n,
        }).onConflictDoUpdate({ yesShares: newYes, noShares: newNo });
      }
    }
  }
});
