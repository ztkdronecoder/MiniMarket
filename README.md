# MiniMarket

**Privacy-Preserving Prediction Market with Drand Timelock Encryption**

MiniMarket is a fully autonomous prediction market protocol where agents submit encrypted predictions that can only be decrypted after a future drand round. Schema is stored onchain as JSON. The `workflows/phase-1` and `workflows/phase-2` cron workflows handle info reveal and resolution via Ponder-indexed data.

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              MINIMARKET PROTOCOL                             │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────┐    ┌────────────┐ │
│  │   CREATOR    │    │    AGENT     │    │  CRE AGENT   │    │  RESOLVER  │ │
│  │              │    │              │    │              │    │            │ │
│  │ 1. Create   │    │ 1. Encrypt   │    │ 1. Monitor   │    │ 1. Read    │ │
│  │    market   │    │    prediction│    │    drand     │    │    schema │ │
│  │    w/ schema│    │    to target │    │    rounds    │    │    (Ponder)│ │
│  │              │    │    round     │    │              │    │            │ │
│  │ 2. Fund      │    │ 2. Submit    │    │ 2. Decrypt   │    │ 2. Query   │ │
│  │    market    │    │    encrypted │    │    all subs  │    │    sources │ │
│  │              │    │              │    │ 3. Build     │    │ 3. Submit  │ │
│  │ 3. Fund      │    │              │    │    merkle    │    │    outcome │ │
│  │    market    │    │              │    │              │    │            │ │
│  └──────────────┘    └──────────────┘    └──────────────┘    └────────────┘ │
│         │                   │                    │                  │       │
│         ▼                   ▼                    ▼                  ▼       │
│  ┌──────────────────────────────────────────────────────────────────────┐   │
│  │                        MINIMARKET CONTRACT                           │   │
│  │                                                                      │   │
│  │  Phase 1: INFO_COLLECTION                                           │   │
│  │  ├── Market created with schemaJson (onchain)                       │   │
│  │  ├── Agents submit encrypted predictions                            │   │
│  │  └── Wait for drand target round                                    │   │
│  │                                                                      │   │
│  │  Phase 2: TRADING                                                   │   │
│  │  ├── CRE reveals decrypted predictions (merkle tree)                │   │
│  │  ├── Agents claim shares via merkle proof                           │   │
│  │  └── Agents swap shares on AMM                                      │   │
│  │                                                                      │   │
│  │  Phase 3: RESOLVED                                                  │   │
│  │  ├── CRE resolves market outcome                                    │   │
│  │  └── Winners claim payouts                                          │   │
│  └──────────────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────────┘
```

## Project Structure

```
reveal/
├── contracts/                 # Foundry project
│   ├── src/
│   │   ├── MiniMarket.sol     # Core prediction market contract
│   │   ├── interfaces/
│   │   │   └── IMarket.sol    # Market interface with schemaJson
│   │   ├── libraries/
│   │   │   ├── ConstantSum.sol    # AMM bonding curve
│   │   │   ├── Quadratic.sol      # Share allocation
│   │   │   └── MerkleVerifier.sol # Merkle proof verification
│   │   └── SPDC.sol           # Deployment addresses
│   ├── test/
│   │   └── MiniMarket.t.sol   # 59 passing tests
│   └── script/
│       └── Deploy.s.sol       # Deployment scripts
│
├── ts/                        # TypeScript SDK
│   ├── src/
│   │   ├── drand/             # Drand encryption/decryption
│   │   ├── market/            # Market client, ABI
│   │   └── cre/               # CRE workflow utilities
│   └── package.json
│
├── indexer/                   # Ponder indexer
│   ├── ponder.config.ts
│   ├── ponder.schema.ts       # Database schema
│   └── src/
│       └── index.ts           # Event handlers
│
├── workflows/                 # Phase 1 & 2 cron workflows
│   ├── phase-1/               # Info reveal (drand decrypt, merkle)
│   └── phase-2/               # Resolution (Gemini, resolveMarket)
│
└── frontend/                  # Next.js frontend
    └── src/
        ├── components/
        │   ├── MarketList.tsx
        │   ├── MarketDetail.tsx
        │   └── PriceChart.tsx
        └── lib/
            ├── marketApi.ts
            └── types.ts
```

## Key Concepts

### Schema (onchain JSON)

Each market has a `schemaJson` stored onchain—the publisher sends the full resolution schema as a JSON string when creating the market:

```json
{
  "version": "1.0",
  "type": "price",
  "description": "Will ETH be above $4000 on March 1, 2025?",
  "deadline": 1740844800,
  "resolution": {
    "type": "web_query",
    "sources": [
      {
        "type": "api",
        "url": "https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd",
        "jsonPath": "$.ethereum.usd"
      }
    ],
    "comparator": ">",
    "targetValue": "4000000000000000000000"
  },
  "fallback": {
    "type": "ai",
    "provider": "gemini",
    "prompt": "What was the price of ETH in USD on March 1, 2025?"
  }
}
```

### Drand Timelock Encryption

Agents encrypt their predictions to a future drand round using tlock-js. The encryption can only be decrypted after that round's randomness is published (~3 seconds per round on Quicknet).

```typescript
import { encryptPrediction } from '@minimarket/sdk';

const encrypted = await encryptPrediction(
  { outcome: 1, agent: agentAddress, salt: randomSalt },
  targetRound,
  drandNetwork
);
```

### Workflow Resolution (phase-1 & phase-2)

The `workflows/phase-1` and `workflows/phase-2` cron workflows handle:
1. **Phase 1 (Info Reveal)**: When drand round is reached, decrypt submissions, build merkle tree, submit `revealInfoPhase` onchain
2. **Phase 2 (Resolution)**: When trading ends, read schema from Ponder (indexed from onchain), call Gemini, submit `resolveMarket` onchain

Resolution supports multiple source types:
- **Price**: CoinGecko, Chainlink Data Feeds
- **Sports**: ESPN API
- **Weather**: NOAA API
- **AI**: Gemini with search grounding (fallback)

### Share Allocation

Valid predictions receive shares based on consensus:
- **Consensus** (matched majority): 4× base shares
- **Non-consensus**: 1× base shares

This creates a quadratic reward for agreeing with the crowd.

## Quick Start

### Prerequisites

- Foundry (`curl -L https://foundry.paradigm.xyz | bash && foundryup`)
- Node.js 20+
- Bun (`curl -fsSL https://bun.sh/install | bash`)

### Install Dependencies

```bash
# Contracts
cd contracts && forge install

# TypeScript SDK
cd ts && bun install

# Frontend
cd frontend && bun install

# Indexer
cd indexer && bun install
```

### Run Tests

```bash
cd contracts
forge test --summary
# 59 tests passing
```

### Deploy (Local)

```bash
# Terminal 1: Start local node
anvil

# Terminal 2: Deploy
cd contracts
forge script script/Deploy.s.sol:DeployMiniMarketLocal --rpc-url http://localhost:8545 --broadcast
```

### Start Frontend

```bash
cd frontend
bun run dev
# http://localhost:3000
```

### Start Indexer

```bash
cd indexer
bun run dev
# Indexes events from Base Sepolia
```

## Contract API

### Create Market

```solidity
function createMarket(
    string calldata question,
    string calldata schemaJson,    // Full resolution schema as JSON (stored onchain)
    uint256 maxSlots,
    uint256 ticketCost,            // Cost per ticket in USDC (6 decimals)
    uint64 drandTargetRound,       // Future drand round for reveal
    bytes32 drandChainHash,
    uint48 tradingDuration
) external returns (uint256 marketId);
```

All payments use USDC (set at deployment). Approve USDC before calling.

### Submit Encrypted Prediction

```solidity
function submitEncrypted(
    uint256 marketId,
    bytes calldata ciphertext,     // Timelock encrypted (outcome, agent, salt)
    bytes32 validationHash         // keccak256(outcome, agent, salt)
) external;
```

Approve USDC (ticketCost) before calling. No ETH accepted.

### Claim Shares

```solidity
function claimShares(
    uint256 marketId,
    MerkleProof calldata proof     // Proof from CRE reveal
) external;
```

### Swap Shares

```solidity
function swapShares(
    uint256 marketId,
    Outcome burnOutcome,           // YES or NO
    uint256 burnAmount
) external returns (uint256 mintAmount);
```

### Claim Payout

```solidity
function claimPayout(uint256 marketId) external;
```

## Resolution Schema Specification

### Price Schema

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
      "jsonPath": "$.ethereum.usd"
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

### Sports Schema

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

### AI Schema (General Purpose)

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

## Networks

| Network | Chain ID | Contract Address |
|---------|----------|------------------|
| Base Sepolia | 84532 | `0x...` (to be deployed) |
| Localhost | 31337 | `0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512` |

## Security Considerations

1. **Double Funding**: Currently, both creator and agents deposit funds. This is a known design issue to be fixed in v2.

2. **Resolution Trust**: CRE agents determine outcomes. For production:
   - Use multiple independent agents
   - Require consensus across DON
   - Consider adding a challenge period

3. **Front-running**: Encrypted submissions prevent front-running during info phase.

4. **Merkle Proof Verification**: All share claims require valid merkle proofs.

## Development Status

- [x] Core contract (MiniMarket.sol)
- [x] Drand timelock integration
- [x] TypeScript SDK
- [x] CRE workflow structure
- [x] Ponder indexer
- [x] Next.js frontend
- [ ] Production deployment
- [ ] Multiple resolution sources
- [ ] Challenge period for disputed resolutions

## License

MIT

## Contributing

1. Fork the repository
2. Create a feature branch
3. Run tests: `forge test`
4. Submit a pull request

## Resources

- [Drand Documentation](https://drand.love/)
- [Chainlink CRE Documentation](https://docs.chain.link/cre)
- [Foundry Book](https://book.getfoundry.sh/)
- [Viem Documentation](https://viem.sh/)
