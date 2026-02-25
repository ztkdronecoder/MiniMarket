# MiniMarket CRE Workflows Specification

## Overview

The unified CRE workflow in `cre-workflow/` is **wrong** and should be **split** into two independent workflows:

1. **Phase 1** — Encrypted Infomarket (price discovery via drand timelock decryption)
2. **Phase 2** — Plaintext Prediction Market (AI resolution via Gemini + grounded search)

Both workflows read from **Ponder** (indexer). Ponder and contract modifications are planned for later; this spec focuses on the workflow implementation and documents integration points for future work.

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                              PONDER (Indexer)                                    │
│  GraphQL: localhost:42069/graphql  |  REST API: /markets, /markets/:id/submissions │
│  (To be extended: phase1-pending, phase2-pending, ciphertext, leaves storage)    │
└─────────────────────────────────────────────────────────────────────────────────┘
                    │                                    │
                    │ Phase 1 Query                      │ Phase 2 Query
                    ▼                                    ▼
┌─────────────────────────────────────┐    ┌─────────────────────────────────────┐
│         PHASE 1 WORKFLOW             │    │         PHASE 2 WORKFLOW             │
│    workflows/phase-1/phase-1/        │    │    workflows/phase-2/phase-2/        │
├─────────────────────────────────────┤    ├─────────────────────────────────────┤
│ Trigger: Cron every 2 minutes        │    │ Trigger: Cron every 2 minutes        │
│                                     │    │                                     │
│ 1. Query Ponder: phase1 markets     │    │ 1. Query Ponder: phase2 markets     │
│    to decrypt                       │    │    to resolve                       │
│ 2. For each (or first) market:     │    │ 2. Take first market in list         │
│    - Get drand beacon + info       │    │ 3. Fetch schema (prompt, conditions)  │
│    - Get encrypted submissions     │    │ 4. Gemini + Google Search → outcome  │
│    - Decrypt, consensus, shares    │    │ 5. Post onchain: resolveMarket()      │
│    - Build merkle tree             │    │    outcome YES or NO                 │
│    - Post onchain: merkle root +   │    │                                     │
│      leavesURI (POST leaves to      │    │                                     │
│      Ponder → URI)                 │    │                                     │
└─────────────────────────────────────┘    └─────────────────────────────────────┘
```

---

# Phase 1: Encrypted Infomarket Workflow

## Purpose

Phase 1 is the **encrypted infomarket**: agents submit encrypted predictions (yes/no percentages) timelock-encrypted to a future drand round. When the round is reached, the workflow decrypts, computes consensus, allocates shares, builds a merkle tree, and posts the result onchain so agents can claim shares via merkle proofs.

## Trigger

- **Cron**: Every 2 minutes  
- **Schedule**: `*/2 * * * *` (5-field) or `0 */2 * * * *` (6-field, every 2 min at second 0)  
- See [Chainlink CRE Cron Trigger](https://docs.chain.link/cre/guides/workflow/using-triggers/cron-trigger-ts)

## Data Flow

### 1. Query Ponder for Phase 1 Markets to Decrypt

**Endpoint (to be added)**: `GET /phase1/pending` or GraphQL query.

**Expected response** (conceptual):

```json
[
  {
    "marketId": "1",
    "drandTargetRound": "12345678",
    "drandChainHash": "0x52db9ba70e0cc0f6eaf7803dd07447a1f5477735fd3f661792ba94600c84e971",
    "submissionCount": 3
  }
]
```

**Filter logic** (Ponder-side, later):

- `phase === 1` (or INFO_COLLECTION)
- `merkleRoot === null` (not yet revealed)
- `currentDrandRound >= drandTargetRound` (round reached)
- Market has at least one submission

**Fallback for now**: If Ponder doesn't expose this yet, the workflow can query `GET /markets` and filter client-side, or use a mock/empty list.

### 2. Get Drand Beacon Once

For the selected market:

- **drandTargetRound**: from market config (each market has a drand target round on quicknet)
- **drandChainHash**: from market config (identifies drand network)
- **HTTP**: `GET {drandHttpClient}/{chainHash}/public/{round}`

Example: `https://api.drand.sh/0x52db9ba7.../public/12345678`

**Code to reuse**: `cre-workflow/minimarket/lib/drand.ts` — `fetchBeacon`, `canDecrypt`

### 3. Get List of Cast Encrypted Predictions from Ponder

**Endpoint (to be added)**: `GET /markets/:id/submissions` with ciphertext.

**Current Ponder schema** (`submission`):

- `id`, `marketId`, `agent`, `validationHash`, `targetRound`, `timestamp`, `txHash`
- **Missing**: `ciphertext` — stored onchain in `EncryptedSubmission.ciphertext`

**Options**:

- **A)** Ponder indexes ciphertext from contract (schema + handler update)
- **B)** Workflow fetches ciphertext from contract via RPC: `getSubmission(marketId, index)` for `index in 0..getSubmissionCount(marketId)-1`

**For now**: Use contract RPC if Ponder doesn't have ciphertext. Code in `cre-workflow` uses `fetchSubmissions` placeholder returning `[]`; replace with either Ponder HTTP or contract calls.

### 4. Decrypt Each Submission and Evaluate Consensus + Compute Shares

**Per submission**:

1. Decrypt: `decryptSubmission(ciphertext, beacon)` → `{ agent, yesPercent, noPercent, salt }`
2. Validate: `verifySubmission(decrypted, validationHash)`
3. If invalid or decrypt fails: assume 50-50 (yesPercent=500, noPercent=500)
4. Add to `DecryptedSubmission[]` with `yesShares`, `noShares` initially 0

**Consensus**:

- `consensusYesPercent = sum(yesPercent) / count`
- `consensusNoPercent = 1000 - consensusYesPercent`
- `consensusOutcome = consensusYesPercent >= 500 ? YES : NO`

**Share allocation** (constant-sum pool, proximity-to-consensus scoring):

- Score_i = 1000 - |yesPercent_i - consensusYesPercent|
- `yesShares_i = K * score_i * yesPercent_i / sum(score_j * yesPercent_j)`
- `noShares_i = K * score_i * noPercent_i / sum(score_j * noPercent_j)`
- `K = count * 10^18`

**Code to reuse**: `cre-workflow/minimarket/main.ts` lines 79–169 (onInfoRevealTrigger logic), `lib/drand.ts`, `types.ts` (DecryptedSubmission, etc.)

### 5. Build Merkle Tree

**Code to reuse**: `cre-workflow/minimarket/lib/merkle.ts` — `buildMerkleTree(leaves)`

**Leaves**: `{ agent, yesShares, noShares }[]`

**Output**: `{ root, leaves, getProof }`

### 6. Post Onchain: Merkle Root + leavesURI

**Contract call**: `revealInfoPhase(marketId, merkleRoot, consensusOutcome, totalReserveYes, totalReserveNo, validSubmissions, totalYesShares, totalNoShares, leavesURI)`

**leavesURI**:

- Workflow builds JSON: `{ leaves: [ { index, agent, yesShares, noShares, leafHash, proof } ] }`
- POST this JSON to Ponder (or a dedicated storage endpoint)
- Ponder returns a URI (e.g. `https://ponder.example.com/leaves/1` or IPFS CID)
- Pass that URI as `leavesURI`

**Note**: Current contract ABI may not include `leavesURI`; interface in `IMarket.sol` does. If implementation lacks it, use empty string `""` for now; add in contract update later.

**Reserves**:

- `totalReserveYes = 2*K * consensusYesPercent / 1000`
- `totalReserveNo = 2*K * consensusNoPercent / 1000`

---

## Code Split from cre-workflow

| Source | Destination | Notes |
|--------|-------------|-------|
| `lib/drand.ts` | `phase-1/lib/drand.ts` | Copy as-is |
| `lib/merkle.ts` | `phase-1/lib/merkle.ts` | Copy as-is |
| `types.ts` (Config, DecryptedSubmission, DrandBeacon, etc.) | `phase-1/types.ts` | Trim to Phase 1 only |
| `main.ts` onInfoRevealTrigger + fetchSubmissions | `phase-1/main.ts` | Cron handler, Ponder/contract fetch |
| `config.json` drand + evm | `phase-1/config.*.json` | Phase 1 config |

**New in phase-1**:

- Cron trigger setup (replace EVM log trigger)
- Ponder HTTP client to query phase1-pending markets
- Contract RPC fallback for submissions (if Ponder has no ciphertext)
- leavesURI: POST leaves JSON to Ponder, get URI
- EVMClient to call `revealInfoPhase`

---

# Phase 2: Plaintext Prediction Market Workflow

## Purpose

Phase 2 is the **plaintext prediction market**: after Phase 1 reveal, the market enters trading. When trading ends, the workflow resolves the market using the schema (prompt, conditions) and Gemini with grounded Google Search to determine YES or NO.

## Trigger

- **Cron**: Every 2 minutes  
- **Schedule**: Same as Phase 1 or staggered (e.g. `30 */2 * * * *` to offset)

## Data Flow

### 1. Query Ponder for Markets to Resolve

**Endpoint (to be added)**: `GET /phase2/pending` or GraphQL query.

**Expected response** (conceptual):

```json
[
  {
    "marketId": "1",
    "schemaURI": "ipfs://Qm...",
    "question": "Will X happen by Y?",
    "tradingEnd": 1735689600
  }
]
```

**Filter logic** (Ponder-side, later):

- `phase === 2` (TRADING)
- `resolvedOutcome === null` (not resolved)
- `tradingEnd <= now` (trading ended)
- Ordered by `tradingEnd` ASC (oldest first)

**Fallback for now**: Query `GET /markets`, filter client-side.

### 2. Take First Market in List

Process **one market per cron run** to avoid rate limits and ensure deterministic ordering.

### 3. Fetch Schema (Prompt + Conditions)

**schemaURI**: IPFS, HTTP, Arweave, or mock.

**Code to reuse**: `cre-workflow/minimarket/lib/schemaFetcher.ts` — `fetchSchema(runtime, schemaURI)`

**Schema fields used**:

- `description` or `fallback.prompt`: the question for Gemini
- `deadline`: skip if not reached
- `resolution`, `fallback`: resolution logic (for now, use AI fallback)

### 4. Gemini with Grounded Google Search → Outcome

**Code to reuse**: `cre-workflow/minimarket/resolvers/gemini.ts` — `askGemini(runtime, marketId, question)`

- Uses `tools: [{ google_search: {} }]` for grounded search
- Returns `{ result: "YES" | "NO" | "INCONCLUSIVE", confidence }`

**Mapping**:

- `YES` → `Outcome.YES` (1)
- `NO` → `Outcome.NO` (2)
- `INCONCLUSIVE` → skip this run, retry later or flag for manual resolution

### 5. Post Onchain: resolveMarket(marketId, outcome)

**Contract call**: `resolveMarket(marketId, outcome)` where `outcome` is `Outcome.YES` or `Outcome.NO`.

**Code to reuse**: EVMClient, contract ABI.

---

## Code Split from cre-workflow

| Source | Destination | Notes |
|--------|-------------|-------|
| `lib/schemaFetcher.ts` | `phase-2/lib/schemaFetcher.ts` | Copy as-is |
| `resolvers/gemini.ts` | `phase-2/resolvers/gemini.ts` | Copy as-is |
| `types.ts` (Config, ResolutionSchema, etc.) | `phase-2/types.ts` | Trim to Phase 2 only |
| `main.ts` onResolutionTrigger | `phase-2/main.ts` | Cron handler, Ponder fetch |
| `config.json` evm + gemini | `phase-2/config.*.json` | Phase 2 config |

**New in phase-2**:

- Cron trigger setup
- Ponder HTTP client to query phase2-pending markets
- Take first market only
- EVMClient to call `resolveMarket`

---

# Ponder Integration (Later)

## Phase 1 Endpoint ✅ IMPLEMENTED

**`GET /workflows/next-phase1`**
- Query params: `currentDrandRound` (optional) — if provided, only return markets where `drandTargetRound <= currentDrandRound`
- Criteria: `phase=0`, `merkleRoot=null`, `submissionCount > 0`
- Response: `[{ marketId, drandTargetRound, drandChainHash, submissionCount, submissions: [{ agent, validationHash }] }]`
- Workflows use this endpoint (ciphertext still from contract via RPC)

## Phase 2 Endpoint ✅ IMPLEMENTED

**`GET /workflows/next-phase2`**
- Criteria: `phase=1`, `resolvedOutcome=null`, `schemaURI` set, `createdAt + tradingDuration <= now`
- Response: `[{ marketId, schemaURI, question, tradingEnd, createdAt, tradingDuration }]`
- Ordered by `tradingEnd` ASC

## Future Ponder Additions

- **`POST /leaves`** — accept leaves JSON, store, return URI (for `leavesURI` in `revealInfoPhase`)
- **`GET /markets/:id/submissions`** — extend to include `ciphertext` (optional; workflow can use contract RPC)

## Schema Updates

- `submission`: add `ciphertext` (hex) if not present
- New table or endpoint for `leaves` storage (marketId → JSON)

---

# Contract Integration (Later)

## Phase 1

- Ensure `revealInfoPhase` accepts `leavesURI` (interface has it; implementation may need update)
- Emit `InfoPhaseRevealed` with `leavesURI` for indexer

## Phase 2

- `resolveMarket(marketId, outcome)` — already exists
- Ensure `ResolutionRequested` includes `schemaURI` for workflow

---

# Implementation Checklist

## Phase 1 Workflow (Top Priority)

- [ ] Copy `drand.ts`, `merkle.ts`, relevant types from cre-workflow
- [ ] Set up Cron trigger (every 2 min) in `workflows/phase-1/phase-1/main.ts`
- [ ] Implement Ponder query for phase1-pending (or mock)
- [ ] Implement submission fetch (Ponder or contract RPC)
- [ ] Implement decrypt → consensus → shares logic (from cre-workflow)
- [ ] Build merkle tree
- [ ] Implement leavesURI: POST leaves to Ponder or use placeholder `""`
- [ ] Call `revealInfoPhase` onchain via EVMClient
- [ ] Add config for drand network, market address, Ponder URL

## Phase 2 Workflow (Top Priority)

- [ ] Copy `schemaFetcher.ts`, `gemini.ts`, relevant types from cre-workflow
- [ ] Set up Cron trigger (every 2 min) in `workflows/phase-2/phase-2/main.ts`
- [ ] Implement Ponder query for phase2-pending (or mock)
- [ ] Take first market only
- [ ] Fetch schema, check deadline
- [ ] Call Gemini with grounded search
- [ ] Call `resolveMarket` onchain via EVMClient
- [ ] Add config for market address, Ponder URL, GEMINI_API_KEY secret

## Ponder (Later)

- [ ] Add `phase1/pending` and `phase2/pending` endpoints or GraphQL
- [ ] Add `ciphertext` to submission indexing
- [ ] Add `POST /leaves` endpoint for leavesURI

## Contract (Later)

- [ ] Add `leavesURI` to `revealInfoPhase` implementation if missing
- [ ] Verify `ResolutionRequested` includes `schemaURI`
- [ ] **Phase 2**: Extend `onReport` to support resolution: if report decodes as `(uint8 selector=1, uint256 marketId, uint8 outcome)`, call `resolveMarket(marketId, Outcome(outcome))`

---

# Config Examples

## Phase 1 config.staging.json

```json
{
  "schedule": "0 */2 * * * *",
  "ponderUrl": "http://localhost:42069",
  "drandNetwork": {
    "chainHash": "0x52db9ba70e0cc0f6eaf7803dd07447a1f5477735fd3f661792ba94600c84e971",
    "genesis": 1692803367,
    "period": 3,
    "httpClient": "https://api.drand.sh"
  },
  "evms": [{
    "chainSelectorName": "base-testnet-sepolia",
    "marketAddress": "0x...",
    "gasLimit": "1000000"
  }]
}
```

## Phase 2 config.staging.json

```json
{
  "schedule": "0 */2 * * * *",
  "ponderUrl": "http://localhost:42069",
  "evms": [{
    "chainSelectorName": "base-testnet-sepolia",
    "marketAddress": "0x...",
    "gasLimit": "500000"
  }]
}
```

Secrets: `GEMINI_API_KEY` for Phase 2.

---

# References

- [Chainlink CRE Cron Trigger](https://docs.chain.link/cre/guides/workflow/using-triggers/cron-trigger-ts)
- [CRE SDK](https://docs.chain.link/cre/reference/sdk)
- Existing code: `cre-workflow/minimarket/`
- Ponder: `indexer/`
- Contract: `contracts/src/MiniMarket.sol`, `contracts/src/interfaces/IMarket.sol`
