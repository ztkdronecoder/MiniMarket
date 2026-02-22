# Chainlink CRE Integration Specification

## Status: IMPLEMENTED ✅

### Completed Tasks

1. **Contract Changes** ✅
   - Added `schemaURI` to `MarketConfig` struct
   - Updated `createMarket()` function signature
   - Updated `MarketCreated` and `ResolutionRequested` events

2. **Test Updates** ✅
   - All 59 tests updated with mock schemaURI
   - Tests pass with new contract interface

3. **ABI Updates** ✅
   - Updated `ts/src/market/abi.ts` with new signatures

4. **CRE Workflow** ✅
   - Created `cre-workflow/` directory structure
   - Implemented `main.ts` with Info Reveal and Resolution handlers
   - Implemented Gemini AI resolver
   - Created schema fetcher for IPFS/HTTP URIs
   - Created drand decryption utilities
   - Created merkle tree utilities

---

## Overview

This document specifies the integration of Chainlink Runtime Environment (CRE) into the MiniMarket prediction market protocol. CRE provides decentralized, automated execution of offchain workflows with cryptographic verification.

### Key Goals

1. **Automated Info Reveal**: CRE monitors drand rounds and automatically reveals encrypted submissions
2. **Automated Resolution**: CRE monitors market deadlines and resolution schemas to determine outcomes
3. **Trustless Operation**: No manual intervention required after market creation

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              MINIMARKET CONTRACT                             │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  MarketConfig:                                                               │
│  ├── question: "Will ETH > $4000 on Mar 1?"                                 │
│  ├── schemaURI: "ipfs://Qm.../price-schema.json"  ← NEW                    │
│  ├── drandTargetRound: 12345678                                             │
│  ├── tradingDuration: 24 hours                                              │
│  └── ...                                                                    │
│                                                                              │
│  MarketState:                                                                │
│  ├── phase: INFO_COLLECTION → TRADING → RESOLVED                            │
│  ├── resolvedOutcome: NONE → YES/NO                                         │
│  └── ...                                                                    │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
                    │                           │
                    │ Events                    │ Events
                    ▼                           ▼
┌───────────────────────────────┐   ┌───────────────────────────────┐
│     CRE WORKFLOW #1           │   │     CRE WORKFLOW #2           │
│     Info Reveal               │   │     Resolution                │
├───────────────────────────────┤   ├───────────────────────────────┤
│                               │   │                               │
│  Trigger: Cron (every 1 min)  │   │  Trigger: Cron (every 5 min)  │
│                               │   │                               │
│  1. Check drand round reached │   │  1. Check market deadlines    │
│  2. Fetch submissions         │   │  2. Fetch schemaURI           │
│  3. Decrypt with drand        │   │  3. Query resolution source   │
│  4. Build merkle tree         │   │  4. Determine outcome         │
│  5. Call revealInfoPhase()    │   │  5. Call resolveMarket()      │
│                               │   │                               │
└───────────────────────────────┘   └───────────────────────────────┘
```

---

## Schema URI Format

The `schemaURI` points to a JSON document describing how to resolve the market.

### Example Schema (Price)

```json
{
  "version": "1.0",
  "type": "price",
  "asset": "ethereum",
  "symbol": "ETH",
  "currency": "USD",
  "comparator": ">",
  "targetValue": "4000000000000000000000",
  "decimals": 18,
  "deadline": 1709251199,
  "sources": [
    {
      "type": "api",
      "url": "https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd",
      "jsonPath": "$.ethereum.usd",
      "transform": "multiply(1e18)"
    },
    {
      "type": "chainlink",
      "address": "0x5f4eC3Df9cbd43714FE2740f5E3616155c5b8419",
      "chain": "ethereum-mainnet"
    }
  ],
  "fallback": {
    "type": "ai",
    "provider": "gemini",
    "prompt": "What was the price of ETH in USD on March 1, 2024?"
  }
}
```

### Example Schema (Sports)

```json
{
  "version": "1.0",
  "type": "sports",
  "sport": "nfl",
  "event": "super_bowl_2025",
  "question": "Will the Buffalo Bills win Super Bowl 2025?",
  "deadline": 1735689600,
  "sources": [
    {
      "type": "api",
      "url": "https://api.espn.com/v1/sports/football/nfl/events/12345",
      "jsonPath": "$.competitions[0].winner.id"
    }
  ],
  "fallback": {
    "type": "ai",
    "provider": "gemini",
    "prompt": "Who won Super Bowl 2025?"
  }
}
```

### Example Schema (AI/General)

```json
{
  "version": "1.0",
  "type": "ai",
  "provider": "gemini",
  "prompt": "Will ETH be above $4000 on March 1, 2025?",
  "deadline": 1740844800,
  "options": {
    "searchGrounding": true,
    "confidenceThreshold": 0.7
  }
}
```

---

## Contract Changes Required

### 1. IMarket.sol - Add schemaURI

```diff
struct MarketConfig {
    uint256 marketId;
    string question;
+   string schemaURI;           // URI to resolution schema
    address paymentToken;
    uint256 maxSlots;
    uint256 ticketCost;
    uint256 marketCap;
    uint64 drandTargetRound;
    bytes32 drandChainHash;
    uint48 createdAt;
    uint48 tradingDuration;
}
```

### 2. IMarket.sol - Update Events

```diff
event MarketCreated(
    uint256 indexed marketId,
    string question,
+   string schemaURI,
    uint256 maxSlots,
    uint256 ticketCost,
    uint64 drandTargetRound
);

event ResolutionRequested(
    uint256 indexed marketId,
+   string schemaURI,
    uint48 tradingEnd
);
```

### 3. IMarket.sol - Update Interface

```diff
function createMarket(
    string calldata question,
+   string calldata schemaURI,
    address paymentToken,
    uint256 maxSlots,
    uint256 ticketCost,
    uint64 drandTargetRound,
    bytes32 drandChainHash,
    uint48 tradingDuration
) external payable returns (uint256 marketId);
```

### 4. MiniMarket.sol - Implementation Changes

```diff
function createMarket(
    string calldata question,
+   string calldata schemaURI,
    address paymentToken,
    uint256 maxSlots,
    uint256 ticketCost,
    uint64 drandTargetRound,
    bytes32 drandChainHash,
    uint48 tradingDuration
) external payable nonReentrant returns (uint256 marketId) {
    require(bytes(question).length > 0, "Empty question");
+   require(bytes(schemaURI).length > 0, "Empty schema URI");
    // ... rest of validation

    MarketConfig storage config = configs[marketId];
    config.marketId = marketId;
    config.question = question;
+   config.schemaURI = schemaURI;
    // ... rest of config

-   emit MarketCreated(marketId, question, maxSlots, ticketCost, drandTargetRound);
+   emit MarketCreated(marketId, question, schemaURI, maxSlots, ticketCost, drandTargetRound);
}

function _requestResolutionInternal(uint256 marketId) internal {
    // ... validation

    resolutionRequested[marketId] = true;

-   emit ResolutionRequested(marketId, tradingEnd);
+   emit ResolutionRequested(marketId, configs[marketId].schemaURI, tradingEnd);
}
```

---

## CRE Workflow Implementation

### Directory Structure

```
cre-workflow/
├── workflow.yaml              # Workflow configuration
├── config.json                # Runtime config (RPC, addresses)
├── main.ts                    # Entry point with handlers
├── schemas/
│   ├── price.ts               # Price resolution logic
│   ├── sports.ts              # Sports resolution logic
│   └── ai.ts                  # AI resolution logic
├── lib/
│   ├── schema-fetcher.ts      # Fetch and parse schema from URI
│   ├── drand.ts               # Drand decryption utilities
│   └── merkle.ts              # Merkle tree utilities
└── types.ts                   # TypeScript interfaces
```

### workflow.yaml

```yaml
name: minimarket-cre
triggers:
  - type: cron
    schedule: "*/1 * * * * *"   # Every 1 minute for info reveal
  - type: cron
    schedule: "*/5 * * * * *"   # Every 5 minutes for resolution
```

### config.json

```json
{
  "marketAddress": "0x...",
  "chainSelectorName": "base-testnet-sepolia",
  "drandNetwork": {
    "chainHash": "0xdbd506d6ef76e5f386f41c651dcb808c5bcbd75471cc4eafa3ccac746459b582",
    "genesis": 1692803367,
    "period": 3,
    "httpClient": "https://api.drand.sh"
  },
  "geminiApiKey": "${GEMINI_API_KEY}"
}
```

### main.ts - Entry Point

```typescript
import { cre, type Runtime, Runner, getNetwork, EVMLog } from "@chainlink/cre-sdk";
import { keccak256, toHex, decodeEventLog, parseAbi } from "viem";

const INFO_REVEAL_HASH = keccak256(toHex("InfoRevealRequested(uint256,uint64,uint256)"));
const RESOLUTION_HASH = keccak256(toHex("ResolutionRequested(uint256,string,uint48)"));

const onInfoRevealTrigger = async (runtime: Runtime<Config>, log: EVMLog) => {
  // 1. Decode event
  // 2. Fetch submissions from contract
  // 3. Decrypt with drand
  // 4. Build merkle tree
  // 5. Call revealInfoPhase()
};

const onResolutionTrigger = async (runtime: Runtime<Config>, log: EVMLog) => {
  // 1. Decode event (includes schemaURI)
  // 2. Fetch schema from URI
  // 3. Execute resolution based on schema type
  // 4. Determine outcome (YES/NO/NOT_YET)
  // 5. If resolved, call resolveMarket()
};

const initWorkflow = (config: Config) => {
  const network = getNetwork({
    chainFamily: "evm",
    chainSelectorName: config.chainSelectorName,
    isTestnet: true,
  });

  const evmClient = new cre.capabilities.EVMClient(network.chainSelector.selector);

  return [
    cre.handler(
      evmClient.logTrigger({
        addresses: [config.marketAddress],
        topics: [{ values: [INFO_REVEAL_HASH] }],
        confidence: "CONFIDENCE_LEVEL_FINALIZED",
      }),
      onInfoRevealTrigger
    ),
    cre.handler(
      evmClient.logTrigger({
        addresses: [config.marketAddress],
        topics: [{ values: [RESOLUTION_HASH] }],
        confidence: "CONFIDENCE_LEVEL_FINALIZED",
      }),
      onResolutionTrigger
    ),
  ];
};

export async function main() {
  const runner = await Runner.newRunner<Config>({ configSchema });
  await runner.run(initWorkflow);
}
```

---

## Resolution Logic

### Outcome States

| State | Description | CRE Action |
|-------|-------------|------------|
| `YES` | Event confirmed true | Call `resolveMarket(marketId, YES)` |
| `NO` | Event confirmed false | Call `resolveMarket(marketId, NO)` |
| `NOT_YET` | Event hasn't occurred yet | Skip, retry on next cron |
| `INCONCLUSIVE` | Cannot determine | Emit event for manual resolution |

### Resolution Flow

```
┌─────────────────────────────────────────────────────────────────┐
│                    RESOLUTION WORKFLOW                          │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  1. Parse schema from URI                                       │
│     ├── IPFS: Fetch from gateway                                │
│     ├── HTTP: Fetch directly                                    │
│     └── Arweave: Fetch from gateway                             │
│                                                                 │
│  2. Check deadline                                              │
│     ├── If not reached: return NOT_YET                          │
│     └── If reached: proceed with resolution                     │
│                                                                 │
│  3. Query primary source                                        │
│     ├── Price: CoinGecko API or Chainlink Data Feed             │
│     ├── Sports: ESPN API                                        │
│     └── AI: Gemini with search grounding                        │
│                                                                 │
│  4. Apply comparator                                            │
│     ├── price > target → YES                                    │
│     ├── price < target → NO                                     │
│     └── price == target → INCONCLUSIVE (rare)                   │
│                                                                 │
│  5. If primary fails, use fallback                              │
│     └── AI-based resolution as backup                           │
│                                                                 │
│  6. Submit result                                               │
│     ├── If YES/NO: Call resolveMarket()                         │
│     ├── If NOT_YET: Skip (will retry)                           │
│     └── If INCONCLUSIVE: Emit ManualResolutionNeeded event      │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## Test Mock Schema URI

For testing, use a mock schema URI that doesn't require actual IPFS/HTTP:

```solidity
// In tests, use mock schema URIs
string constant MOCK_PRICE_SCHEMA = "mock://price/eth-usd/gt/4000";
string constant MOCK_SPORTS_SCHEMA = "mock://sports/nfl/superbowl/2025";
string constant MOCK_AI_SCHEMA = "mock://ai/gemini/default";
```

The CRE workflow will have a mock resolver for test schemas:

```typescript
function mockResolveSchema(schemaURI: string): Outcome {
  if (schemaURI.startsWith("mock://price")) {
    // Parse and return mock outcome
    return Outcome.YES;
  }
  if (schemaURI.startsWith("mock://sports")) {
    return Outcome.NO;
  }
  // ...
}
```

---

## Implementation Checklist

### Phase 1: Contract Changes

- [ ] Add `schemaURI` to `MarketConfig` struct in `IMarket.sol`
- [ ] Update `MarketCreated` event to include `schemaURI`
- [ ] Update `ResolutionRequested` event to include `schemaURI`
- [ ] Update `createMarket()` function signature
- [ ] Update `createMarket()` implementation
- [ ] Update `_requestResolutionInternal()` to emit schemaURI

### Phase 2: Test Updates

- [ ] Update all `createMarket()` calls in tests to pass schemaURI
- [ ] Add mock schema URI constants
- [ ] Update event expectation tests
- [ ] Add tests for schema URI validation
- [ ] Run full test suite to verify no regressions

### Phase 3: ABI Updates

- [ ] Update `ts/src/market/abi.ts` with new function signature
- [ ] Update `ts/src/market/abi.ts` with new event signatures
- [ ] Regenerate any type files

### Phase 4: CRE Workflow Setup

- [ ] Create `cre-workflow/` directory
- [ ] Initialize CRE project structure
- [ ] Implement info reveal workflow
- [ ] Implement resolution workflow with schema parsing
- [ ] Add mock resolver for test schemas

### Phase 5: Indexer Updates

- [ ] Update `ponder.schema.ts` if needed for schemaURI
- [ ] Update `index.ts` handlers for new event fields

### Phase 6: Frontend Updates

- [ ] Update market creation form to accept schema URI
- [ ] Display schema URI in market details
- [ ] Add schema builder helper (optional)

---

## Questions to Resolve

1. **Schema Storage**: Should schemas be stored on IPFS, Arweave, or can they be HTTP URLs?
   - Recommendation: Support all three with URI prefix detection

2. **Schema Versioning**: How to handle schema format changes?
   - Recommendation: Include `version` field in schema JSON

3. **Manual Fallback**: Who can manually resolve INCONCLUSIVE markets?
   - Recommendation: Contract owner with time delay, or anyone with bond

4. **Gas Costs**: Who pays for CRE transaction gas?
   - Recommendation: CRE operator pays, funded by market fees

---

## References

- [Chainlink CRE Documentation](https://docs.chain.link/cre)
- [CRE Prediction Market Demo](https://github.com/smartcontractkit/cre-gcp-prediction-market-demo)
- [CRE SDK TypeScript Reference](https://docs.chain.link/cre/reference/sdk)
