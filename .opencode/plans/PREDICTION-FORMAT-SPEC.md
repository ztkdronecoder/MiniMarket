# Prediction Format & Scoring Specification

## Overview

MiniMarket uses **percentage-based predictions** rather than binary YES/NO choices. This allows agents to express confidence levels and enables more nuanced scoring.

---

## Prediction Data Structure

### Encrypted Payload

When an agent submits a prediction, they encrypt the following data using drand timelock encryption:

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         ENCRYPTED PREDICTION                                 │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  Offset    Size      Field         Description                               │
│  ─────     ────      ─────         ───────────                              │
│  0x00      20 bytes  agent         Agent's Ethereum address                 │
│  0x14      32 bytes  yesPercent    Percentage allocated to YES (basis pts)  │
│  0x34      32 bytes  noPercent     Percentage allocated to NO (basis pts)   │
│  0x54      32 bytes  salt          Random salt for validation hash          │
│                                                                              │
│  Total: 116 bytes                                                           │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Field Details

| Field | Type | Size | Range | Description |
|-------|------|------|-------|-------------|
| `agent` | `address` | 20 bytes | Valid ETH address | Agent's wallet address |
| `yesPercent` | `uint256` | 32 bytes | 0-10000 | Percentage for YES in basis points (10000 = 100%) |
| `noPercent` | `uint256` | 32 bytes | 0-10000 | Percentage for NO in basis points (10000 = 100%) |
| `salt` | `bytes32` | 32 bytes | Random | Salt for validation hash |

### Constraints

```solidity
// Percentage constraint: YES + NO must equal 100% (10000 basis points)
require(yesPercent + noPercent == 10000, "Invalid allocation");
require(yesPercent > 0 && noPercent > 0, "Must allocate to both outcomes");
```

---

## Validation Hash

Before encryption, agents compute a validation hash that is submitted on-chain in plaintext:

```solidity
validationHash = keccak256(abi.encodePacked(
    agent,           // 20 bytes
    yesPercent,      // uint256
    noPercent,       // uint256
    salt             // bytes32
));
```

This allows the CRE to verify that the decrypted data matches the commitment.

---

## BN254 Field Element Encoding

Drand uses BN254 curve, so encrypted data must be compatible with field arithmetic.

### Field Element Constraints

- **Modulus**: `p = 0x30644e72e131a029b85045b68181585d97816a916871ca8d3c208c16d87cfd47`
- **Data must be < p** to be a valid field element
- Our 116-byte payload fits within multiple field elements

### Encoding Strategy

```
The 116-byte payload is split into chunks compatible with drand's encryption:

Chunk 1 (32 bytes):  agent (padded to 32) || first 12 bytes of yesPercent
Chunk 2 (32 bytes):  remaining yesPercent || noPercent
Chunk 3 (32 bytes):  salt
Chunk 4 (20 bytes):  remaining padding
```

---

## Scoring Algorithm

### Overview

When the market resolves, agents receive shares proportional to how accurately they predicted the outcome.

### Share Calculation

```solidity
// After resolution, outcome is either YES (1) or NO (2)

function calculateShares(
    uint8 resolvedOutcome,
    uint256 yesPercent,      // basis points (0-10000)
    uint256 noPercent,       // basis points (0-10000)
    uint256 ticketCost       // e.g., 1 USDC
) internal pure returns (uint256 yesShares, uint256 noShares) {
    
    // PRECISION = 1e18 for share calculations
    
    if (resolvedOutcome == 1) {
        // YES won - reward based on YES allocation
        // Higher YES percent = more YES shares
        yesShares = (ticketCost * yesPercent * PRECISION) / 10000;
        // NO shares are from wrong prediction (smaller but non-zero)
        noShares = (ticketCost * (10000 - yesPercent) * PRECISION) / (10000 * 4);
    } else {
        // NO won - reward based on NO allocation
        noShares = (ticketCost * noPercent * PRECISION) / 10000;
        // YES shares from wrong prediction
        yesShares = (ticketCost * (10000 - noPercent) * PRECISION) / (10000 * 4);
    }
}
```

### Example Scoring

**Scenario**: Market resolves YES, ticket cost = $1

| Agent | YES % | NO % | YES Shares | NO Shares | Notes |
|-------|-------|------|------------|-----------|-------|
| Alice | 9000  | 1000 | 0.9 × 10¹⁸ | 0.025 × 10¹⁸ | Strong YES prediction |
| Bob   | 5000  | 5000 | 0.5 × 10¹⁸ | 0.125 × 10¹⁸ | Neutral prediction |
| Carol | 1000  | 9000 | 0.1 × 10¹⁸ | 0.225 × 10¹⁸ | Wrong but gets some shares |

**Key insight**: 
- Correct predictions get full allocation
- Wrong predictions get 25% of what they would have gotten (consolation)
- This ensures everyone gets something, but accuracy is rewarded

---

## Merkle Tree Structure

### Leaf Format

Each merkle leaf represents one agent's claimable shares:

```solidity
struct MerkleLeaf {
    address agent;        // 20 bytes
    uint8 outcome;        // 1 byte (1=YES, 2=NO)
    uint256 yesShares;    // 32 bytes - claimable YES shares
    uint256 noShares;     // 32 bytes - claimable NO shares
}

// Leaf hash
leafHash = keccak256(abi.encodePacked(
    agent,
    outcome,
    yesShares,
    noShares
));
```

### Tree Properties

- **Binary Merkle Tree** using keccak256
- **Non-commutative** - order matters (left/right based on index)
- **Root stored on-chain** after Info Reveal

---

## IPFS Publication

### What Gets Published

After Info Reveal, CRE publishes a JSON file to IPFS containing:

```json
{
  "marketId": 1,
  "merkleRoot": "0x...",
  "resolvedOutcome": 1,
  "leaves": [
    {
      "index": 0,
      "agent": "0x...",
      "outcome": 1,
      "yesShares": "900000000000000000",
      "noShares": "25000000000000000",
      "leafHash": "0x...",
      "proof": ["0x...", "0x...", ...]
    },
    {
      "index": 1,
      "agent": "0x...",
      "outcome": 1,
      "yesShares": "500000000000000000",
      "noShares": "125000000000000000",
      "leafHash": "0x...",
      "proof": ["0x...", "0x...", ...]
    }
  ],
  "totalYesShares": "1500000000000000000",
  "totalNoShares": "150000000000000000",
  "timestamp": 1234567890,
  "drandRound": 12345678
}
```

### URI Storage

The IPFS CID is stored in the contract:

```solidity
event InfoRevealed(
    uint256 indexed marketId,
    bytes32 merkleRoot,
    uint8 consensusOutcome,
    string merkleDataURI,    // IPFS CID
    uint256 totalSubmissions
);
```

---

## Claim Flow

### Step 1: Agent Checks IPFS

Agent fetches the merkle data from IPFS using the `merkleDataURI`.

### Step 2: Agent Generates Proof

From the IPFS data, agent has:
- Their leaf index
- Their proof
- Their shares

### Step 3: Agent Claims

```solidity
function claimShares(
    uint256 marketId,
    uint256 leafIndex,
    uint8 outcome,
    uint256 yesShares,
    uint256 noShares,
    bytes32[] calldata proof
) external {
    // Verify merkle proof
    bytes32 leaf = keccak256(abi.encodePacked(msg.sender, outcome, yesShares, noShares));
    require(MerkleVerifier.verify(proof, merkleRoots[marketId], leaf, leafIndex), "Invalid proof");
    
    // Mark as claimed
    require(!claimed[marketId][msg.sender], "Already claimed");
    claimed[marketId][msg.sender] = true;
    
    // Mint shares
    if (yesShares > 0) _mint(msg.sender, marketId, YES, yesShares);
    if (noShares > 0) _mint(msg.sender, marketId, NO, noShares);
}
```

---

## Trading Shares

After claiming, agents can:

1. **Hold until resolution** - Get payout if outcome matches
2. **Trade on AMM** - Swap YES for NO or vice versa
3. **Sell to other agents** - Peer-to-peer (not implemented)

### AMM Pricing

```
price(YES) = reserve(NO) / (reserve(YES) + reserve(NO))
price(NO) = reserve(YES) / (reserve(YES) + reserve(NO))
```

---

## Summary

| Component | Description |
|-----------|-------------|
| **Prediction** | Percentage allocation (e.g., 70% YES, 30% NO) |
| **Encryption** | Drand timelock to target round |
| **Validation** | Hash of (agent, yes%, no%, salt) submitted on-chain |
| **Scoring** | Shares based on accuracy of prediction |
| **Merkle Tree** | Leaves contain agent shares for both outcomes |
| **IPFS** | Published data with proofs for claiming |
| **Claiming** | Merkle proof verification, mint shares |
| **Trading** | AMM with constant-sum bonding curve |

---

## Test Cases Required

1. **Encryption/Decryption** - Verify data survives round-trip
2. **Validation Hash** - Correct hash computation
3. **Percentage Constraints** - Must sum to 100%
4. **Scoring** - Various allocation scenarios
5. **Merkle Tree** - Build, prove, verify
6. **End-to-End** - Full prediction → reveal → claim flow
