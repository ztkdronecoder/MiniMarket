# MiniMarket — Status & Integration

Documentation of the current project state, Ponder endpoints, and CRE workflow integration.

---

## Table of Contents

1. [Overview](#overview)
2. [MiniMarket Contract](#minimarket-contract)
3. [Ponder Indexer — API](#ponder-indexer--api)
4. [CRE Workflow — Integration](#cre-workflow--integration)
5. [Events and List Removal](#events-and-list-removal)
6. [Quick Reference](#quick-reference)

---

## Overview

MiniMarket is a prediction market with drand timelock encryption. The flow:

- **Phase 1 (INFO_COLLECTION)**: agents submit encrypted predictions; when the drand round is reached, the CRE decrypts, builds the merkle tree, and calls `revealInfoPhase`.
- **Phase 2 (TRADING)**: agents claim shares and trade (OrderbookMarket P2P or AMM swapShares); when trading ends, the CRE resolves the market via schema + Gemini.
- **Phase 3 (RESOLVED)**: winners claim payouts.

CRE workflows (phase-1 and phase-2) read from **Ponder** which markets to process. Ponder exposes REST endpoints that return lists ordered by urgency (lowest deadline = most urgent).

---

## MiniMarket Contract

### Events for CRE (`onReport`)

When the CRE processes a market via `onReport` (Chainlink callback), the contract emits dedicated events:

| Event | When | Parameters |
|-------|------|------------|
| `Phase1Resolved(uint256 indexed marketId)` | Selector 0 — reveal info phase | `marketId` |
| `Phase2Resolved(uint256 indexed marketId)` | Selector 1 — resolve market | `marketId` |

These events signal that the CRE has completed work on that market. The indexer uses them to update state and remove the market from the pending list.

### `onReport` Flow

```
report[31] = selector
  selector 0 → _revealInfoPhase(...) → emit Phase1Resolved(marketId)
  selector 1 → _resolveMarket(marketId, outcome) → emit Phase2Resolved(marketId)
```

---

## Ponder Indexer — API

Base URL: `http://localhost:42069` (or Ponder deployment URL).

### Workflow Endpoints

#### 1. `GET /workflows/next-phase1` — Phase 1 to be revealed

Markets ready for reveal (drand decryption + merkle).

**Criteria:**

- `phase = 0` (INFO_COLLECTION)
- `merkleRoot = null` (not yet revealed)
- At least 1 submission
- Optional: `currentDrandRound >= drandTargetRound` (if you pass `currentDrandRound`)

**Query params:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `currentDrandRound` | `string` | Current drand round; if present, filters only markets with `drandTargetRound <= currentDrandRound` |
| `single` | `"true"` | Returns only the most urgent market (first in list) |

**Ordering:** by `drandTargetRound` (deadline) ascending → most urgent first.

**Example response:**

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

**Examples:**

- `GET /workflows/next-phase1` → full ordered list
- `GET /workflows/next-phase1?single=true` → only the most urgent
- `GET /workflows/next-phase1?currentDrandRound=1500000` → only markets with round already reached

---

#### 2. `GET /workflows/next-phase2` — Phase 2 to be resolved

Markets ready for resolution (trading ended, schema present).

**Criteria:**

- `phase = 1` (TRADING)
- `resolvedOutcome = null` (not yet resolved)
- `schema` present and valid
- `createdAt + tradingDuration <= now` (trading ended)

**Query params:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `single` | `"true"` | Returns only the most urgent market |

**Ordering:** by `tradingEnd` (deadline) ascending → most urgent first.

**Example response:**

```json
[
  {
    "marketId": "2",
    "question": "Will ETH be above $4000?",
    "tradingEnd": 1740844800,
    "deadline": 1740844800,
    "createdAt": 1735689600,
    "tradingDuration": 5184000,
    "schema": { "version": "1.0", "type": "price", ... }
  }
]
```

**Examples:**

- `GET /workflows/next-phase2` → full ordered list
- `GET /workflows/next-phase2?single=true` → only the most urgent

---

### Other Endpoints

| Endpoint | Description |
|----------|-------------|
| `GET /markets` | List markets (with `limit`, `offset`) |
| `GET /markets/:id` | Market detail |
| `GET /markets/:id/submissions` | Submissions for a market |
| `GET /agents/:id` | Agent detail |
| `GET /swaps` | List swaps |
| `GET /payouts` | List payouts |

---

## CRE Workflow — Integration

### Phase 1 workflow

1. Call `GET /workflows/next-phase1?single=true&currentDrandRound=<round>`.
2. If the list is empty → no market to process.
3. Otherwise use the first (and only) market returned.
4. Fetch ciphertext from the contract (`getSubmission`) or from Ponder if available.
5. Decrypt, compute consensus, build merkle tree.
6. Call `revealInfoPhase` (or `onReport` with selector 0).

### Phase 2 workflow

1. Call `GET /workflows/next-phase2?single=true`.
2. If the list is empty → no market to process.
3. Otherwise use the first (and only) market.
4. Read `schema` from the response.
5. Call Gemini (or other resolver) to determine the outcome.
6. Call `resolveMarket` (or `onReport` with selector 1).

### Ordering by urgency

With multiple deadlines (e.g. `1512311`, `1514311`, `1012311`, `1212311`, `1112311`):

- **Phase 1:** lowest `drandTargetRound` = most urgent → e.g. `1012311`.
- **Phase 2:** lowest `tradingEnd` = most urgent.

Using `?single=true` always returns the most urgent market, avoiding processing multiple markets in the same run.

---

## Events and List Removal

When the CRE completes a market, the contract emits `Phase1Resolved` or `Phase2Resolved`. Ponder indexes them and updates the market state:

| Event | Ponder Action | Effect |
|-------|--------------|--------|
| `Phase1Resolved(marketId)` | `phase = 1` (TRADING) | Market no longer appears in `/workflows/next-phase1` |
| `Phase2Resolved(marketId)` | `phase = 2`, `resolvedOutcome` read from contract | Market no longer appears in `/workflows/next-phase2` |

This way a processed market is no longer returned by the endpoints, avoiding double assignment to the CRE.

**Note:** `InfoPhaseRevealed` and `MarketResolved` are emitted by internal functions; `Phase1Resolved` and `Phase2Resolved` are emitted only in the `onReport` path and serve to explicitly track completion by the CRE.

---

## Quick Reference

### URL Endpoints

```
GET /workflows/next-phase1[?single=true][&currentDrandRound=<round>]
GET /workflows/next-phase2[?single=true]
```

### Contract Events

```solidity
event Phase1Resolved(uint256 indexed marketId);
event Phase2Resolved(uint256 indexed marketId);
```

### OrderbookMarket (P2P Trading)

Separate contract for YES ↔ NO trading among **Phase 1 participants only** (no external actors). API: `placeOrder`, `takeOrder`, `cancelOrder`. Deployed with MiniMarket; `market.setOrderbook(orderbook)` called at deploy time. See §8 in MINIMARKET-SYSTEM-SPEC.md.

### Project Structure

```
MiniMarket/
├── contracts/src/
│   ├── MiniMarket.sol              # Main contract
│   └── OrderbookMarket.sol         # P2P orderbook, Phase 1 participants only
├── indexer/
│   ├── src/
│   │   ├── index.ts                # Ponder event handlers
│   │   └── api/index.ts            # REST API (workflows, markets, ...)
│   └── abis/MiniMarket.json        # ABI with Phase1Resolved, Phase2Resolved
├── workflows/
│   ├── phase-1/                    # Reveal workflow (drand + merkle)
│   └── phase-2/                    # Resolution workflow (Gemini)
├── status.md                       # This file
└── README.md
```

### Orderbook vs AMM

- **OrderbookMarket** (implemented): P2P trading only among Phase 1 participants; no external actors can enter.
- **swapShares** (AMM): still available for immediate swap against reserves.

### CRE Integration Checklist

- [x] OrderbookMarket deployed and linked to MiniMarket
- [x] Endpoint `/workflows/next-phase1` with deadline ordering
- [x] Endpoint `/workflows/next-phase2` with deadline ordering
- [x] Parameter `?single=true` to get only the most urgent
- [x] Events `Phase1Resolved` and `Phase2Resolved` in contract
- [x] Ponder handlers that update `phase` and remove from list
- [ ] Workflow phase-1: query Ponder + `single=true`
- [ ] Workflow phase-2: query Ponder + `single=true`
