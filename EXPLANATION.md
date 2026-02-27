# Penalty Distribution — Implementation Explanation

This document explains what was built, how the penalty math works, and walks through a complete end-to-end example with real numbers from the test suite.

---

## What Was Built

### The Problem

Before this change, `claimPayout` gave every winning shareholder a simple proportional payout:

```
payout = (myWinningShares / totalWinningShares) * totalLiquidity
```

This meant an agent who bet 90% YES but held some NO shares still collected full value on those NO shares — even though their prediction was badly wrong. The market creator who staked a premium got no compensation for the crowd's poor performance.

### The Solution

A **penalty system** that:

1. Looks at each agent's **original prediction** (from Phase 1 leaves)
2. Measures how confidently wrong they were
3. Reduces their payout proportionally, routing the withheld amount to the **market creator**

Agents who were uncertain (45–55% either side) or who predicted correctly pay no penalty. Only agents who were **confidently wrong** (> 55% on the losing side) are penalized.

---

## The Math

### Step 1 — Derive original bet from Phase 1 leaves

Phase 1 produces a merkle tree with one leaf per agent: `(agent, yesShares, noShares)`. These shares represent the agent's original prediction allocation. From them we approximate the original bet ratio:

```
yesRatioBp = floor(yesShares / (yesShares + noShares) × 1000)   → 0–1000 basis points
noRatioBp  = 1000 - yesRatioBp
```

This is an approximation (the allocation formula also weights by consensus proximity score), but it's close enough for penalty purposes, especially for agents who didn't trade heavily.

### Step 2 — Compute wrongConfidence

> "How much did this agent bet on the side that **lost**?"

```
if market resolved NO:  wrongConfidence = yesRatioBp   (they were betting on YES = loser)
if market resolved YES: wrongConfidence = noRatioBp    (they were betting on NO  = loser)
```

Range: 0–1000 basis points. 1000 = 100% bet on the losing side.

### Step 3 — Compute penalty factor

| wrongConfidence | meaning | penalty |
|---|---|---|
| 0–449 | bet correctly or at most 44.9% wrong | 0 |
| 450–550 | uncertainty zone (45–55% either side) | 0 |
| 551–1000 | confidently wrong (> 55% on losing side) | proportional |

Formula:
```
penaltyFactor = 0                              if wrongConfidence ≤ 550
penaltyFactor = (wrongConfidence - 550) / 450  if wrongConfidence > 550
```

This scales linearly: at wrongConfidence = 550 the factor is 0, at wrongConfidence = 1000 it is exactly 1.0 (full penalty — agent receives nothing).

On-chain this is stored as **0–10000 basis points** (integer, 10000 = full penalty).

### Step 4 — Apply to payout

```
fullPayout  = (winningShares / totalWinningShares) × totalLiquidity
agentPayout = fullPayout × (1 - penaltyFactor)
penalty     = fullPayout × penaltyFactor   →  sent to market creator
```

The base (`fullPayout`) uses **current on-chain shares** (post-trading). Only the **penalty factor** comes from the original prediction. So agents who traded into better positions aren't fully shielded — their penalty is still based on where they started.

---

## On-Chain Flow

```
Phase 1 (cre-workflow-simulator.ts)
  └─ Decrypt submissions → compute merkle tree → write phase1-output.json
  └─ Call revealInfoPhase() → agents call claimShares()

Phase 2 (trade-and-phase2-simulator.ts)
  └─ Fuzzy orderbook trades
  └─ Fast-forward time (trading deadline)
  └─ Read phase1-output.json leaves → compute penaltyFactorBps per agent
  └─ Call setPenaltyFactors(marketId, agents[], factors[])   ← CRE only
  └─ Call resolveMarket(marketId, outcome)                   ← CRE only
  └─ Each agent calls claimPayout(marketId)
       └─ Contract reads penaltyFactors[marketId][agent]
       └─ Computes agentPayout and penalty
       └─ Transfers agentPayout → agent
       └─ Transfers penalty    → configs[marketId].creator
       └─ Emits PayoutClaimed(marketId, agent, agentPayout)
       └─ Emits PenaltyCollected(marketId, agent, creator, penalty)
```

The contract function `setPenaltyFactors` is callable **only by the CRE forwarder** (same key that calls `resolveMarket`). Factors default to 0 if never set, so markets without the new workflow are unaffected.

---

## End-to-End Example: Real Test Data

The e2e test (`scripts/phase-1-test/script.sh`) creates a 5-agent market with these votes:

| Agent # | Vote (YES/NO bp) | Address (short) |
|---------|------------------|-----------------|
| 1 | 700 / 300 | `0xf39F...` |
| 2 | 200 / 800 | `0x7099...` |
| 3 | 500 / 500 | `0x3C44...` |
| 4 | 900 / 100 | `0x90F7...` |
| 5 | 100 / 900 | `0x9965...` |

Market params: 5 slots × 1 USDC ticket + 0.5 USDC creator offer = **5.5 USDC total deposited** by creator. Plus 5 × 1 USDC from participants = **10.5 USDC** in contract. The payout pool used in `claimPayout` = `ticketCost × submissionCount = 5 USDC` (creator offer was already paid out to CRE at Phase 1 reveal).

### Phase 1 Result

The CRE decrypts all votes, computes consensus. With votes 700, 200, 500, 900, 100 the mean is `(700+200+500+900+100)/5 = 480` → **consensus = NO** (< 500).

The scoring formula rewards agents closer to consensus. Phase 1 output (actual numbers from the last test run):

| Agent | yesShares | noShares |
|-------|-----------|----------|
| `0xf39F` | 1,547,619,047,619,047,619 | 610,647,181,628,392,484 |
| `0x7099` | 408,163,265,306,122,448 | 1,503,131,524,008,350,730 |
| `0x3C44` | 1,388,888,888,888,888,888 | 1,278,705,636,743,215,031 |
| `0x90F7` | 1,479,591,836,734,693,877 | 151,356,993,736,951,983 |
| `0x9965` | 175,736,961,451,247,165 | 1,456,158,663,883,089,770 |

All agents hold **some** NO shares (the winning side) and can claim a payout.

### Step 1: Derive yesRatioBp from leaves

```
0xf39F: yesRatioBp = floor(1,547,619... / (1,547,619... + 610,647...) × 1000)
                   = floor(1,547,619... / 2,158,266... × 1000)
                   ≈ floor(0.717 × 1000) = 717

0x7099: floor(408,163... / (408,163... + 1,503,131...) × 1000)
       ≈ floor(0.213 × 1000) = 213

0x3C44: floor(1,388,888... / (1,388,888... + 1,278,705...) × 1000)
       ≈ floor(0.520 × 1000) = 520

0x90F7: floor(1,479,591... / (1,479,591... + 151,356...) × 1000)
       ≈ floor(0.907 × 1000) = 907

0x9965: floor(175,736... / (175,736... + 1,456,158...) × 1000)
       ≈ floor(0.108 × 1000) = 108
```

### Step 2: Compute wrongConfidence (resolved = NO → losing side is YES)

```
wrongConfidence = yesRatioBp   (because NO won, betting YES was wrong)

0xf39F: wrongConfidence = 717
0x7099: wrongConfidence = 213
0x3C44: wrongConfidence = 520
0x90F7: wrongConfidence = 907
0x9965: wrongConfidence = 108
```

### Step 3: Compute penaltyFactor

| Agent | wrongConf | > 550? | formula | penaltyFactor | penaltyBps |
|-------|-----------|--------|---------|---------------|------------|
| `0xf39F` | 717 | YES | (717−550)/450 = 167/450 | 0.3711 | **3711** |
| `0x7099` | 213 | no  | — | 0 | 0 |
| `0x3C44` | 520 | no (uncertainty zone) | — | 0 | 0 |
| `0x90F7` | 907 | YES | (907−550)/450 = 357/450 | 0.7933 | **7933** |
| `0x9965` | 108 | no  | — | 0 | 0 |

Only agents **1** (`0xf39F`, originally voted 70% YES) and **4** (`0x90F7`, voted 90% YES) are penalized.
Agent 3 (`0x3C44`, voted 50/50) is in the **uncertainty zone** and pays no penalty.

### Step 4: Apply to payouts

Total payout pool = 5 USDC (5,000,000 µUSDC).
Winning outcome = NO. Total NO shares in the system ≈ 5 × 10^18 (sum of all agents' noShares).

For simplicity, assume shares are proportional to noShares (post-trade changes are tiny in the fuzzy test). Full proportional payout for each agent:

```
fullPayout(agent) = (agent.noShares / totalNoShares) × 5,000,000
```

Using approximate share fractions from the leaves (pre-trade):

| Agent | noShares (approx) | fraction | fullPayout (µUSDC) |
|-------|-------------------|----------|-------------------|
| `0xf39F` | 610,647... | ≈ 12.2% | ≈ 610,000 |
| `0x7099` | 1,503,131... | ≈ 30.1% | ≈ 1,503,000 |
| `0x3C44` | 1,278,705... | ≈ 25.6% | ≈ 1,278,000 |
| `0x90F7` | 151,356...  | ≈ 3.0%  | ≈ 151,000  |
| `0x9965` | 1,456,158... | ≈ 29.1% | ≈ 1,456,000 |
| **total** | | **≈ 100%** | **5,000,000** |

Apply penalty:

```
0xf39F:  penalty    = 610,000 × 0.3711 ≈ 226,371 µUSDC (= 0.226 USDC)
         agentPayout = 610,000 − 226,371 ≈ 383,629 µUSDC (= 0.384 USDC)

0x90F7:  penalty    = 151,000 × 0.7933 ≈ 119,788 µUSDC (= 0.120 USDC)
         agentPayout = 151,000 − 119,788 ≈  31,212 µUSDC (= 0.031 USDC)

0x7099:  agentPayout = 1,503,000 µUSDC (no penalty)
0x3C44:  agentPayout = 1,278,000 µUSDC (no penalty — uncertainty zone)
0x9965:  agentPayout = 1,456,000 µUSDC (no penalty)
```

**Creator receives:** 226,371 + 119,788 ≈ **346,159 µUSDC ≈ 0.346 USDC** in penalties.

Plus the creator already received their 0.5 USDC `creatorOffer` back at Phase 1 reveal. So in total the creator walks away with their offer returned plus a bonus from badly-wrong bettors.

---

## Key Design Decisions

### Why 45–55% is the uncertainty zone

An agent who splits 52/48 genuinely doesn't know which way the market will go. Penalizing them for holding a few extra YES shares when NO wins would be unfair. The zone is centered at 50% with ±5% tolerance.

The penalty threshold is at **55%** (not 50%), so only agents who were clearly leaning wrong get hit.

### Why wrongConfidence is based on original predictions, not post-trade shares

An agent who voted 90% YES can trade their way to a more balanced position by selling YES and buying NO during the trading phase. This is the intended behavior — the market lets agents update their positions. However, the penalty is computed from their **original sealed prediction**, not their final position.

This prevents gaming: you can't encrypt a bad prediction, collect Phase 1 shares, then trade into the other side to avoid the penalty. The CRE reads the leaves (which were sealed at Phase 1 reveal time) to compute the penalty before resolution.

### Why the penalty factor uses 0–10000 on-chain (not 0–1000)

Solidity has no floats. Storing the factor as 0–10000 gives 0.01% precision (e.g., factor 3711 = 37.11% penalty). This avoids rounding errors in the final payout calculation:

```solidity
penalty = (fullPayout * factorBps) / 10000;
```

### Why `setPenaltyFactors` is called before `resolveMarket`

The order doesn't matter mechanically (factors are only read at claim time), but calling penalties first is cleaner conceptually: the CRE is saying "here is my resolution data" before making the market immutably resolved.

### Why `PayoutClaimed` is emitted before `PenaltyCollected`

Ponder (the indexer) processes events in log order within a transaction. Since `PenaltyCollected` needs to update the payout record that `PayoutClaimed` creates, the claim event must be emitted first so the record exists when the penalty handler runs.

---

## Files Changed

| File | What changed |
|------|-------------|
| `PENALTY-DISTRIBUTION.md` | Full spec, now including chosen implementation (Option B) |
| `contracts/src/interfaces/IMarket.sol` | `creator` in `MarketConfig`; `PenaltyCollected` event; `setPenaltyFactors` |
| `contracts/src/MiniMarket.sol` | `penaltyFactors` mapping; `setPenaltyFactors`; `claimPayout` penalty logic; store `creator` at market creation; restored `swapShares` |
| `contracts/foundry.toml` | Added `via_ir = true` (required to avoid stack-too-deep after new locals) |
| `ts/src/market/abi.ts` | `setPenaltyFactors` and `PenaltyCollected` ABI entries |
| `indexer/abis/MiniMarket.json` | Synced from compiled output (includes all new entries) |
| `indexer/ponder.schema.ts` | `agentMarket.penaltyFactor`; `payout.penaltyAmount` |
| `indexer/src/index.ts` | `MiniMarket:PenaltyCollected` handler |
| `scripts/phase-1-test/trade-and-phase2-simulator.ts` | Full penalty computation, `setPenaltyFactors` call, summary table |
| `scripts/phase-1-test/script.sh` | `CREATOR_OFFER=500000`; updated comments |
