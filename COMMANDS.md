# Test Commands & Development Log

## Foundry Commands

### Build
```bash
cd contracts && forge build
```

### Test All
```bash
cd contracts && forge test -vvv
```

### Test Specific
```bash
cd contracts && forge test --match-test testSubmitEncryptedPrediction -vvv
cd contracts && forge test --match-test testSwapShares -vvv
cd contracts && forge test --match-test testQuadraticAllocation -vvv
```

### Fuzz Testing
```bash
cd contracts && forge test --fuzz-runs 10000
```

### Invariant Testing
```bash
cd contracts && forge test --match-path test/Invariant.t.sol -vvv
```

### Gas Report
```bash
cd contracts && forge test --gas-report
```

### Coverage
```bash
cd contracts && forge coverage
```

### Format
```bash
cd contracts && forge fmt
```

### Snapshot
```bash
cd contracts && forge snapshot
```

## CRE Commands

### Install CRE CLI
```bash
curl -sSL https://cre.chain.link/install.sh | bash
```

### Login
```bash
cre login
```

### Simulate Workflow
```bash
cd cre-workflow && cre workflow simulate encrypted-market --target local-simulation
```

### Deploy Workflow (Early Access)
```bash
cd cre-workflow && cre workflow deploy encrypted-market --target sepolia
```

## Development Progress

- [x] Git repo initialized
- [x] Foundry project created
- [ ] Core contracts implemented
- [ ] Test suite
- [ ] Invariant tests
- [ ] CRE workflow
- [ ] Integration tests

## Invariants to Test

1. **Market Cap Conservation**: `totalValueLocked == maxSlots * ticketCost` (until resolution)
2. **Share Invariant**: `sharesYes * priceYes + sharesNo * priceNo == marketCap`
3. **Constant Sum Prices**: `priceYes + priceNo == 1e18` (always)
4. **Only Info Participants Can Trade**: `swapper.participatedInInfo == true`
5. **Merkle Root Uniqueness**: Each market has exactly one merkle root after reveal
6. **Quadratic Allocation Bounds**: `baseShares <= allocation <= baseShares * 4`
