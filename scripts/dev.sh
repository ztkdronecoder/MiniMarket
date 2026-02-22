#!/bin/bash
set -e

echo "=========================================="
echo "   MiniMarket Local Dev Environment"
echo "=========================================="
echo ""

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"
CONTRACTS_DIR="$ROOT_DIR/contracts"
INDEXER_DIR="$ROOT_DIR/indexer"

DEFAULT_PRIVATE_KEY="0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80"
ANVIL_PID=""
PONDER_PID=""

ORIGINAL_CONFIG=""

cleanup() {
    echo ""
    echo "Stopping services..."
    [ -n "$ANVIL_PID" ] && kill $ANVIL_PID 2>/dev/null || true
    [ -n "$PONDER_PID" ] && kill $PONDER_PID 2>/dev/null || true
    
    if [ -n "$ORIGINAL_CONFIG" ]; then
        echo "Restoring original ponder.config.ts..."
        echo "$ORIGINAL_CONFIG" > "$INDEXER_DIR/ponder.config.ts"
    fi
    
    echo "Done."
}

trap cleanup EXIT INT TERM

check_dependencies() {
    echo "Checking dependencies..."
    
    command -v anvil >/dev/null 2>&1 || { echo "ERROR: anvil not found. Install foundry."; exit 1; }
    command -v forge >/dev/null 2>&1 || { echo "ERROR: forge not found. Install foundry."; exit 1; }
    command -v jq >/dev/null 2>&1 || { echo "ERROR: jq not found. Install jq."; exit 1; }
    
    if [ ! -d "$INDEXER_DIR/node_modules" ]; then
        echo "Installing indexer dependencies..."
        cd "$INDEXER_DIR"
        npm install
    fi
    
    echo "Dependencies OK"
    echo ""
}

kill_existing() {
    echo "Stopping existing services..."
    pkill -f "anvil.*8545" 2>/dev/null || true
    pkill -f "ponder dev" 2>/dev/null || true
    pkill -f "npm run dev" 2>/dev/null || true
    sleep 2
    echo ""
}

start_anvil() {
    echo "Starting anvil..."
    
    anvil --chain-id 31337 --port 8545 --quiet &
    ANVIL_PID=$!
    
    sleep 5
    
    if ! kill -0 $ANVIL_PID 2>/dev/null; then
        echo "ERROR: Failed to start anvil"
        exit 1
    fi
    
    echo "Anvil running on http://127.0.0.1:8545 (PID: $ANVIL_PID)"
    echo ""
}

deploy_contracts() {
    echo "Deploying contracts and populating test data..." >&2
    echo "" >&2
    
    cd "$CONTRACTS_DIR"
    
    forge script script/PopulateTestMarkets.s.sol:PopulateTestMarkets \
        --rpc-url http://127.0.0.1:8545 \
        --private-key $DEFAULT_PRIVATE_KEY \
        --broadcast \
        --silent 2>&1
    
    BROADCAST_FILE="$CONTRACTS_DIR/broadcast/PopulateTestMarkets.s.sol/31337/run-latest.json"
    
    if [ ! -f "$BROADCAST_FILE" ]; then
        echo "ERROR: Broadcast file not found: $BROADCAST_FILE" >&2
        exit 1
    fi
    
    CONTRACT_ADDRESS=$(jq -r '.transactions[] | select(.contractName == "MiniMarket") | select(.transactionType == "CREATE") | .contractAddress' "$BROADCAST_FILE")
    
    if [ -z "$CONTRACT_ADDRESS" ] || [ "$CONTRACT_ADDRESS" = "null" ]; then
        echo "ERROR: Could not extract MiniMarket contract address from broadcast file" >&2
        exit 1
    fi
    
    echo "MiniMarket deployed at: $CONTRACT_ADDRESS" >&2
    echo "" >&2
    
    echo "$CONTRACT_ADDRESS"
}

update_ponder_config() {
    local contract_address=$1
    local start_block=$2
    
    echo "Backing up ponder.config.ts..."
    ORIGINAL_CONFIG=$(cat "$INDEXER_DIR/ponder.config.ts")
    
    echo "Updating ponder.config.ts with contract address: $contract_address"
    sed -i "s|address: \".*\"|address: \"$contract_address\"|" "$INDEXER_DIR/ponder.config.ts"
    echo ""
}

clean_ponder() {
    echo "Cleaning ponder cache..."
    cd "$INDEXER_DIR"
    rm -rf .ponder
    echo "Ponder cache cleaned"
    echo ""
}

start_ponder() {
    echo "Starting Ponder indexer..."
    echo ""
    
    cd "$INDEXER_DIR"
    
    npm run dev &
    PONDER_PID=$!
    
    echo "Ponder starting... (PID: $PONDER_PID)"
    echo ""
}

wait_for_indexing() {
    echo "Waiting for indexing to complete..."
    
    MAX_WAIT=180
    INTERVAL=3
    ELAPSED=0
    
    while [ $ELAPSED -lt $MAX_WAIT ]; do
        RESULT=$(curl -s http://localhost:42069/graphql \
            -H "Content-Type: application/json" \
            -d '{"query":"{ markets { id question } }"}' 2>/dev/null || echo "")
        
        if echo "$RESULT" | jq -e '.data.markets' > /dev/null 2>&1; then
            MARKET_COUNT=$(echo "$RESULT" | jq '.data.markets | length')
            echo "Indexing complete! Found $MARKET_COUNT markets."
            echo ""
            return 0
        fi
        
        sleep $INTERVAL
        ELAPSED=$((ELAPSED + INTERVAL))
        echo "  Waiting... ($ELAPSED/${MAX_WAIT}s)"
    done
    
    echo "WARNING: Indexing did not complete within ${MAX_WAIT}s"
    echo "You can check status at http://localhost:42069"
    echo ""
    return 1
}

print_summary() {
    echo "=========================================="
    echo "         Setup Complete!"
    echo "=========================================="
    echo ""
    echo "Services:"
    echo "  Anvil:       http://127.0.0.1:8545"
    echo "  Ponder:      http://localhost:42069"
    echo "  GraphQL:     http://localhost:42069/graphql"
    echo ""
    echo "Test Data:"
    echo "  - 4 Markets (3 trading, 1 resolved)"
    echo "  - 8 AI Agents with submissions"
    echo "  - Various outcomes and swaps"
    echo ""
    echo "Next Steps:"
    echo "  1. cd frontend && npm run dev"
    echo "  2. Open http://localhost:3000"
    echo ""
    echo "Press Ctrl+C to stop all services"
    echo ""
}

main() {
    check_dependencies
    kill_existing
    start_anvil
    
    CONTRACT_ADDRESS=$(deploy_contracts)
    update_ponder_config "$CONTRACT_ADDRESS" "1"
    clean_ponder
    start_ponder
    wait_for_indexing
    print_summary
    
    echo "Keeping services running..."
    echo ""
    
    wait $PONDER_PID
}

main "$@"
