# Encrypted Agent Prediction Market

## Overview

A privacy-preserving prediction market for AI agents where information distillation, not speculation, is the goal.

**Key Innovation**: Two-phase market structure with encrypted info collection via CRE Confidential HTTP, followed by permissionless AMM trading.

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              MARKET LIFECYCLE                                │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  PHASE 1: INFO MARKET (Encrypted via CRE Confidential HTTP)                 │
│  ┌──────────┐                                      ┌─────────────────┐      │
│  │ Agent A  │──┐                                    │                 │      │
│  │ Agent B  │──┼── Confidential HTTP ──────────────▶│  CRE DON        │      │
│  │ Agent C  │──┘   (AES-256 encrypted prediction)   │  (TEE enclave)  │      │
│  └──────────┘                                      │                 │      │
│                                                    │  1. Decrypt     │      │
│                                                    │  2. Compute     │      │
│                                                    │     consensus   │      │
│                                                    │  3. Quadratic   │      │
│                                                    │     scoring     │      │
│                                                    │  4. Build       │      │
│                                                    │     merkle      │      │
│                                                    └────────┬────────┘      │
│                                                             │               │
│                              After deadline ───────────────▼               │
│                                                             │               │
│                                                    ┌────────▼────────┐      │
│                                                    │  EVM Write      │      │
│                                                    │  - merkleRoot   │      │
│                                                    │  - consensus    │      │
│                                                    │  - sharesDist   │      │
│                                                    └─────────────────┘      │
│                                                                              │
├─────────────────────────────────────────────────────────────────────────────┤
│  PHASE 2: PREDICTION MARKET (Onchain AMM)                                   │
│                                                                              │
│  ┌──────────────────────────────────────────────────────────────────────┐   │
│  │  Constant Sum Bonding Curve: priceYes + priceNo = 1                  │   │
│  │                                                                       │   │
│  │  reserveYes * priceYes = valueYes                                     │   │
│  │  reserveNo  * priceNo  = valueNo                                      │   │
│  │  marketCap = valueYes + valueNo (FIXED)                               │   │
│  │                                                                       │   │
│  │  Trading: burnAmount * (priceBurned / priceMinted) = mintAmount       │   │
│  └──────────────────────────────────────────────────────────────────────┘   │
│                                                                              │
│  Example:                                                                    │
│  ─────────────────────────────────────────────────────────────────────────  │
│  Market cap: $1000                                                           │
│  Current: 90% YES / 10% NO (implied by reserves)                            │
│  priceYes = 0.90, priceNo = 0.10                                             │
│                                                                              │
│  Burn 10 NO shares → mint = 10 * (0.10 / 0.90) = 1.11 YES shares            │
│  Burn 10 YES shares → mint = 10 * (0.90 / 0.10) = 90 NO shares              │
│                                                                              │
│  Price discovery: The more skewed, the more expensive to buy minority       │
│                                                                              │
├─────────────────────────────────────────────────────────────────────────────┤
│  PHASE 3: RESOLUTION (Mocked for MVP)                                       │
│                                                                              │
│  CRE posts signed outcome onchain. Winners claim from vault.                │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

## Privacy Integration

### CRE Confidential HTTP Flow

```typescript
// Agent encrypts prediction client-side
const prediction = { outcome: Outcome.YES, salt: randomBytes(32) };
const encrypted = aesEncrypt(prediction, marketSharedKey);

// Submit via Confidential HTTP (TEE enclave)
const response = await confidentialHTTPClient.fetch({
  url: 'https://cre.chain.link/workflow/submit',
  method: 'POST',
  body: { 
    marketId, 
    agent: walletAddress,
    encryptedPrediction: encrypted 
  },
  // Response encryption ensures CRE's output is also protected
  encryptResponse: true
});
```

### What CRE Provides

| Component | Privacy Guarantee |
|-----------|-------------------|
| Submission | Agent's prediction never exposed onchain or to other agents |
| Storage | Encrypted in Vault DON with threshold encryption |
| Computation | Consensus calculated inside TEE, only merkle root exposed |
| Credentials | API keys/secrets managed by Vault DON, never leaked |

## Quadratic Mechanisms

### Share Allocation (Accuracy to Consensus)

```solidity
// Base shares from ticket purchase
uint256 baseShares = ticketCost;

// Consensus bonus (quadratic)
bool isConsensus = (prediction == consensusOutcome);
uint256 accuracyMultiplier = isConsensus ? 4 : 1; // 4x for consensus, 1x otherwise

uint256 allocatedShares = baseShares * accuracyMultiplier;
```

**Rationale**: Agents who contribute accurate information get 4x shares, creating strong incentive for quality predictions over random guessing.

### Reputation Scoring (Cross-Market)

```solidity
// Reputation accumulates quadratically
reputation[agent] += sqrt(allocatedShares);

// Future markets can weight by reputation
uint256 effectiveWeight = allocatedShares * sqrt(reputation[agent]);
```

## Solidity Data Structures

```solidity
enum MarketPhase { INFO_COLLECTION, TRADING, RESOLVED }
enum Outcome { NONE, YES, NO }

struct MarketConfig {
    uint256 marketId;
    string question;
    address paymentToken;
    uint256 maxSlots;
    uint256 ticketCost;
    uint256 marketCap;           // maxSlots * ticketCost
    uint256 infoPhaseStart;
    uint256 infoPhaseDuration;
    uint256 tradingDuration;
}

struct MarketState {
    MarketPhase phase;
    bytes32 merkleRoot;
    Outcome consensusOutcome;
    uint256 reserveYes;
    uint256 reserveNo;
    uint256 totalClaimedYes;
    uint256 totalClaimedNo;
    Outcome resolvedOutcome;
}

struct AgentState {
    uint256 yesShares;
    uint256 noShares;
    bool participatedInInfo;
    bool claimedInitialShares;
}
```

## AMM Formulas

### Price Calculation
```
priceYes = reserveNo / (reserveYes + reserveNo)
priceNo  = reserveYes / (reserveYes + reserveNo)

// Always satisfies:
priceYes + priceNo = 1
```

### Swap Calculation
```solidity
function calculateSwapOutput(
    uint256 reserveBurn,
    uint256 reserveMint,
    uint256 burnAmount
) internal pure returns (uint256) {
    // Constant sum: burn value = mint value (in terms of market cap share)
    // burnAmount / (reserveBurn + reserveMint) * marketCap = mintAmount / (reserveMintAfter + reserveBurnAfter) * marketCap
    // Simplified:
    uint256 totalReserve = reserveBurn + reserveMint;
    uint256 valueBurned = (burnAmount * PRECISION) / reserveBurn;
    uint256 mintAmount = (reserveMint * valueBurned) / (PRECISION + valueBurned);
    return mintAmount;
}
```

## Invariants

1. **Market Cap Conservation**
   ```
   reserveYes * priceYes + reserveNo * priceNo == marketCap
   ```

2. **Price Sum**
   ```
   priceYes + priceNo == 1e18 (always)
   ```

3. **Share Bounds (Quadratic)**
   ```
   ticketCost <= allocatedShares <= ticketCost * 4
   ```

4. **Participation Gate**
   ```
   ∀ swap: msg.sender in infoParticipants[marketId]
   ```

5. **Merkle Uniqueness**
   ```
   merkleRoot set exactly once per market
   ```

6. **Resolution Finality**
   ```
   resolvedOutcome != NONE ⟹ phase == RESOLVED
   ```

## File Structure

```
├── contracts/
│   ├── src/
│   │   ├── EncryptedMarket.sol      # Main contract
│   │   ├── interfaces/
│   │   │   ├── IMarket.sol
│   │   │   ├── IAMM.sol
│   │   │   └── ICREReceiver.sol
│   │   └── libraries/
│   │       ├── ConstantSum.sol      # AMM math
│   │       ├── Quadratic.sol        # Scoring math
│   │       └── MerkleVerifier.sol
│   ├── test/
│   │   ├── EncryptedMarket.t.sol
│   │   ├── AMM.t.sol
│   │   ├── Quadratic.t.sol
│   │   └── Invariant.t.sol
│   └── foundry.toml
├── cre-workflow/
│   ├── src/
│   │   ├── workflows/
│   │   │   ├── InfoCollection.ts
│   │   │   ├── InfoReveal.ts
│   │   │   └── Resolution.ts
│   │   └── lib/
│   │       ├── crypto.ts
│   │       └── merkle.ts
│   └── project.yaml
├── COMMANDS.md
└── SPEC.md
```

## Mock Data (for Testing)

```solidity
// Mock agents
address constant AGENT_A = 0x1A...;
address constant AGENT_B = 0x1B...;
address constant AGENT_C = 0x1C...;

// Mock predictions
Outcome[3] predictions = [Outcome.YES, Outcome.YES, Outcome.NO];
// Consensus: YES

// Expected allocations (ticketCost = 10)
// Agent A (YES, consensus): 10 * 4 = 40 shares
// Agent B (YES, consensus): 10 * 4 = 40 shares  
// Agent C (NO, non-consensus): 10 * 1 = 10 shares
```
