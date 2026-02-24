# MiniMarket Scripts

End-to-end workflow for deploying and operating a MiniMarket prediction market on Base Sepolia.

## Overview

A MiniMarket has two phases:

**Phase 1 — INFO_COLLECTION**: Agents encrypt their YES probability estimate (0–1000 basis points, where 1000 = 100% YES) to a specific future drand randomness round, then post the ciphertext on-chain alongside a `validationHash`. No one can read the predictions until that drand round passes. The market creator pre-funds a prize pool of `maxSlots × ticketCost` ETH. Each agent pays `ticketCost` to participate.

**Phase 2 — TRADING**: After the target drand round, the CRE operator decrypts all submissions, computes the consensus YES% across all agents, assigns YES/NO shares to each agent via a quadratic proximity scoring function, posts a merkle root on-chain, and emits an `InfoPhaseRevealed` event containing the share distribution totals. Agents then claim their shares and can swap YES↔NO on a constant-sum bonding curve.

```
Deploy contract
      │
      ▼
create-market.sh          (wizard: question, drand round, ticket cost, reserves)
      │
      ▼
simulate-phase1.sh        (submit N encrypted basis-point votes, one per private key)
      │ cast-vote.ts × N
      ▼
[wait for drand round to pass]
      │
      ▼
simulate-cre-phase1.sh    (decrypt, compute consensus + shares, post merkle root)
      │ reveal-phase1.ts
      ▼
claim-shares.ts           (each voter calls claimShares with merkle proof)
      │
      ▼
[trade via swapShares, then resolveMarket, then claimPayout]
```

---

## Prerequisites

| Tool | Install |
|------|---------|
| **bun** | `curl -fsSL https://bun.sh/install \| bash` |
| **foundry** | `curl -L https://foundry.paradigm.xyz \| bash && foundryup` |
| **jq** | `apt install jq` / `brew install jq` |

---

## Step 0 — Deploy Contract

```bash
./scripts/deploy-base-sepolia.sh
```

Prompts for the `chack` keystore password, deploys `MiniMarket` to Base Sepolia, and writes the address to `deployed-addresses.json` in the project root.

---

## Step 1 — Create a Market

```bash
./scripts/create-market.sh
```

Interactive wizard. Reads the contract from `deployed-addresses.json`. Asks for:
- **Question** — the binary question to predict (e.g. "Will ETH > $5000 by June 1?")
- **Schema URI** — IPFS/HTTP link to the resolution criteria document
- **Drand target round** — the randomness round after which Phase 1 ends; the prediction window is `round × 3s − now` seconds from market creation
- **Trading duration** — how long Phase 2 lasts after the merkle root is posted
- **Max slots** — maximum number of Phase 1 participants
- **Ticket cost** — ETH each participant must pay (the creator also pre-funds `maxSlots × ticketCost`)
- **Payment token** — ETH (default) or an ERC-20 address

Prints the **Market ID** needed for all subsequent steps.

---

## Step 2 — Participate in Phase 1

Agents submit an encrypted prediction of the YES probability in basis points (0–1000).

```bash
# One vote, interactive
PRIVATE_KEY=0x... ./scripts/simulate-phase1.sh <marketId>

# Three votes at once: 70% YES, 30% YES, 50% YES
PRIVATE_KEY=0x... ./scripts/simulate-phase1.sh <marketId> 700 300 500

# Multiple voters from a file (one hex key per line, must match participant count)
KEYS_FILE=./keys.txt ./scripts/simulate-phase1.sh <marketId> 700 300 500
```

Internally, `cast-vote.ts` does the following for each vote:
1. Fetches `configs(marketId)` to get `ticketCost` and `drandTargetRound`
2. Generates a random `salt`
3. Constructs `{ yesPercent, noPercent, agent, salt }` where `noPercent = 1000 - yesPercent`
4. **Timelock-encrypts** the payload to `drandTargetRound` using [tlock-js](https://github.com/drand/tlock-js); only the holder of the drand randomness at that round can decrypt it
5. Computes `validationHash = keccak256(abi.encode(agent, yesPercent, noPercent, salt))`
6. Calls `submitEncrypted(marketId, ciphertext, validationHash)` with `value = ticketCost`

**Important**: each address can submit at most once per market.

---

## Step 3 — Reveal Phase 1 (CRE simulation)

After the drand target round passes, any authorized signer can run the reveal:

```bash
PRIVATE_KEY=0x... ./scripts/simulate-cre-phase1.sh <marketId>
```

This calls `reveal-phase1.ts` which:

1. Fetches all `EncryptedSubmission[]` from the contract via `getSubmission(marketId, i)`
2. Decrypts each ciphertext using tlock-js (this works only after the target drand round)
3. Validates each submission: re-computes `validationHash` from the decrypted payload and checks it matches the on-chain hash; invalid/undecryptable submissions are assigned a 50/50 default
4. Computes **consensus**: mean `yesPercent` across all submissions
5. Assigns **shares** via quadratic proximity scoring (see [Scoring](#quadratic-proximity-scoring) below)
6. Builds a **merkle tree** of leaves `keccak256(agent, yesShares, noShares)`
7. Calls `onReport(report, "0x")` where `report = abi.encode(marketId, merkleRoot, uint8(consensusOutcome), totalReserveYes, totalReserveNo, validCount, totalYesShares, totalNoShares)`

The contract stores `totalYesShares` and `totalNoShares` in `MarketState` and emits them in the `InfoPhaseRevealed` event so the indexer can compute each agent's share of the YES and NO pools without needing to aggregate `SharesClaimed` events.

> **Authorization**: `PRIVATE_KEY` must belong to an authorized signer. Authorize once from the owner key:
> ```bash
> cast send <CONTRACT> "setAuthorizedSigner(address,bool)" <YOUR_ADDRESS> true \
>   --keystore ~/.foundry/keystores/chack --rpc-url https://sepolia.base.org
> ```

---

## Step 4 — Claim Shares

After the merkle root is on-chain, each Phase 1 participant claims their `yesShares` and `noShares`:

```bash
# Claims for all participants using a keys file
KEYS_FILE=./keys.txt bun run scripts/claim-shares.ts <marketId>
```

`claim-shares.ts`:
1. Re-computes the merkle tree using the same deterministic scoring logic as `reveal-phase1.ts`
2. For each agent: calls `claimShares(marketId, { root, proof[], index, agent, yesShares, noShares })`

The contract verifies `keccak256(agent, yesShares, noShares)` is in the merkle tree, then credits the agent's `AgentState` with the allocated shares.

---

## Step 5 — Trade (Phase 2)

After claiming shares, agents can swap YES↔NO using the constant-sum bonding curve:

```bash
# Swap 10e18 YES shares for NO shares
cast send <CONTRACT> "swapShares(uint256,uint8,uint256)" <marketId> 1 10000000000000000000 \
  --rpc-url https://sepolia.base.org --private-key $PRIVATE_KEY

# burnOutcome: 1 = YES, 2 = NO
```

Price is determined by `reserveYes / reserveNo`. Trading YES→NO increases the YES price (less YES available in the pool). Trading NO→YES has the inverse effect.

---

## Step 6 — Resolve and Claim Payout

After the trading duration expires, anyone can request resolution. The CRE/owner then posts the final outcome:

```bash
# Request resolution (anyone can call after tradingEnd)
cast send <CONTRACT> "requestResolution(uint256)" <marketId> \
  --rpc-url https://sepolia.base.org --private-key $PRIVATE_KEY

# Resolve with outcome (CRE forwarder or owner)
cast send <CONTRACT> "resolveMarket(uint256,uint8)" <marketId> 1 \
  --rpc-url https://sepolia.base.org --private-key $CRE_PRIVATE_KEY
# outcome: 1 = YES, 2 = NO

# Claim payout (each winner)
cast send <CONTRACT> "claimPayout(uint256)" <marketId> \
  --rpc-url https://sepolia.base.org --private-key $PRIVATE_KEY
```

Payout = `winningShares / totalWinningShares × marketCap`. Losing-side shares are worth zero.

---

## Quadratic Proximity Scoring

Phase 1 share allocation rewards agents whose predictions are closest to the group consensus.

Given `n` participants with `yesPercent[i]` (0–1000 bp):

```
consensus = mean(yesPercent[i])

score[i]  = 1000 - |yesPercent[i] - consensus|
            ↑ max when exactly at consensus, decreases with distance

K = n × 1e18           (total shares issued per side)

yesShares[i] = K × score[i] × yesPercent[i]  /  Σ(score[j] × yesPercent[j])
noShares[i]  = K × score[i] × noPercent[i]   /  Σ(score[j] × noPercent[j])
```

Properties:
- `Σ yesShares[i] ≈ K` (integer rounding may cause small deviation)
- `Σ noShares[i]  ≈ K`
- An agent with a perfect consensus prediction gets the highest `score` **and** the most shares weighted toward their predicted direction
- An agent at 50/50 with a 70% consensus gets a mid-range score and equal yes/no shares

The `totalYesShares` and `totalNoShares` emitted in `InfoPhaseRevealed` are the actual sums after integer division, so the indexer can compute `agent.yesShares / totalYesShares` as an exact fraction.

---

## Script Reference

| Script | Type | Description |
|--------|------|-------------|
| `deploy-base-sepolia.sh` | shell | Deploy MiniMarket to Base Sepolia |
| `create-market.sh` | shell | Interactive market creation wizard |
| `simulate-phase1.sh` | shell | Submit N encrypted basis-point votes |
| `simulate-cre-phase1.sh` | shell | CRE reveal: decrypt → score → merkle → onReport |
| `cast-vote.ts` | TypeScript | Submit one encrypted vote |
| `reveal-phase1.ts` | TypeScript | Full CRE reveal workflow |
| `claim-shares.ts` | TypeScript | Claim Phase 1 shares for all participants |
| `show-market.ts` | TypeScript | Print current market state |
| `deploy-local.sh` | shell | Deploy to local anvil for development |

---

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `MARKET_ADDRESS` | Contract address | from `deployed-addresses.json` |
| `RPC_URL` | RPC endpoint | `https://sepolia.base.org` |
| `PRIVATE_KEY` | Hex private key for signing | — |
| `KEYS_FILE` | Path to file with one key per line | — |
| `KEYSTORE` | Foundry keystore path | `~/.foundry/keystores/chack` |

---

## On-chain Data Layout

```
MarketState (10 fields after revealInfoPhase):
  phase            uint8   — 0=INFO_COLLECTION, 1=TRADING, 2=RESOLVED
  merkleRoot       bytes32 — root of the Phase 1 share allocation tree
  consensusOutcome uint8   — 1=YES if consensus >= 500bp, 2=NO otherwise
  reserveYes       uint128 — YES-side trading reserve (bonding curve)
  reserveNo        uint128 — NO-side trading reserve (bonding curve)
  totalClaimedYes  uint128 — YES shares claimed so far (running sum)
  totalClaimedNo   uint128 — NO shares claimed so far (running sum)
  resolvedOutcome  uint8   — final outcome after resolveMarket()
  totalYesShares   uint128 — sum of yesShares in the merkle tree (set at reveal)
  totalNoShares    uint128 — sum of noShares in the merkle tree (set at reveal)
```

The indexer should listen for `InfoPhaseRevealed(marketId, merkleRoot, consensusOutcome, totalReserveYes, totalReserveNo, validSubmissions, totalYesShares, totalNoShares)` and use `totalYesShares`/`totalNoShares` to serve the ownership % for each agent without having to sum all `SharesClaimed` events.
