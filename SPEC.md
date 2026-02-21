# Encrypted Agent Prediction Market - Drand Timelock Edition

## Overview

Privacy-preserving prediction market for AI agents using **drand timelock encryption**. No key management, naturally time-based reveal, fully trustless.

**Key Innovation**: Agents encrypt predictions to a future drand round. The key literally doesn't exist until that round occurs. CRE decrypts offchain and validates.

## Drand Timelock Encryption

### How It Works

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                          DRAND TIMELOCK FLOW                                 │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  1. ENCRYPTION (Now)                                                         │
│  ┌──────────────┐                                                           │
│  │ Agent        │  plaintext: { outcome: YES, agent: 0x..., salt: 0x... }   │
│  │              │                                                           │
│  │ tlock-js     │  targetRound = currentRound + (duration / 3s)             │
│  │              │                                                           │
│  │ encrypt()    │──────────────────────────────────────────────┐            │
│  └──────────────┘                                              │            │
│                                                                ▼            │
│                                                    ┌─────────────────────┐   │
│                                                    │  Ciphertext         │   │
│                                                    │  (can't decrypt     │   │
│                                                    │   until round)      │   │
│                                                    └─────────────────────┘   │
│                                                                              │
│  2. SUBMISSION (Onchain)                                                     │
│  ┌──────────────┐    submitEncrypted(                                        │
│  │ Agent        │        ciphertext,                                         │
│  │              │        validationHash,   // keccak256(outcome+agent+salt)  │
│  │              │        targetRound                                          │
│  │              │    )                                                        │
│  └──────────────┘                                                           │
│                                                                              │
│  3. WAIT FOR ROUND                                                           │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │                                                                      │    │
│  │   Time ────────────────────────────────────────────────────────▶    │    │
│  │                                                                      │    │
│  │   Round N        Round N+1        ...        Round N+M              │    │
│  │   (now)                                                   (reveal)  │    │
│  │                                                                      │    │
│  │   Key doesn't exist yet ──────────────────▶ Key is published        │    │
│  │                                                                      │    │
│  └─────────────────────────────────────────────────────────────────────┘    │
│                                                                              │
│  4. DECRYPTION (CRE Workflow)                                                │
│  ┌──────────────┐                                                           │
│  │ CRE          │  1. Fetch drand beacon for targetRound                  │
│  │              │  2. Decrypt all ciphertexts                              │
│  │              │  3. Validate: keccak256(decrypted) == validationHash    │
│  │              │  4. Exclude invalid (garbage) submissions               │
│  │              │  5. Compute consensus                                    │
│  │              │  6. Build merkle tree of allocations                     │
│  │              │  7. Post merkle root onchain                             │
│  └──────────────┘                                                           │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Drand Networks

| Network | Chain Hash | Round Period | Genesis Time |
|---------|-----------|--------------|--------------|
| quicknet | `dbd506d6ef76e5f386f41c651dcb808c5bcbd75471cc4eafa3ccac746459b582` | 3 seconds | 1692803367 |

### Round Calculation

```typescript
import { roundForTime, timeForRound } from 'tlock-js';

const DRAND_PERIOD = 3; // seconds
const DRAND_GENESIS = 1692803367;

function targetRoundForDuration(durationSeconds: number, currentRound: number): number {
  return currentRound + Math.ceil(durationSeconds / DRAND_PERIOD);
}

function timeForRound(round: number): number {
  return DRAND_GENESIS + round * DRAND_PERIOD;
}
```

## Anti-Garbage Validation

### Problem
User could submit random bytes as "encrypted" data. CRE would decrypt garbage and have no way to validate.

### Solution
```solidity
// Agent computes offchain:
bytes32 validationHash = keccak256(abi.encodePacked(
    outcome,      // uint8: 1=YES, 2=NO
    agent,        // address
    salt          // bytes32: random
));

// Agent submits onchain:
function submitEncrypted(
    bytes calldata ciphertext,    // tlock encrypted {outcome, agent, salt}
    bytes32 validationHash,       // commitment to the content
    uint64 targetRound            // drand round for decryption
) external;

// CRE validates after decryption:
// decrypted = {outcome, agent, salt}
// if (keccak256(abi.encodePacked(outcome, agent, salt)) != validationHash) {
//     // INVALID - exclude from consensus
// }
```

This forces agents to submit valid predictions, because:
1. They must know `outcome + agent + salt` to compute `validationHash`
2. This is committed before the drand round (key doesn't exist yet)
3. After decryption, content must match the commitment
4. Garbage submissions are detected and excluded

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              MARKET LIFECYCLE                                │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  PHASE 1: INFO MARKET (Drand Timelock)                                      │
│                                                                              │
│  ┌──────────┐                                      ┌─────────────────┐      │
│  │ Agent A  │──┐                                    │                 │      │
│  │ Agent B  │──┼── submitEncrypted() ──────────────▶│  Smart Contract │      │
│  │ Agent C  │──┘   - ciphertext                     │                 │      │
│  └──────────┘     - validationHash                  │  stores:        │      │
│                   - targetRound                     │  - ciphertext   │      │
│                                                    │  - validationH  │      │
│                                                    │  - round        │      │
│                                                    └────────┬────────┘      │
│                                                             │               │
│                              After drand round ────────────▼               │
│                                                             │               │
│                                                    ┌────────▼────────┐      │
│                                                    │  CRE Workflow   │      │
│                                                    │                 │      │
│                                                    │  1. Fetch drand │      │
│                                                    │     beacon      │      │
│                                                    │  2. Decrypt all │      │
│                                                    │  3. Validate    │      │
│                                                    │  4. Compute     │      │
│                                                    │     consensus   │      │
│                                                    │  5. Build merkle│      │
│                                                    │  6. Post onchain│      │
│                                                    └─────────────────┘      │
│                                                                              │
├─────────────────────────────────────────────────────────────────────────────┤
│  PHASE 2: PREDICTION MARKET (Onchain AMM)                                   │
│                                                                              │
│  Same as before - constant sum bonding curve, only info participants trade  │
│                                                                              │
├─────────────────────────────────────────────────────────────────────────────┤
│  PHASE 3: RESOLUTION                                                        │
│                                                                              │
│  CRE posts outcome, winners claim from vault                                │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

## Solidity Data Structures

```solidity
struct MarketConfig {
    uint256 marketId;
    string question;
    address paymentToken;
    uint256 maxSlots;
    uint256 ticketCost;
    uint256 marketCap;
    
    // Drand configuration
    uint64 drandTargetRound;      // Round for decryption
    bytes32 drandChainHash;       // Network identifier
    
    uint48 createdAt;
    uint48 tradingDuration;
}

struct EncryptedSubmission {
    address agent;
    bytes ciphertext;            // tlock encrypted payload
    bytes32 validationHash;      // keccak256(outcome + agent + salt)
    uint64 targetRound;
    uint256 ticketCost;
}

struct MarketState {
    MarketPhase phase;
    bytes32 merkleRoot;
    Outcome consensusOutcome;
    uint128 reserveYes;
    uint128 reserveNo;
    Outcome resolvedOutcome;
}

struct DecryptedPrediction {
    address agent;
    Outcome outcome;
    bytes32 salt;
    bool valid;  // validationHash matches
}
```

## CRE Workflow (TypeScript)

```typescript
import { timelockDecrypt, DrandHttpClient } from 'tlock-js';
import { ethers } from 'ethers';

const DRAND_QUICKNET = {
  chainHash: 'dbd506d6ef76e5f386f41c651dcb808c5bcbd75471cc4eafa3ccac746459b582',
  genesis: 1692803367,
  period: 3
};

async function decryptAndReveal(marketId: number, contract: ethers.Contract) {
  // 1. Get market config
  const config = await contract.configs(marketId);
  const targetRound = config.drandTargetRound;
  
  // 2. Get all submissions
  const submissions = await contract.getSubmissions(marketId);
  
  // 3. Fetch drand beacon
  const drandClient = new DrandHttpClient('https://api.drand.sh', DRAND_QUICKNET.chainHash);
  const beacon = await drandClient.getBeacon(targetRound);
  
  // 4. Decrypt and validate each submission
  const validPredictions: DecryptedPrediction[] = [];
  
  for (const sub of submissions) {
    try {
      const decrypted = await timelockDecrypt(
        Buffer.from(sub.ciphertext),
        drandClient
      );
      
      const parsed = JSON.parse(decrypted.toString());
      
      // Validate
      const validationHash = ethers.solidityPackedKeccak256(
        ['uint8', 'address', 'bytes32'],
        [parsed.outcome, sub.agent, parsed.salt]
      );
      
      if (validationHash === sub.validationHash) {
        validPredictions.push({
          agent: sub.agent,
          outcome: parsed.outcome,
          salt: parsed.salt,
          valid: true
        });
      }
    } catch (e) {
      // Invalid decryption - exclude
      console.log(`Invalid submission from ${sub.agent}`);
    }
  }
  
  // 5. Compute consensus
  const yesCount = validPredictions.filter(p => p.outcome === 1).length;
  const noCount = validPredictions.filter(p => p.outcome === 2).length;
  const consensus = yesCount > noCount ? 1 : 2;
  
  // 6. Quadratic allocation
  const allocations = validPredictions.map(p => ({
    agent: p.agent,
    outcome: p.outcome,
    shares: p.outcome === consensus 
      ? config.ticketCost * 4n 
      : config.ticketCost
  }));
  
  // 7. Build merkle tree
  const merkleTree = buildMerkleTree(allocations);
  
  // 8. Calculate reserves
  const totalYes = allocations
    .filter(a => a.outcome === 1)
    .reduce((sum, a) => sum + a.shares, 0n);
  const totalNo = allocations
    .filter(a => a.outcome === 2)
    .reduce((sum, a) => sum + a.shares, 0n);
  
  // 9. Post to contract
  await contract.revealInfoPhase(
    marketId,
    merkleTree.root,
    consensus,
    totalYes,
    totalNo
  );
}
```

## Advantages Over AES/Confidential HTTP

| Aspect | AES + CRE Confidential HTTP | Drand Timelock |
|--------|----------------------------|----------------|
| Key Management | Complex (shared keys, rotation) | None (key doesn't exist until round) |
| Trust Model | Trust CRE nodes | Trust drand threshold network |
| Timing | Manual trigger | Automatic (round-based) |
| Transparency | Opaque | Public beacons |
| Decentralization | CRE nodes hold keys | Threshold distributed |
| Gas Cost | Same | Same |
| Client Complexity | Higher (key exchange) | Lower (just encrypt) |

## Invariants

1. **Round Timing**: `targetRound > currentRound` at submission
2. **Validation Integrity**: `keccak256(outcome, agent, salt) == validationHash`
3. **Decryption Timing**: CRE can only decrypt after `block.timestamp >= timeForRound(targetRound)`
4. **Share Bounds**: `ticketCost <= allocation <= ticketCost * 4`

## File Structure

```
├── contracts/
│   ├── src/
│   │   ├── MiniMarket.sol           # Main contract with drand integration
│   │   ├── interfaces/
│   │   │   └── IMarket.sol
│   │   └── libraries/
│   │       ├── ConstantSum.sol
│   │       ├── Quadratic.sol
│   │       └── MerkleVerifier.sol
│   └── test/
│       ├── MiniMarket.t.sol
│       └── DrandIntegration.t.sol
├── cre-workflow/
│   ├── src/
│   │   ├── workflows/
│   │   │   └── DrandReveal.ts
│   │   └── lib/
│   │       ├── drand.ts
│   │       └── merkle.ts
│   └── package.json
├── SPEC.md
└── COMMANDS.md
```
