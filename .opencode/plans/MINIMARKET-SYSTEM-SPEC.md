# MiniMarket — System Specification (OpenCode / Claude Code)

**Complete documentation** of the MiniMarket contract, Ponder indexer, and Chainlink CRE Phase 1 and Phase 2 workflows. Use as reference for OpenCode, Claude Code, and development.

---

## Table of Contents

1. [General Architecture](#1-general-architecture)
2. [MiniMarket Contract](#2-minimarket-contract)
3. [Ponder Indexer](#3-ponder-indexer)
4. [Chainlink CRE Phase 1 Workflow](#4-chainlink-cre-phase-1-workflow)
5. [Chainlink CRE Phase 2 Workflow](#5-chainlink-cre-phase-2-workflow)
6. [End-to-End Integration](#6-end-to-end-integration)
7. [Quick Reference](#7-quick-reference)
8. [OrderbookMarket](#8-orderbookmarket)

---

## 1. General Architecture

### Protocol Flow

```
┌─────────────────────────────────────────────────────────────────────────────────────────┐
│                              MINIMARKET PROTOCOL                                         │
├─────────────────────────────────────────────────────────────────────────────────────────┤
│                                                                                          │
│  PHASE 0: INFO_COLLECTION          PHASE 1: TRADING              PHASE 2: RESOLVED       │
│  ───────────────────────           ─────────────────             ─────────────────       │
│                                                                                          │
│  Creator creates market            CRE Phase 1 workflow          CRE Phase 2 workflow      │
│  with schemaJson onchain           decrypts submissions         resolves with schema     │
│         │                          via drand beacon              + Gemini                 │
│         ▼                                  │                            │                │
│  Agents submit                     revealInfoPhase()            resolveMarket()         │
│  encrypted predictions                    │                            │                │
│  (drand timelock)                         ▼                            ▼                │
│         │                          Agents claimShares            Winners claimPayout    │
│         │                          + OrderbookMarket (place/take) or swapShares (AMM)    │
│         │                                  │                                               │
│         └──────────────────────────────────┴───────────────────────────────────────────────┤
│                                            │                                               │
│                                            ▼                                               │
│                              ┌─────────────────────────────┐                              │
│                              │   PONDER (Indexer)           │                              │
│                              │   /workflows/next-phase1     │                              │
│                              │   /workflows/next-phase2     │                              │
│                              └─────────────────────────────┘                              │
└─────────────────────────────────────────────────────────────────────────────────────────┘
```

### Components

| Component | Path | Role |
|-----------|------|------|
| **MiniMarket** | `contracts/src/MiniMarket.sol` | Onchain logic, events, `onReport` for CRE |
| **OrderbookMarket** | `contracts/src/OrderbookMarket.sol` | P2P orderbook YES↔NO, Phase 1 participants only |
| **Indexer** | `indexer/` | Indexes events, exposes REST API for workflows |
| **Phase 1 Workflow** | `workflows/phase-1/phase-1/` | Decrypt drand, merkle tree, `revealInfoPhase` |
| **Phase 2 Workflow** | `workflows/phase-2/phase-2/` | Resolve with Gemini, `resolveMarket` |

---

## 2. MiniMarket Contract

### 2.1 Data Structures

#### MarketConfig

```solidity
struct MarketConfig {
    uint256 marketId;
    string question;
    string schemaJson;        // Resolution JSON schema (onchain)
    uint256 maxSlots;
    uint256 ticketCost;       // USDC (6 decimals)
    uint256 marketCap;
    uint64 drandTargetRound;   // Drand round for reveal
    bytes32 drandChainHash;
    uint48 createdAt;
    uint48 tradingDuration;   // Trading seconds
}
```

All payments use USDC (immutable `USDC` address set at deployment).

#### MarketState

```solidity
struct MarketState {
    MarketPhase phase;        // 0=INFO_COLLECTION, 1=TRADING, 2=RESOLVED
    bytes32 merkleRoot;
    Outcome consensusOutcome;
    uint128 reserveYes;
    uint128 reserveNo;
    uint128 totalClaimedYes;
    uint128 totalClaimedNo;
    Outcome resolvedOutcome;
    uint128 totalYesShares;
    uint128 totalNoShares;
    string leavesURI;         // URI merkle leaves (IPFS, etc.)
}
```

#### EncryptedSubmission

```solidity
struct EncryptedSubmission {
    address agent;
    bytes ciphertext;         // Timelock encrypted (agent, yesPercent, noPercent, salt)
    bytes32 validationHash;   // keccak256(agent, yesPercent, noPercent, salt)
    uint64 targetRound;
}
```

#### MerkleProof (for claimShares)

```solidity
struct MerkleProof {
    bytes32 root;
    bytes32[] proof;
    uint256 index;
    address agent;
    uint256 yesShares;
    uint256 noShares;
}
```

**Leaf hash:** `keccak256(abi.encodePacked(agent, yesShares, noShares))`

---

### 2.2 Public Functions

| Function | Phase | Caller | Description |
|----------|------|--------|-------------|
| `createMarket(...)` | — | Creator | Create market, deposit marketCap |
| `submitEncrypted(marketId, ciphertext, validationHash)` | INFO_COLLECTION | Agent | Submit encrypted prediction |
| `requestInfoReveal(marketId)` | INFO_COLLECTION | Anyone | Emit InfoRevealRequested (optional) |
| `revealInfoPhase(...)` | — | CRE Forwarder | Reveal merkle root, reserves (or via onReport) |
| `claimShares(marketId, proof)` | TRADING | Agent | Claim shares via merkle proof |
| `swapShares(marketId, burnOutcome, burnAmount)` | TRADING | Agent | Swap YES↔NO on AMM |
| `requestResolution(marketId)` | TRADING | Anyone | Emit ResolutionRequested (optional) |
| `resolveMarket(marketId, outcome)` | — | CRE Forwarder | Resolve market (or via onReport) |
| `claimPayout(marketId)` | RESOLVED | Agent | Claim payout for winning shares |

---

### 2.3 onReport (Chainlink CRE)

The contract implements `IReceiver`. The CRE Forwarder sends ABI-encoded reports. The first byte of the payload (offset 31) is the **selector**:

| Selector | Action | Payload ABI |
|----------|--------|-------------|
| `0` | Phase 1 reveal | `(uint8, uint256 marketId, bytes32 merkleRoot, uint8 consensus, uint128 reserveYes, uint128 reserveNo, uint256 validSubmissions, uint128 totalYesShares, uint128 totalNoShares, string leavesURI)` |
| `1` | Phase 2 resolve | `(uint8, uint256 marketId, uint8 outcome)` |

**Events emitted by onReport:**

```solidity
event Phase1Resolved(uint256 indexed marketId);  // After _revealInfoPhase
event Phase2Resolved(uint256 indexed marketId);  // After _resolveMarket
```

These events signal that the CRE has completed work; Ponder uses them to update state and remove the market from pending lists.

---

### 2.4 Drand Constants

```solidity
bytes32 DRAND_QUICKNET_HASH = 0x52db9ba70e0cc0f6eaf7803dd07447a1f5477735fd3f661792ba94600c84e971;
uint64 DRAND_GENESIS = 1692803367;
uint64 DRAND_PERIOD = 3;

// Current round
currentRound = (block.timestamp - DRAND_GENESIS) / DRAND_PERIOD
```

---

### 2.5 AMM (Constant Sum)

```
priceYes = reserveNo / (reserveYes + reserveNo)
priceNo  = reserveYes / (reserveYes + reserveNo)

mintAmount = burnAmount * priceBurn / priceMint
```

---

## 3. Ponder Indexer

### 3.1 Database Schema

| Table | Key | Main Fields |
|-------|-----|-------------|
| `market` | `id` (bigint) | question, schema, phase, merkleRoot, drandTargetRound, tradingDuration, reserveYes/No, resolvedOutcome (USDC only) |
| `submission` | `id` (text) | marketId, agent, validationHash, targetRound |
| `agent` | `id` (hex) | totalSubmissions, reputation, totalWinnings |
| `agent_market` | `id` (text) | agent, marketId, yesShares, noShares, claimedShares |
| `swap` | `id` (text) | marketId, agent, burnAmount, mintAmount |
| `payout` | `id` (text) | marketId, agent, amount |
| `price_history` | `id` (text) | marketId, priceYes, priceNo, eventType |

**Phase:** `0` = INFO_COLLECTION, `1` = TRADING, `2` = RESOLVED

---

### 3.2 Indexed Events

| Event | Handler | Action |
|-------|---------|--------|
| MarketCreated | insert market | Create market with config from RPC |
| EncryptedSubmissionReceived | insert submission, update agent/market | |
| InfoPhaseRevealed | update market (phase=1), insert priceHistory | |
| SharesClaimed | update agentMarket, agent | |
| SharesSwapped | insert swap, update reserves, priceHistory | |
| MarketResolved | update market (phase=2, resolvedOutcome) | |
| **Phase1Resolved** | update market (phase=1) | Remove from next-phase1 |
| **Phase2Resolved** | update market (phase=2, resolvedOutcome) | Remove from next-phase2 |
| PayoutClaimed | insert payout, update agent | |

---

### 3.3 REST API

**Base URL:** `http://localhost:42069` (or deployment URL)

#### Generic Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/markets` | List markets (limit, offset) |
| GET | `/markets/:id` | Market detail |
| GET | `/markets/:id/submissions` | Market submissions |
| GET | `/agents/:id` | Agent detail |
| GET | `/swaps` | List swaps |
| GET | `/payouts` | List payouts |

#### CRE Workflow Endpoints

##### GET /workflows/next-phase1

Markets ready for Phase 1 (reveal).

**Criteria:** `phase=0`, `merkleRoot=null`, `submissionCount > 0`, optional `drandTargetRound <= currentDrandRound`

**Query params:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `currentDrandRound` | string | Filter only markets with round reached |
| `single` | `"true"` | Return only the most urgent market |

**Ordering:** `drandTargetRound` ASC (lowest deadline = most urgent)

**Response:**

```json
[
  {
    "marketId": "1",
    "drandTargetRound": "1012311",
    "deadline": "1012311",
    "drandChainHash": "0x52db9ba7...",
    "submissionCount": 3,
    "submissions": [
      { "agent": "0x...", "validationHash": "0x..." }
    ]
  }
]
```

##### GET /workflows/next-phase2

Markets ready for Phase 2 (resolve).

**Criteria:** `phase=1`, `resolvedOutcome=null`, valid schema, `createdAt + tradingDuration <= now`

**Query params:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `single` | `"true"` | Return only the most urgent market |

**Ordering:** `tradingEnd` ASC (lowest deadline = most urgent)

**Response:**

```json
[
  {
    "marketId": "2",
    "question": "Will ETH be above $4000?",
    "tradingEnd": 1740844800,
    "deadline": 1740844800,
    "createdAt": 1735689600,
    "tradingDuration": 5184000,
    "schema": { "version": "1.0", "type": "price", "description": "...", "deadline": 1740844800, "fallback": { "prompt": "..." } }
  }
]
```

---

### 3.4 List Removal

When Ponder indexes `Phase1Resolved` or `Phase2Resolved`, it updates `market.phase`. The market no longer satisfies the criteria for `/workflows/next-phase1` or `/workflows/next-phase2` and is no longer returned → no double assignment to the CRE.

---

## 4. Chainlink CRE Phase 1 Workflow

### 4.1 Purpose

**Encrypted Infomarket:** decrypt encrypted predictions after the drand round, compute consensus, allocate shares, build merkle tree, send `revealInfoPhase` onchain.

### 4.2 Path and Files

```
workflows/phase-1/
├── project.yaml
├── phase-1/
│   ├── main.ts           # Entry point, cron handler
│   ├── types.ts          # Config, DecryptedSubmission
│   ├── workflow.yaml     # CRE settings (staging/production)
│   ├── config.staging.json
│   ├── config.production.json
│   ├── lib/
│   │   ├── ponder.ts     # fetchPhase1PendingMarkets
│   │   ├── drand.ts      # fetchBeacon, decryptSubmission, verifySubmission
│   │   ├── merkle.ts     # buildMerkleTree
│   │   └── contract.ts   # fetchSubmissionsFromContract (ciphertext from RPC)
│   └── resolvers/        # (none for phase 1)
```

### 4.3 Trigger

- **Cron:** `0 */2 * * * *` (every 2 minutes)
- **Capability:** `CronCapability` from `@chainlink/cre-sdk`

### 4.4 Flow

```
1. Cron trigger
2. fetchPhase1PendingMarkets(runtime)
   → GET {ponderUrl}/workflows/next-phase1?currentDrandRound={round}
   → Returns list ordered by deadline
3. Take pending[0] (most urgent)
4. canDecrypt(targetRound, network)? If no → SKIPPED_NOT_YET
5. fetchBeacon(runtime, targetRound, network)
6. fetchSubmissionsFromContract(runtime, marketId, marketAddress)
   → getSubmission(marketId, i) for i in 0..getSubmissionCount-1
   → Ciphertext from RPC (Ponder does not have ciphertext)
7. For each submission: decryptSubmission(ciphertext, beacon) → yesPercent, noPercent
8. Compute consensus: consensusYesPercent = sum(yesPercent)/count
9. Allocate shares (proximity-to-consensus scoring) — see §4.5
10. buildMerkleTree(leaves)
11. report = encode(0, marketId, merkleRoot, consensusOutcome, reserveYes, reserveNo, validSubmissions, totalYesShares, totalNoShares, leavesURI)
12. runtime.report() → writeReport on EVM
13. Contract onReport(selector=0) → _revealInfoPhase → emit Phase1Resolved
```

### 4.5 Share Allocation (proximity-to-consensus)

The shares each agent receives in Phase 1 depend on **how close their prediction is to the group consensus**. Closer to consensus → more shares.

#### Input

- **yesPercent, noPercent** (per agent): percentages in basis points on scale 0–1000 (1000 = 100%)
- Constraint: `yesPercent + noPercent == 1000`

#### Step 1: Consensus

```
consensusYesPercent = sum(yesPercent) / count
consensusNoPercent  = 1000 - consensusYesPercent
consensusOutcome    = YES if consensusYesPercent >= 500, else NO
```

#### Step 2: Score (proximity)

For each agent, the **score** measures closeness to consensus:

```
dist   = |yesPercent - consensusYesPercent|
score  = 1000 - dist
```

- **high score** → prediction close to consensus
- **low score** → prediction far from consensus

| Example | consensusYes = 700 | yesPercent | dist | score |
|---------|--------------------|------------|------|-------|
| Agent A | 700 | 700 | 0 | 1000 |
| Agent B | 700 | 600 | 100 | 900 |
| Agent C | 700 | 400 | 300 | 700 |
| Agent D | 700 | 200 | 500 | 500 |

#### Step 3: Share Allocation

```
PRECISION = 10^18
K = count * PRECISION

weightedYes = sum over i of (score[i] * yesPercent[i])
weightedNo  = sum over i of (score[i] * noPercent[i])

yesShares[i] = (K * score[i] * yesPercent[i]) / weightedYes
noShares[i]  = (K * score[i] * noPercent[i]) / weightedNo
```

Shares are proportional to:
1. **score** (proximity to consensus)
2. **yesPercent** / **noPercent** (own allocation)

Those close to consensus who allocated heavily on YES/NO receive more shares on that outcome.

#### Step 4: Reserves

```
totalReserve = 2 * K
totalReserveYes = totalReserve * consensusYesPercent / 1000
totalReserveNo  = totalReserve * consensusNoPercent / 1000
```

Reserves feed the AMM for share swaps in Phase 2 (TRADING).

#### Numerical Example

**Scenario:** 3 agents, consensusYes = 600 (60%)

| Agent | yesPercent | noPercent | dist | score | yesShares (approx) | noShares (approx) |
|-------|------------|-----------|------|-------|--------------------|-------------------|
| Alice | 700 | 300 | 100 | 900 | Higher | Lower |
| Bob | 600 | 400 | 0 | 1000 | Medium | Medium |
| Carol | 400 | 600 | 200 | 800 | Lower | Higher |

Bob (exact consensus) has maximum score 1000. Alice and Carol are close but have lower scores. Final shares also depend on weightedYes/weightedNo.

---

### 4.6 Config

```json
{
  "schedule": "0 */2 * * * *",
  "ponderUrl": "http://localhost:42069",
  "rpcUrl": "https://...",
  "drandNetwork": {
    "chainHash": "0x52db9ba70e0cc0f6eaf7803dd07447a1f5477735fd3f661792ba94600c84e971",
    "genesis": 1692803367,
    "period": 3,
    "httpClient": "https://api.drand.sh"
  },
  "evms": [{
    "chainSelectorName": "ethereum-testnet-sepolia",
    "marketAddress": "0x...",
    "gasLimit": "1000000"
  }]
}
```

### 4.7 Phase 1 Report Format

```solidity
abi.encode(
  uint8(0),           // selector
  marketId,
  merkleRoot,
  consensusOutcome,   // 1=YES, 2=NO
  totalReserveYes,
  totalReserveNo,
  validSubmissions,
  totalYesShares,
  totalNoShares,
  leavesURI           // "" if not yet on IPFS
)
```

### 4.8 Merkle Leaf

```typescript
leafHash = keccak256(encodePacked(["address","uint256","uint256"], [agent, yesShares, noShares]))
```

---

## 5. Chainlink CRE Phase 2 Workflow

### 5.1 Purpose

**Plaintext Prediction Market:** when trading ends, read the schema from the market, call Gemini (with grounded search), determine YES/NO, send `resolveMarket` onchain.

### 5.2 Path and Files

```
workflows/phase-2/
├── project.yaml
├── phase-2/
│   ├── main.ts
│   ├── types.ts
│   ├── workflow.yaml
│   ├── config.staging.json
│   ├── config.production.json
│   ├── lib/
│   │   └── ponder.ts     # fetchPhase2PendingMarkets
│   └── resolvers/
│       └── gemini.ts    # askGemini (with Google Search grounding)
```

### 5.3 Trigger

- **Cron:** `30 */2 * * * *` (every 2 min, 30s offset from Phase 1)
- **Capability:** `CronCapability`

### 5.4 Flow

```
1. Cron trigger
2. fetchPhase2PendingMarkets(runtime)
   → GET {ponderUrl}/workflows/next-phase2
   → Returns list ordered by tradingEnd
3. Take pending[0]
4. schema = market.schema (JSON from onchain)
5. question = schema.description ?? schema.fallback?.prompt ?? market.question
6. Check schema.deadline <= now
7. askGemini(runtime, marketId, question) → { result: "YES"|"NO"|"INCONCLUSIVE" }
8. If INCONCLUSIVE → SKIPPED_INCONCLUSIVE
9. outcome = result === "YES" ? 1 : 2
10. report = encode(1, marketId, outcome)
11. runtime.report() → writeReport on EVM
12. Contract onReport(selector=1) → _resolveMarket → emit Phase2Resolved
```

### 5.5 Config

```json
{
  "schedule": "30 */2 * * * *",
  "ponderUrl": "http://localhost:42069",
  "evms": [{
    "chainSelectorName": "ethereum-testnet-sepolia",
    "marketAddress": "0x...",
    "gasLimit": "500000"
  }]
}
```

**Secrets:** `GEMINI_API_KEY` for the Gemini resolver.

### 5.6 Phase 2 Report Format

```solidity
abi.encode(uint8(1), marketId, outcome)  // outcome: 1=YES, 2=NO
```

### 5.7 Resolution Schema (example)

```json
{
  "version": "1.0",
  "type": "ai",
  "description": "Will ETH be above $4000 on March 1, 2025?",
  "deadline": 1740844800,
  "fallback": {
    "type": "ai",
    "provider": "gemini",
    "prompt": "What was the price of ETH in USD on March 1, 2025?"
  }
}
```

---

## 6. End-to-End Integration

### 6.1 Full Sequence

```
Creator                    Agents                     Ponder                    CRE Phase 1              CRE Phase 2
   │                          │                          │                            │                         │
   │ createMarket()           │                          │                            │                         │
   │─────────────────────────>│                          │                            │                         │
   │                          │ submitEncrypted()        │                            │                         │
   │                          │─────────────────────────>│                            │                         │
   │                          │                          │ index EncryptedSubmission  │                         │
   │                          │                          │                            │                         │
   │                          │                          │<── GET /workflows/next-phase1 ──│                         │
   │                          │                          │─── [marketId, ...] ───────>│                         │
   │                          │                          │                            │ decrypt, merkle        │
   │                          │                          │                            │ writeReport(selector=0) │
   │                          │                          │ index Phase1Resolved       │                         │
   │                          │                          │ phase=1                    │                         │
   │                          │ claimShares()            │                            │                         │
   │                          │ swapShares()             │                            │                         │
   │                          │                          │                            │                         │
   │                          │                          │<── GET /workflows/next-phase2 ──────────────────────│
   │                          │                          │─── [marketId, schema] ─────────────────────────────>│
   │                          │                          │                            │                         │ Gemini → outcome
   │                          │                          │                            │                         │ writeReport(selector=1)
   │                          │                          │ index Phase2Resolved       │                         │
   │                          │                          │ phase=2                    │                         │
   │                          │ claimPayout()            │                            │                         │
```

### 6.2 Ordering by Urgency

With multiple pending markets (e.g. deadlines 1512311, 1514311, 1012311, 1212311, 1112311):

- **Phase 1:** lowest `drandTargetRound` = most urgent → e.g. 1012311
- **Phase 2:** lowest `tradingEnd` = most urgent

Use `?single=true` to get only the most urgent.

---

## 7. Quick Reference

### Ponder URL Endpoints

```
GET /workflows/next-phase1[?single=true][&currentDrandRound=<round>]
GET /workflows/next-phase2[?single=true]
```

### CRE Contract Events

```solidity
event Phase1Resolved(uint256 indexed marketId);
event Phase2Resolved(uint256 indexed marketId);
```

### onReport Selector

| Selector | Action |
|----------|--------|
| 0 | revealInfoPhase |
| 1 | resolveMarket |

### Phase Values (Ponder)

| Value | Phase |
|-------|-------|
| 0 | INFO_COLLECTION |
| 1 | TRADING |
| 2 | RESOLVED |

### Outcome Values

| Value | Meaning |
|-------|---------|
| 0 | NONE |
| 1 | YES |
| 2 | NO |

### Project Structure

```
MiniMarket/
├── contracts/src/
│   ├── MiniMarket.sol
│   ├── OrderbookMarket.sol       # P2P orderbook, Phase 1 participants only
│   ├── interfaces/IMarket.sol, IReceiver.sol
│   └── libraries/ConstantSum.sol, Quadratic.sol
├── indexer/
│   ├── ponder.schema.ts
│   ├── src/index.ts          # Event handlers
│   ├── src/api/index.ts      # REST API
│   └── abis/MiniMarket.json
├── workflows/
│   ├── phase-1/phase-1/      # Drand decrypt + merkle
│   └── phase-2/phase-2/      # Gemini resolve
├── .opencode/plans/
│   ├── PREDICTION-FORMAT-SPEC.md   # Prediction format, scoring
│   └── MINIMARKET-SYSTEM-SPEC.md   # This file
└── status.md
```

---

## 8. OrderbookMarket

### 8.1 Problem: Free Swap and Information Asymmetry

The AMM (Constant Sum) design allows free share swaps in Phase 2 (TRADING). Agents can swap YES ↔ NO freely.

**Problem:** If the event has already occurred before resolution, agents with privileged information can:

1. Know the outcome (e.g. ETH > $4000) before the CRE resolves
2. Swap to the winning side before `resolveMarket`
3. Obtain disproportionate payouts relative to their initial prediction

Also, **external actors** not participating in Phase 1 could enter trading after the reveal, if the design allowed it, with information unavailable at encryption time.

### 8.2 Solution: OrderbookMarket (implemented)

**OrderbookMarket** contract (`contracts/src/OrderbookMarket.sol`) that:

| Requirement | Implementation |
|-------------|----------------|
| **Phase 1 participants only** | `canTrade(marketId, agent)` checks `participatedInInfo` and `claimedInitialShares` |
| **No external actors** | Only those who claimed shares in Phase 1 can `placeOrder` / `takeOrder` |
| **YES ↔ NO only** | Orders sell YES for NO, or sell NO for YES. No ERC20 for shares (mapping only) |

### 8.3 OrderbookMarket API

| Function | Description |
|----------|-------------|
| `placeOrder(marketId, sellYes, amount, price)` | Publish limit order. `price` in PRECISION (e.g. 0.6e18 = 1 share costs 0.6 of the other outcome) |
| `takeOrder(orderId)` | Take an existing order (full fill) |
| `cancelOrder(orderId)` | Cancel order (maker only) |
| `getOrder(orderId)` | Returns maker, marketId, sellYes, amount, price, filled, cancelled |

### 8.4 Integration with MiniMarket

- **MiniMarket** exposes `executeOrderbookTrade(marketId, maker, taker, makerSellsYes, sharesAmount, takerPaysAmount)` — callable only by `orderbook`.
- **Owner** sets the orderbook with `setOrderbook(address)`.
- **Deploy:** OrderbookMarket is deployed with MiniMarket; `market.setOrderbook(orderbook)` is called at deploy time.

### 8.5 AMM and Orderbook Coexistence

- **swapShares** (AMM): still available for those who prefer immediate swap against reserves.
- **OrderbookMarket**: P2P trading among Phase 1 participants only, no external actors.

---

## Related Documents

- **PREDICTION-FORMAT-SPEC.md** — Encrypted payload format, validation hash, scoring, merkle leaf
- **workflows/spec.md** — Original CRE workflow specification
- **status.md** — Status and integration (root)
