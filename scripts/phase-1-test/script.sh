#!/bin/bash
# Phase 1 end-to-end test: anvil fork, deploy, create market, cast votes, reveal, claim.
#
# Usage:
#   ./scripts/phase-1-test/script.sh
#
# Prerequisites:
#   - keystore at ~/.foundry/keystores/chack (or KEYSTORE env)
#   - forge, cast, jq, bun
#   - KEYSTORE_PASSWORD when prompted

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(dirname "$(dirname "$SCRIPT_DIR")")"

KEYSTORE="${KEYSTORE:-$HOME/.foundry/keystores/chack}"
RPC_URL="http://127.0.0.1:8545"
FORK_URL="${FORK_URL:-https://sepolia.base.org}"
USDC_BASE_SEPOLIA="0x036CbD53842c5426634e7929541eC2318f3dCF7e"

# Drand constants (matches MiniMarket.sol)
DRAND_GENESIS=1692803367
DRAND_PERIOD=3

# Votes: 700/300, 200/800, 500/500, 900/100, 100/900 (first 5 only)
VOTES=(700 200 500 900 100)

# Anvil default private keys (first 5; derived from mnemonic test test test ... junk)
ANVIL_KEYS=(
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80"
  "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d"
  "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a"
  "0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6"
  "0x8b3a350cf5c34c9194ca85829a2df0ec3153be0318b5e2d3348e872092edffba"
)

command -v forge >/dev/null 2>&1 || { echo "ERROR: forge not found"; exit 1; }
command -v cast >/dev/null 2>&1 || { echo "ERROR: cast not found"; exit 1; }
command -v jq >/dev/null 2>&1 || { echo "ERROR: jq not found"; exit 1; }
command -v bun >/dev/null 2>&1 || { echo "ERROR: bun not found"; exit 1; }
if [ ! -f "$KEYSTORE" ]; then
  echo "ERROR: Keystore not found at $KEYSTORE"
  exit 1
fi

if [ -z "${KEYSTORE_PASSWORD:-}" ]; then
  read -rsp "Keystore password for $(basename "$KEYSTORE"): " KEYSTORE_PASSWORD
  echo ""
fi
export KEYSTORE KEYSTORE_PASSWORD
# Forge uses this for non-interactive keystore decryption
export CAST_UNSAFE_PASSWORD="$KEYSTORE_PASSWORD"

echo ""
echo "================================================"
echo "   Phase 1 End-to-End Test"
echo "================================================"
echo "  Fork    : $FORK_URL"
echo "  Keystore: $KEYSTORE"
echo "================================================"
echo ""

# 1. Start anvil with fork (muted)
echo "1. Starting anvil (fork $FORK_URL, chain-id 31337)..."
pkill -f "anvil.*8545" 2>/dev/null || true
sleep 1
anvil --fork-url "$FORK_URL" --chain-id 31337 --port 8545 >/dev/null 2>&1 &
ANVIL_PID=$!
cleanup() {
  kill -9 ${ANVIL_PID:-} 2>/dev/null || true
  pkill -9 -f "anvil.*8545" 2>/dev/null || true
  exit 0
}
trap cleanup EXIT INT TERM

# Wait for anvil
for i in {1..30}; do
  if cast block-number --rpc-url "$RPC_URL" 2>/dev/null; then break; fi
  sleep 0.5
done
cast block-number --rpc-url "$RPC_URL" >/dev/null 2>&1 || { echo "Anvil failed to start"; exit 1; }
echo "   Anvil ready"

# 2. Get chack address and deploy
# Try both: (1) --keystore with file path, (2) name + --keystore with dir
KEYSTORE_DIR="$(dirname "$KEYSTORE")"
KEYSTORE_NAME="$(basename "$KEYSTORE")"
CRE_FORWARDER=$(cast wallet address --keystore "$KEYSTORE" 2>/dev/null || true)
if [ -z "$CRE_FORWARDER" ]; then
  CRE_FORWARDER=$(cast wallet address "$KEYSTORE_NAME" --keystore "$KEYSTORE_DIR" 2>/dev/null || true)
fi
if [ -z "$CRE_FORWARDER" ]; then
  echo "ERROR: Could not get chack address. Try: cast wallet address --keystore $KEYSTORE"
  exit 1
fi
echo ""
echo "2. Deploying MiniMarket + Orderbook (CRE=$CRE_FORWARDER)..."
cd "$ROOT_DIR/contracts"

# Deploy with keystore
CRE_FORWARDER="$CRE_FORWARDER" OWNER="$CRE_FORWARDER" USDC="$USDC_BASE_SEPOLIA" \
forge script script/Deploy.s.sol:DeployMiniMarketSepolia \
  --rpc-url "$RPC_URL" \
  --keystore "$KEYSTORE" \
  --chain-id 31337 \
  --broadcast \
  -vvv 2>&1 | tee /tmp/deploy-out.txt

DEPLOY_OUT=$(cat /tmp/deploy-out.txt)

BROADCAST=$(find "$ROOT_DIR/contracts/broadcast" -name "run-latest.json" 2>/dev/null | head -1)
MARKET_ADDRESS=$(echo "$DEPLOY_OUT" | grep -oE "MiniMarket deployed at: 0x[a-fA-F0-9]{40}" | sed 's/MiniMarket deployed at: //' | head -1)
if [ -z "$MARKET_ADDRESS" ] && [ -n "$BROADCAST" ]; then
  MARKET_ADDRESS=$(jq -r '.transactions[] | select(.contractName == "MiniMarket") | .contractAddress // empty' "$BROADCAST" 2>/dev/null | head -1)
fi

if [ -z "$MARKET_ADDRESS" ]; then
  echo "ERROR: Could not extract MiniMarket address. Output:"
  echo "$DEPLOY_OUT"
  exit 1
fi
echo "   MiniMarket: $MARKET_ADDRESS"

ORDERBOOK_ADDRESS=$(echo "$DEPLOY_OUT" | grep -oE "OrderbookMarket deployed at: 0x[a-fA-F0-9]{40}" | sed 's/OrderbookMarket deployed at: //' | head -1)
if [ -z "$ORDERBOOK_ADDRESS" ] && [ -n "$BROADCAST" ]; then
  ORDERBOOK_ADDRESS=$(jq -r '.transactions[] | select(.contractName == "OrderbookMarket") | .contractAddress // empty' "$BROADCAST" 2>/dev/null | head -1)
fi
if [ -z "$ORDERBOOK_ADDRESS" ]; then
  ORDERBOOK_ADDRESS=$(cast call --rpc-url "$RPC_URL" "$MARKET_ADDRESS" "orderbook()(address)" 2>/dev/null || true)
fi
echo "   OrderbookMarket: $ORDERBOOK_ADDRESS"

# Block right after deploy (saved for Ponder - will be written to .env.local later)
DEPLOY_BLOCK=$(cast block-number --rpc-url "$RPC_URL" 2>/dev/null || echo "1")
echo "   Deploy block: $DEPLOY_BLOCK"

# 3. Fund USDC via anvil_setStorageAt (no whale needed)
echo ""
echo "3. Funding each address with USDC (anvil_setStorageAt)..."
USDC_AMOUNT=1000000000  # 1000 USDC (6 decimals)

set_erc20_balance() {
  local token=$1
  local target=$2
  local amount=$3
  local slot=${4:-0}
  local padded_addr
  padded_addr=$(printf '%064s' "${target#0x}" | tr ' ' '0')
  local padded_slot
  padded_slot=$(printf '%064x' "$slot")
  local key="0x${padded_addr}${padded_slot}"
  local storage_slot
  storage_slot=$(cast keccak256 "$key")
  local hex_amount
  hex_amount=$(printf '0x%064x' "$amount")
  cast rpc anvil_setStorageAt "$token" "$storage_slot" "$hex_amount" --rpc-url "$RPC_URL" >/dev/null 2>&1
}

# Fund each of the 5 anvil participant addresses (derive address from key so funding matches voting)
for i in "${!ANVIL_KEYS[@]}"; do
  addr=$(cast wallet address --private-key "${ANVIL_KEYS[$i]}" 2>/dev/null)
  set_erc20_balance "$USDC_BASE_SEPOLIA" "$addr" "$USDC_AMOUNT" 0
  set_erc20_balance "$USDC_BASE_SEPOLIA" "$addr" "$USDC_AMOUNT" 1
  echo "   Funded ($((i+1))/5): $addr"
done
# Fund creator (chack) for market creation
set_erc20_balance "$USDC_BASE_SEPOLIA" "$CRE_FORWARDER" "$USDC_AMOUNT" 0
set_erc20_balance "$USDC_BASE_SEPOLIA" "$CRE_FORWARDER" "$USDC_AMOUNT" 1
echo "   Funded creator: $CRE_FORWARDER"

# 4. Create market (5 participants, 1 USDC, drand round ~2 min in future — votes must be cast BEFORE round passes)
echo ""
echo "4. Creating market..."
CURRENT_TS=$(date +%s)
DRAND_TARGET_ROUND=$(($(($CURRENT_TS - DRAND_GENESIS)) / DRAND_PERIOD + 20))  # ~1 min ahead (phase stays INFO_COLLECTION until round passes)

cd "$ROOT_DIR/contracts"
QUESTION="Phase 1 test: Will X happen?"
SCHEMA_JSON='{"version":"1.0","type":"mock","description":"Test"}'

MARKET_ADDRESS="$MARKET_ADDRESS" \
QUESTION="$QUESTION" \
SCHEMA_JSON="$SCHEMA_JSON" \
MAX_SLOTS=5 \
TICKET_COST=1000000 \
CREATOR_OFFER=0 \
TRADING_DURATION=300 \
DRAND_TARGET_ROUND="$DRAND_TARGET_ROUND" \
forge script script/CreateMarket.s.sol:CreateMarket \
  --rpc-url "$RPC_URL" \
  --keystore "$KEYSTORE" \
  --chain-id 31337 \
  --broadcast \
  -vvv 2>&1 | tail -20

MARKET_ID=1
echo "   Market ID: $MARKET_ID"

# 5. Cast votes for each address
echo ""
echo "5. Casting votes..."
cd "$ROOT_DIR"
for i in "${!VOTES[@]}"; do
  echo "   Vote $((i+1))/5: ${VOTES[$i]}/$((1000 - VOTES[i]))"
  PRIVATE_KEY="${ANVIL_KEYS[$i]}" MARKET_ADDRESS="$MARKET_ADDRESS" RPC_URL="$RPC_URL" CHAIN_ID=31337 \
    TICKET_COST=1000000 DRAND_TARGET_ROUND="$DRAND_TARGET_ROUND" \
    bun run scripts/cast-vote.ts "$MARKET_ID" "${VOTES[$i]}" 2>&1 | grep -E "Vote cast|Error|error" || true
done

# 6. Fast-forward time (~1 min) so drand round passes on-chain
echo ""
echo "6. Fast-forwarding ~1 minute..."
cast rpc evm_increaseTime 60 --rpc-url "$RPC_URL"
cast rpc evm_mine --rpc-url "$RPC_URL"
echo "   Time advanced"

# 7. Prepare Ponder config and wait for manual start
echo ""
echo "7. Ponder indexer (run in a separate terminal)..."
mkdir -p "$ROOT_DIR/scripts/phase-1-test"
echo "{\"localhost\":{\"MiniMarket\":\"$MARKET_ADDRESS\",\"OrderbookMarket\":\"$ORDERBOOK_ADDRESS\"}}" > "$ROOT_DIR/scripts/phase-1-test/deployed.json"

# Write indexer/.env.local with deployed contract address and start block for Ponder
# Use deploy block (or -1) so we index MarketCreated (create market is in block after deploy)
START_BLOCK=$((DEPLOY_BLOCK > 1 ? DEPLOY_BLOCK - 1 : 1))
INDEXER_ENV="$ROOT_DIR/indexer/.env.local"
cat > "$INDEXER_ENV" << EOF
NETWORK=local
RPC_URL=http://127.0.0.1:8545
CONTRACT_ADDRESS=$MARKET_ADDRESS
START_BLOCK=$START_BLOCK
EOF
echo "   Wrote $INDEXER_ENV (CONTRACT_ADDRESS=$MARKET_ADDRESS, START_BLOCK=$START_BLOCK)"
echo ""
echo "   In a separate terminal, run:"
echo "     cd $ROOT_DIR/indexer && npx ponder dev"
echo ""
echo "   Once Ponder has indexed (API at http://localhost:42069), press Enter to continue..."
read -r

# 8. Wait for drand beacon (round must pass in real time for decryption)
echo ""
echo "8. Waiting for drand round $DRAND_TARGET_ROUND (beacon needed for decryption)..."
ROUND_AVAILABLE_TS=$((DRAND_GENESIS + DRAND_TARGET_ROUND * DRAND_PERIOD))
format_countdown() {
  local s=$1
  [ "$s" -lt 0 ] && s=0
  local h=$((s / 3600))
  local m=$(((s % 3600) / 60))
  local sec=$((s % 60))
  if [ "$h" -gt 0 ]; then
    printf "%d:%02d:%02d" "$h" "$m" "$sec"
  else
    printf "%d:%02d" "$m" "$sec"
  fi
}
ROUND_AVAILABLE_STR=$(date -d "@$ROUND_AVAILABLE_TS" 2>/dev/null || date -r "$ROUND_AVAILABLE_TS" 2>/dev/null || echo "N/A")
echo "   Round $DRAND_TARGET_ROUND available at: $ROUND_AVAILABLE_STR"
echo ""
while true; do
  NOW=$(date +%s)
  WAIT_SEC=$((ROUND_AVAILABLE_TS - NOW))
  if [ "$WAIT_SEC" -le 0 ]; then
    printf "\r   Round %s ready — beacon available for decryption.          \n" "$DRAND_TARGET_ROUND"
    break
  fi
  printf "\r   Countdown: %s   " "$(format_countdown "$WAIT_SEC")"
  sleep 1
done

# 9. Run CRE workflow simulator (polls Ponder every 30s, compute merkle, reveal, claim)
echo ""
echo "9. Running CRE workflow simulator (poll → compute → reveal → claim)..."
cd "$ROOT_DIR"
MARKET_ADDRESS="$MARKET_ADDRESS" RPC_URL="$RPC_URL" KEYSTORE="$KEYSTORE" KEYSTORE_PASSWORD="$KEYSTORE_PASSWORD" \
  BYPASS_DRAND_ROUND=1 \
  bun run scripts/phase-1-test/cre-workflow-simulator.ts

# 10. Trade on orderbook, resolve market, claim payouts (full e2e)
echo ""
echo "10. Running trade + phase 2 simulator (orderbook trades → resolve → claim payouts)..."
cd "$ROOT_DIR"
MARKET_ADDRESS="$MARKET_ADDRESS" ORDERBOOK_ADDRESS="$ORDERBOOK_ADDRESS" RPC_URL="$RPC_URL" \
  KEYSTORE="$KEYSTORE" KEYSTORE_PASSWORD="$KEYSTORE_PASSWORD" \
  bun run scripts/phase-1-test/trade-and-phase2-simulator.ts

echo ""
echo "================================================"
echo "   Full E2E test complete!"
echo "================================================"
echo "  Phase 1 output: scripts/phase-1-test/phase1-output.json"
echo "================================================"
echo ""
echo "  Press Ctrl+C to exit (anvil will stop)."
echo ""
while true; do sleep 999; done
