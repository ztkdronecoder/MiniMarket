#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"

echo "Deploying Cortex to local anvil..."

RPC_URL="${RPC_URL:-http://127.0.0.1:8545}"
PRIVATE_KEY="${PRIVATE_KEY:-0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80}"

cd "$ROOT_DIR/contracts"

OUTPUT=$(forge script script/PopulateTestMarkets.s.sol:PopulateTestMarkets \
    --rpc-url "$RPC_URL" \
    --private-key "$PRIVATE_KEY" \
    --broadcast \
    2>&1)

CONTRACT=$(echo "$OUTPUT" | grep "CORTEX_ADDRESS=" | sed 's/CORTEX_ADDRESS=//' | head -1)

echo ""
if [ -n "$CONTRACT" ]; then
    echo "CORTEX_ADDRESS=$CONTRACT"
    echo ""
    echo "To start indexing:"
    echo "  NETWORK=local RPC_URL=$RPC_URL CONTRACT_ADDRESS=$CONTRACT START_BLOCK=1 npm run dev --prefix $ROOT_DIR/indexer"
    echo ""
    echo "Or update indexer/.env:"
    echo "  NETWORK=local"
    echo "  RPC_URL=$RPC_URL"
    echo "  CONTRACT_ADDRESS=$CONTRACT"
    echo "  START_BLOCK=1"
else
    echo "Could not extract address. Output:"
    echo "$OUTPUT"
fi
