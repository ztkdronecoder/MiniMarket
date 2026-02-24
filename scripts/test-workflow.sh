#!/bin/bash
set -e

echo "=========================================="
echo "   CRE Workflow Test - MiniMarket"
echo "=========================================="
echo ""

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"
CONTRACTS_DIR="$ROOT_DIR/contracts"
CRE_DIR="$ROOT_DIR/cre-workflow"

export PATH="$HOME/.cre/bin:$HOME/.bun/bin:$PATH"

DEFAULT_PRIVATE_KEY="0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80"

cleanup() {
    echo ""
    echo "Cleaning up..."
    pkill -f "anvil" 2>/dev/null || true
    echo "Done."
}

trap cleanup EXIT

echo "Stopping any existing services..."
pkill -f "anvil" 2>/dev/null || true
pkill -f "ponder" 2>/dev/null || true
sleep 2
echo ""

echo "Checking dependencies..."
command -v anvil >/dev/null 2>&1 || { echo "ERROR: anvil not found"; exit 1; }
command -v cast >/dev/null 2>&1 || { echo "ERROR: cast not found"; exit 1; }
command -v jq >/dev/null 2>&1 || { echo "ERROR: jq not found"; exit 1; }
command -v cre >/dev/null 2>&1 || { echo "ERROR: CRE CLI not found"; exit 1; }
command -v bun >/dev/null 2>&1 || { echo "ERROR: bun not found"; exit 1; }
echo "Dependencies OK"
echo ""

echo "Starting anvil..."
anvil --chain-id 31337 --port 8545 --code-size-limit 50000 --quiet &
sleep 3
echo "Anvil running on http://127.0.0.1:8545"
echo ""

echo "Deploying MiniMarket contract..."
cd "$CONTRACTS_DIR"
forge build --quiet 2>/dev/null || true

BYTECODE=$(cat out/MiniMarket.sol/MiniMarket.json | jq -r '.bytecode.object')
OUTPUT=$(cast send --rpc-url http://127.0.0.1:8545 \
    --private-key "$DEFAULT_PRIVATE_KEY" \
    --create "${BYTECODE}" \
    "constructor(address,address)" \
    0x0000000000000000000000000000000000000001 \
    0x0000000000000000000000000000000000000002 2>&1)

CONTRACT_ADDRESS=$(echo "$OUTPUT" | grep "^contractAddress" | awk '{print $2}')
echo "MiniMarket deployed at: $CONTRACT_ADDRESS"
echo ""

QUESTION="${QUESTION:-Lindsey Vonn to say surgery saved her from having leg amputated}"
echo "Creating market: $QUESTION"

OUTPUT=$(cast send --rpc-url http://127.0.0.1:8545 \
    --private-key "$DEFAULT_PRIVATE_KEY" \
    "$CONTRACT_ADDRESS" \
    "createMarket(string,string,address,uint256,uint256,uint64,bytes32,uint48)" \
    "$QUESTION" \
    "gemini://" \
    0x0000000000000000000000000000000000000000 \
    10 \
    100000000000000000 \
    1000 \
    0xdbd506d6ef76e5f386f41c651dcb808c5bcbd75471cc4eafa3ccac746459b582 \
    300 \
    --value 1000000000000000000 2>&1)

TX_HASH=$(echo "$OUTPUT" | grep "^transactionHash" | awk '{print $2}')
echo "Market created! Tx: $TX_HASH"
echo ""

echo "Updating CRE workflow config..."
cat > "$CRE_DIR/minimarket/config.json" << EOF
{
  "geminiModel": "gemini-2.5-flash",
  "drandNetwork": {
    "chainHash": "0xdbd506d6ef76e5f386f41c651dcb808c5bcbd75471cc4eafa3ccac746459b582",
    "genesis": 1692803367,
    "period": 3,
    "httpClient": "https://api.drand.sh"
  },
  "evms": [
    {
      "marketAddress": "$CONTRACT_ADDRESS",
      "chainSelectorName": "ethereum-testnet-sepolia",
      "gasLimit": "1000000"
    }
  ]
}
EOF
echo ""

echo "Building CRE workflow..."
cd "$CRE_DIR"
bun run build
echo ""

echo "=========================================="
echo "   Running CRE Workflow Simulation"
echo "=========================================="
echo ""
echo "Tx hash: $TX_HASH"
echo ""

cre workflow simulate minimarket --target local-simulation \
    --evm-tx-hash "$TX_HASH" \
    --evm-event-index 0 \
    --non-interactive 2>&1 || true

echo ""
echo "=========================================="
echo "         Test Complete!"
echo "=========================================="
echo ""
echo "Contract: $CONTRACT_ADDRESS"
echo "Market Tx: $TX_HASH"
