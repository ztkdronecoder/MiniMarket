# CRE Workflow Testing Guide

## Prerequisites

### 1. Install Dependencies

```bash
# Install CRE CLI
curl -sSL https://cre.chain.link/install.sh | bash
source $HOME/.cre/env

# Install Bun (for TypeScript workflows)
curl -fsSL https://bun.sh/install | bash
```

### 2. Configure Secrets

Create `cre-workflow/secrets.yaml` with your API keys:

```yaml
# cre-workflow/secrets.yaml
GEMINI_API_KEY: "your_gemini_api_key_here"
CRE_ETH_PRIVATE_KEY: "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80"
```

Also update `cre-workflow/.env`:

```
GEMINI_API_KEY=your_gemini_api_key_here
CRE_ETH_PRIVATE_KEY=0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80
```

### 3. Gemini API Key Requirements

- Must be a **paid** Google Cloud API key (free tier quota is exhausted)
- Enable Generative Language API in Google Cloud Console
- If you get `RESOURCE_EXHAUSTED` errors, the key has no quota

## Running the Full Test Workflow

```bash
cd /home/ztk/projects/reveal
bash scripts/test-workflow.sh
```

This will:
1. Start anvil on port 8545
2. Deploy MiniMarket contract
3. Create a test market
4. Build the CRE workflow
5. Start Ponder indexer
6. Run workflow simulation

## Quick Test Commands

### Start Anvil
```bash
anvil --chain-id 31337 --port 8545 --code-size-limit 50000 --quiet &
```

### Deploy Contract
```bash
cd contracts
BYTECODE=$(cat out/MiniMarket.sol/MiniMarket.json | jq -r '.bytecode.object')
cast send --rpc-url http://127.0.0.1:8545 \
    --private-key 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80 \
    --create "${BYTECODE}" \
    "constructor(address,address)" \
    0x0000000000000000000000000000000000000001 \
    0x0000000000000000000000000000000000000002
```

### Create Market
```bash
# Update with your contract address
cast send --rpc-url http://127.0.0.1:8545 \
    --private-key 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80 \
    CONTRACT_ADDRESS \
    "createMarket(string,string,address,uint256,uint256,uint64,bytes32,uint48)" \
    "Your question here" \
    "gemini://" \
    0x0000000000000000000000000000000000000000 \
    10 \
    100000000000000000 \
    1000 \
    0xdbd506d6ef76e5f386f41c651dcb808c5bcbd75471cc4eafa3ccac746459b582 \
    300 \
    --value 1000000000000000000
```

### Run Resolution Workflow

1. Update `cre-workflow/package.json` with the correct tx hash:
```json
"simulate:resolution": "cre workflow simulate minimarket --target local-simulation --trigger-index 1 --evm-tx-hash YOUR_TX_HASH --evm-event-index 0 --non-interactive"
```

2. Run:
```bash
cd cre-workflow
npm run build
npm run simulate:resolution
```

## Testing with Different Questions

Edit `scripts/test-workflow.sh`:

```bash
# Line ~148-149
QUESTION="Your question here"
SCHEMA_URI="gemini://"  # or "mock://" for mock responses
```

## Schema URI Formats

- `mock://any-text` - Returns mock YES/NO response
- `gemini://` - Uses Gemini AI to resolve (requires valid API key)
- `ipfs://Qm...` - Fetch schema from IPFS (not implemented)

## Common Issues

### "secrets.yaml not found"
```bash
cp cre-workflow/secrets.yaml.example cre-workflow/secrets.yaml
# Edit with your API keys
```

### "ABI event not found" during simulation
This is a known CRE SDK issue. The simulation uses its own ABI. The workflow still processes correctly.

### "RESOURCE_EXHAUSTED" on Gemini
Your API key has no quota. Get a paid Google Cloud API key with billing enabled.

### Ponder indexer API errors
If you see `Cannot read properties of undefined (reading 'get')`, the API format changed in Ponder 0.16. Use Hono directly - see `indexer/src/api/index.ts`.

## Files

- `scripts/test-workflow.sh` - Main test orchestration
- `contracts/src/MiniMarket.sol` - Smart contract
- `cre-workflow/minimarket/main.ts` - CRE workflow logic
- `cre-workflow/minimarket/resolvers/gemini.ts` - Gemini integration
- `cre-workflow/secrets.yaml` - API keys (DO NOT COMMIT)
