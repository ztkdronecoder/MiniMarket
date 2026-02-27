# Penalty Distribution Spec

## Human-Readable Recap

### The Idea in Plain Language

When a prediction market resolves, some participants bet mostly on the wrong outcome. For example, the market resolves **NO** (80% NO, 20% YES), but an agent bet **60% YES / 40% NO**. Their majority bet was wrong (YES), but they still hold 40% NO shares—the winning side—and would normally redeem them for full value.

The penalty system says: **if you were confidently wrong, you don't get full value for your winning shares.** The more wrong you were, the bigger the penalty. That penalty goes to the **creator** of the market.

**Why?** The creator stakes a premium. If the crowd predicts well, the premium flows to winners. If the crowd predicts poorly, the creator earns back some (or all) of the premium from wrong-side bettors. It aligns creator incentives with market quality.

**Uncertainty zone:** If you bet in the 45–55% range on either side, you're treated as "uncertain" and face **no penalty**. Only agents who were confidently wrong (> 55% on the losing side) get penalized.

---

## Formal Specification

### 1. Definitions

| Term | Definition |
|------|------------|
| **Creator premium** | Extra USDC the creator stakes at market creation (`creatorOffer`); paid to CRE at Phase 1 reveal |
| **Wrong-side bettor** | Agent whose original bet majority was on the losing outcome (e.g. 60% YES when NO won) |
| **Penalty** | Reduction applied to their winning-share payout; the withheld amount goes to the creator |
| **Uncertainty zone** | 45–55% on the losing side; agents in this range face no penalty |
| **Wrong confidence** | Agent's original bet share on the **losing** outcome, in basis points (0–1000) |
| **Penalty factor** | Scalar 0.0–1.0 representing the fraction of fullPayout withheld |

### 2. Original Bet Determination

The agent's original bet is derived from the **Phase 1 merkle leaves** (`phase1-output.json` / leavesURI):

```
yesRatio  = yesShares_leaf / (yesShares_leaf + noShares_leaf)   → 0.0 to 1.0
yesPercent = round(yesRatio * 1000)                              → 0 to 1000 (bp)
noPercent  = 1000 - yesPercent
```

This is an approximation (the allocation formula weights by score × percent, so the ratio is not exactly the original bid), but is accepted by this spec for agents who did not trade or who traded only small amounts.

### 3. Classification Rules

For each agent at resolution:

1. **Resolved outcome** = YES (1) or NO (2) from oracle.
2. **Wrong confidence** = the original bet share on the **losing** outcome:
   - If outcome = YES: `wrongConfidence = noPercent`
   - If outcome = NO:  `wrongConfidence = yesPercent`
3. **Penalized?** Only if `wrongConfidence > 550` (i.e. bet > 55% on the losing side).

### 4. Penalty Formula

```
penaltyFactor =
  if wrongConfidence ≤ 550: 0
  if wrongConfidence > 550: (wrongConfidence - 550) / 450   → 0.0 to 1.0

fullPayout    = (agentWinningShares / totalWinningShares) * totalLiquidity
agentPayout   = fullPayout * (1 - penaltyFactor)
penaltyAmount = fullPayout - agentPayout   → sent to market creator
```

`agentWinningShares` and `totalWinningShares` are the **current on-chain shares** (post-trading). Only the **penalty factor** uses the original prediction. The payout base uses current shares.

### 5. Chosen Implementation: Option B

**CRE stores penalty factors per agent on-chain before resolution.**

Contract additions:
- `mapping(uint256 marketId => mapping(address agent => uint256 factorBps)) public penaltyFactors`
  - Stored as 0–10000 (basis points where 10000 = 100% penalty; precision = 0.01%)
- `setPenaltyFactors(uint256 marketId, address[] agents, uint256[] factors)` — callable by CRE forwarder only
- `MarketConfig.creator` — address that receives penalty amounts at claim time
- Modified `claimPayout`: reads `penaltyFactors[marketId][msg.sender]`, applies reduction, routes `penaltyAmount` to `configs[marketId].creator`
- New event: `PenaltyCollected(uint256 indexed marketId, address indexed agent, address indexed creator, uint256 penaltyAmount)`

**Step sequence (Phase 2 workflow):**
1. CRE computes `wrongConfidence` for each agent from phase1 leaves.
2. CRE computes `penaltyFactorBps` (0–10000) for each agent.
3. CRE calls `setPenaltyFactors(marketId, agents[], factors[])` on-chain.
4. CRE calls `resolveMarket(marketId, outcome)`.
5. Each agent calls `claimPayout(marketId)` — contract applies stored factor automatically.

### 6. Data Flow

```
Phase 1 leaves (phase1-output.json)
  └── yesShares, noShares per agent
        └── yesRatio = yesShares / (yesShares + noShares)
              └── wrongConfidence (0–1000)
                    └── penaltyFactorBps (0–10000)
                          └── setPenaltyFactors() on-chain
                                └── claimPayout() applies factor → agent gets reduced payout
                                                               → creator gets penaltyAmount
```

### 7. Ponder Indexer Changes

- `payout` table: add `penaltyAmount bigint` field
- `agentMarket` table: add `penaltyFactor bigint` field (stores 0–10000)
- New handler `MiniMarket:PenaltyCollected`: updates `payout.penaltyAmount` and `agentMarket.penaltyFactor`

---

## Worked Example: 5 Agents, NO Wins (80/20)

**Setup:** Market resolves **NO**. Total liquidity = 1000 USDC. Five participants.

| Agent | Original bet (YES/NO) | Winning (NO) shares | Full proportional payout |
|-------|------------------------|---------------------|--------------------------|
| A     | 90% / 10%              | 10% of total        | 100                      |
| B     | 60% / 40%              | 40% of total        | 80 (note: uses current shares) |
| C     | 50% / 50%              | 50% of total        | 200                      |
| D     | 30% / 70%              | 70% of total        | 350                      |
| E     | 10% / 90%              | 90% of total        | 270                      |

**Classification (wrongConfidence = yesPercent when NO wins):**

| Agent | yesPercent | wrongConfidence | > 550? | penaltyFactor | penaltyFactorBps |
|-------|------------|-----------------|--------|---------------|-----------------|
| A     | 900        | 900             | Yes    | (900-550)/450 ≈ 0.778 | 7778 |
| B     | 600        | 600             | Yes    | (600-550)/450 ≈ 0.111 | 1111 |
| C     | 500        | 500             | No     | 0             | 0    |
| D     | 300        | 300             | No     | 0             | 0    |
| E     | 100        | 100             | No     | 0             | 0    |

**Payout calculation:**

| Agent | Full payout | penaltyFactor | agentPayout | penaltyAmount (→ creator) |
|-------|-------------|---------------|-------------|---------------------------|
| A     | 100         | 0.778         | 22          | 78                        |
| B     | 80          | 0.111         | 71          | 9                         |
| C     | 200         | 0             | 200         | 0                         |
| D     | 350         | 0             | 350         | 0                         |
| E     | 270         | 0             | 270         | 0                         |

**Creator receives:** 78 + 9 = **87 USDC** in penalties.

---

## Implementation Notes

- All penalty computation happens in the **Phase 2 TypeScript simulator** (`trade-and-phase2-simulator.ts`).
- Penalty factors are set on-chain via `setPenaltyFactors` before resolution.
- The contract's `claimPayout` reads the stored factor and routes penalty to creator automatically.
- `penaltyFactors` default to 0 (no penalty) if never set — backward compatible.
- Creator address is stored in `MarketConfig.creator` = `msg.sender` at `createMarket` time.
- `totalLiquidity` at claim time = `ticketCost * submissionCount` (creatorOffer already distributed at Phase 1).
