# MiniMarket Implementation Tasks

## Current Status: Phase 1 Complete, Starting Phase 2

### ✅ Completed

#### Phase 0: Project Setup
- [x] Project structure established
- [x] Foundry contracts setup
- [x] TypeScript SDK setup
- [x] Ponder indexer setup
- [x] Next.js frontend setup

#### Phase 1: Core Functionality
- [x] MiniMarket.sol contract implementation
  - [x] Market creation with funding
  - [x] Encrypted submission with drand timelock
  - [x] Info phase reveal via CRE forwarder
  - [x] Share claiming with merkle proofs
  - [x] Share swapping (constant sum AMM)
  - [x] Market resolution
  - [x] Payout claiming
- [x] TypeScript SDK (ts/src/)
  - [x] Drand encryption/decryption
  - [x] Market client utilities
  - [x] CRE workflow class (basic)
- [x] Ponder indexer
  - [x] Event handlers for all events
  - [x] Price history tracking
- [x] Frontend components
  - [x] Market list with Ponder data
  - [x] Market detail with price chart
  - [x] Network stats

#### Phase 1.5: Testing & Fixes
- [x] Comprehensive contract tests (59 tests passing)
- [x] Edge case tests
- [x] Invariant tests
- [x] Fork tests for Base Sepolia
- [x] SPDC.sol deployment config

---

### 🔄 In Progress

#### Phase 2: CRE Integration (Current Focus)
- [ ] **Contract Changes for schemaURI**
  - [ ] Add `schemaURI` to `MarketConfig` struct
  - [ ] Update `createMarket()` signature
  - [ ] Update `MarketCreated` event
  - [ ] Update `ResolutionRequested` event
  - [ ] Add validation for schemaURI
- [ ] **Test Updates**
  - [ ] Update all test createMarket() calls
  - [ ] Add mock schema URI constants
  - [ ] Update event expectations
- [ ] **ABI Updates**
  - [ ] Update ts/src/market/abi.ts
- [ ] **CRE Workflow Implementation**
  - [ ] Create cre-workflow/ directory
  - [ ] Implement info reveal workflow
  - [ ] Implement resolution workflow

---

### ⏳ Pending

#### Phase 3: Resolution Schema System
- [ ] Schema JSON specification
- [ ] Price resolution implementation
- [ ] Sports resolution implementation
- [ ] AI resolution implementation
- [ ] Schema fetcher utility

#### Phase 4: Indexer & Frontend Updates
- [ ] Update ponder schema for schemaURI
- [ ] Update event handlers
- [ ] Frontend schema URI display
- [ ] Schema builder helper (optional)

#### Phase 5: Deployment
- [ ] Deploy to Base Sepolia
- [ ] Register CRE workflows
- [ ] Fund with testnet LINK
- [ ] End-to-end testing

---

## Design Fallacies Identified (To Fix)

| Issue | Severity | Status | Fix |
|-------|----------|--------|-----|
| Double Funding | CRITICAL | Pending | Remove creator funding, only agents deposit |
| Artificial Reserves | CRITICAL | Pending | Derive reserves from actual deposits |
| Hash Encoding Mismatch | HIGH | Pending | Use `abi.encodePacked` consistently |
| No Resolution Oracle | CRITICAL | **IN PROGRESS** | CRE with schemaURI resolution |
| Consensus Paradox | MEDIUM | Acknowledged | Document as design choice |
| No Market Failure Handling | MEDIUM | Pending | Add refund mechanisms |
| Reserve Depletion | HIGH | Pending | Separate AMM from payout calculation |

---

## File Structure

```
reveal/
├── contracts/
│   ├── src/
│   │   ├── MiniMarket.sol        ← NEEDS UPDATE (schemaURI)
│   │   ├── interfaces/
│   │   │   └── IMarket.sol       ← NEEDS UPDATE (schemaURI)
│   │   ├── libraries/
│   │   │   ├── ConstantSum.sol
│   │   │   ├── Quadratic.sol
│   │   │   └── MerkleVerifier.sol
│   │   └── SPDC.sol
│   └── test/
│       └── MiniMarket.t.sol      ← NEEDS UPDATE (schemaURI in tests)
│
├── ts/
│   └── src/
│       ├── drand/
│       ├── market/
│       │   └── abi.ts            ← NEEDS UPDATE (schemaURI)
│       └── cre/
│           └── workflow.ts
│
├── cre-workflow/                  ← TO CREATE
│   ├── workflow.yaml
│   ├── config.json
│   └── main.ts
│
├── indexer/
│   ├── ponder.config.ts
│   ├── ponder.schema.ts          ← MAY NEED UPDATE
│   └── src/index.ts              ← MAY NEED UPDATE
│
├── frontend/
│   └── src/
│       ├── components/
│       └── lib/
│
└── .opencode/plans/
    ├── CRE-SPEC.md               ← CREATED
    └── TASKS.md                  ← THIS FILE
```

---

## Next Actions (Ordered)

1. **Update IMarket.sol** - Add schemaURI to struct, events, interface
2. **Update MiniMarket.sol** - Update createMarket(), emit events with schemaURI
3. **Update MiniMarket.t.sol** - Fix all tests with mock schemaURI
4. **Update ts/src/market/abi.ts** - Update function and event signatures
5. **Run tests** - Verify all 59 tests still pass
6. **Create cre-workflow/** - Set up CRE project structure
7. **Implement CRE workflows** - Info reveal and resolution handlers

---

## Notes

- Mock schema URI format: `"mock://price/eth-usd/gt/4000"`
- CRE will use cron triggers (not just onchain events) for fully automated operation
- Resolution supports: Price APIs, Sports APIs, AI (Gemini), Chainlink Data Feeds
