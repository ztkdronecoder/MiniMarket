#!/bin/bash
# Full end-to-end test — runs as many market cycles as you want on a single anvil fork.
#
# • Steps 1–3 (anvil start, deploy, fund) run ONCE.
# • Steps 4–10 (create market → vote → reveal → Gemini resolve → claim) loop per cycle.
# • After each cycle you are prompted for a new question; Enter reuses the last one.
# • Ctrl+C exits cleanly (anvil is killed automatically).
#
# Prerequisites:
#   - forge, cast, jq, bun
#   - keystore at ~/.foundry/keystores/chack (or KEYSTORE env)
#   - GEMINI_API_KEY in .env (for Gemini 2.5 Flash resolution)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(dirname "$(dirname "$SCRIPT_DIR")")"

KEYSTORE="${KEYSTORE:-$HOME/.foundry/keystores/chack}"
RPC_URL="http://127.0.0.1:8545"
FORK_URL="${FORK_URL:-https://sepolia.base.org}"
USDC_BASE_SEPOLIA="0x036CbD53842c5426634e7929541eC2318f3dCF7e"

DRAND_GENESIS=1692803367
DRAND_PERIOD=3

# Votes (YES basis points out of 1000)
VOTES=(700 200 500 900 100)

ANVIL_KEYS=(
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80"
  "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d"
  "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a"
  "0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6"
  "0x8b3a350cf5c34c9194ca85829a2df0ec3153be0318b5e2d3348e872092edffba"
)

# Global state (set once during setup, reused across cycles)
MARKET_ADDRESS=""
ORDERBOOK_ADDRESS=""
CRE_FORWARDER=""
MARKET_SEQ=0       # increments each cycle; also the market ID
PONDER_STARTED=0   # flip to 1 after first cycle so we don't re-prompt

# ── Prerequisite checks ──────────────────────────────────────────────────────
command -v forge >/dev/null 2>&1 || { echo "ERROR: forge not found"; exit 1; }
command -v cast  >/dev/null 2>&1 || { echo "ERROR: cast not found";  exit 1; }
command -v jq    >/dev/null 2>&1 || { echo "ERROR: jq not found";    exit 1; }
command -v bun   >/dev/null 2>&1 || { echo "ERROR: bun not found";   exit 1; }
[ -f "$KEYSTORE" ] || { echo "ERROR: Keystore not found at $KEYSTORE"; exit 1; }

if [ -z "${KEYSTORE_PASSWORD:-}" ]; then
  printf "Keystore password for %s: " "$(basename "$KEYSTORE")"
  read -rs KEYSTORE_PASSWORD < /dev/tty
  echo ""
fi
export KEYSTORE KEYSTORE_PASSWORD
export CAST_UNSAFE_PASSWORD="$KEYSTORE_PASSWORD"

echo ""
echo "================================================"
echo "   MiniMarket E2E Test"
echo "================================================"
echo "  Fork    : $FORK_URL"
echo "  Keystore: $KEYSTORE"
echo "================================================"

# ── STEP 1 · Start anvil (once) ──────────────────────────────────────────────
echo ""
echo "1. Starting anvil (fork $FORK_URL, chain-id 31337)..."
pkill -f "anvil.*8545" 2>/dev/null || true
sleep 1
anvil --fork-url "$FORK_URL" --chain-id 31337 --port 8545 >/dev/null 2>&1 &
ANVIL_PID=$!

cleanup() {
  echo ""
  echo "Shutting down anvil..."
  kill -9 "${ANVIL_PID:-}" 2>/dev/null || true
  pkill -9 -f "anvil.*8545" 2>/dev/null || true
  exit 0
}
trap cleanup EXIT INT TERM

for i in {1..30}; do
  cast block-number --rpc-url "$RPC_URL" >/dev/null 2>&1 && break
  sleep 0.5
done
cast block-number --rpc-url "$RPC_URL" >/dev/null 2>&1 || { echo "Anvil failed to start"; exit 1; }
echo "   Anvil ready (PID $ANVIL_PID)"

# ── STEP 2 · Deploy (once) ────────────────────────────────────────────────────
echo ""
echo "2. Deploying MiniMarket + Orderbook..."
cd "$ROOT_DIR/contracts"

KEYSTORE_DIR="$(dirname "$KEYSTORE")"
KEYSTORE_NAME="$(basename "$KEYSTORE")"
CRE_FORWARDER=$(cast wallet address --keystore "$KEYSTORE" 2>/dev/null || true)
if [ -z "$CRE_FORWARDER" ]; then
  CRE_FORWARDER=$(cast wallet address "$KEYSTORE_NAME" --keystore "$KEYSTORE_DIR" 2>/dev/null || true)
fi
[ -n "$CRE_FORWARDER" ] || { echo "ERROR: Could not resolve chack address"; exit 1; }
echo "   CRE Forwarder: $CRE_FORWARDER"

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
[ -n "$MARKET_ADDRESS" ] || { echo "ERROR: Could not extract MiniMarket address"; exit 1; }

ORDERBOOK_ADDRESS=$(echo "$DEPLOY_OUT" | grep -oE "OrderbookMarket deployed at: 0x[a-fA-F0-9]{40}" | sed 's/OrderbookMarket deployed at: //' | head -1)
if [ -z "$ORDERBOOK_ADDRESS" ] && [ -n "$BROADCAST" ]; then
  ORDERBOOK_ADDRESS=$(jq -r '.transactions[] | select(.contractName == "OrderbookMarket") | .contractAddress // empty' "$BROADCAST" 2>/dev/null | head -1)
fi
if [ -z "$ORDERBOOK_ADDRESS" ]; then
  ORDERBOOK_ADDRESS=$(cast call --rpc-url "$RPC_URL" "$MARKET_ADDRESS" "orderbook()(address)" 2>/dev/null || true)
fi

DEPLOY_BLOCK=$(cast block-number --rpc-url "$RPC_URL" 2>/dev/null || echo "1")
echo "   MiniMarket     : $MARKET_ADDRESS"
echo "   OrderbookMarket: $ORDERBOOK_ADDRESS"
echo "   Deploy block   : $DEPLOY_BLOCK"

# ── STEP 3 · Fund addresses (once) ───────────────────────────────────────────
echo ""
echo "3. Funding addresses with USDC..."
USDC_AMOUNT=1000000000  # 1000 USDC (6 decimals)

set_erc20_balance() {
  local token=$1 target=$2 amount=$3 slot=${4:-0}
  local padded_addr padded_slot key storage_slot hex_amount
  padded_addr=$(printf '%064s' "${target#0x}" | tr ' ' '0')
  padded_slot=$(printf '%064x' "$slot")
  key="0x${padded_addr}${padded_slot}"
  storage_slot=$(cast keccak256 "$key")
  hex_amount=$(printf '0x%064x' "$amount")
  cast rpc anvil_setStorageAt "$token" "$storage_slot" "$hex_amount" --rpc-url "$RPC_URL" >/dev/null 2>&1
}

for i in "${!ANVIL_KEYS[@]}"; do
  addr=$(cast wallet address --private-key "${ANVIL_KEYS[$i]}" 2>/dev/null)
  set_erc20_balance "$USDC_BASE_SEPOLIA" "$addr" "$USDC_AMOUNT" 0
  set_erc20_balance "$USDC_BASE_SEPOLIA" "$addr" "$USDC_AMOUNT" 1
  echo "   Funded ($((i+1))/5): $addr"
done
set_erc20_balance "$USDC_BASE_SEPOLIA" "$CRE_FORWARDER" "$USDC_AMOUNT" 0
set_erc20_balance "$USDC_BASE_SEPOLIA" "$CRE_FORWARDER" "$USDC_AMOUNT" 1
echo "   Funded creator : $CRE_FORWARDER"

# Write Ponder config (contract address never changes)
mkdir -p "$ROOT_DIR/scripts/phase-1-test"
echo "{\"localhost\":{\"MiniMarket\":\"$MARKET_ADDRESS\",\"OrderbookMarket\":\"$ORDERBOOK_ADDRESS\"}}" \
  > "$ROOT_DIR/scripts/phase-1-test/deployed.json"

START_BLOCK=$((DEPLOY_BLOCK > 1 ? DEPLOY_BLOCK - 1 : 1))
INDEXER_ENV="$ROOT_DIR/indexer/.env.local"
cat > "$INDEXER_ENV" << EOF
NETWORK=local
RPC_URL=http://127.0.0.1:8545
CONTRACT_ADDRESS=$MARKET_ADDRESS
START_BLOCK=$START_BLOCK
EOF
echo "   Wrote $INDEXER_ENV"

FRONTEND_ENV="$ROOT_DIR/frontend/.env.local"
cat > "$FRONTEND_ENV" << EOF
NEXT_PUBLIC_CHAIN_ID=31337
NEXT_PUBLIC_MARKET_ADDRESS=$MARKET_ADDRESS
NEXT_PUBLIC_USDC_ADDRESS=$USDC_BASE_SEPOLIA
NEXT_PUBLIC_PONDER_ENDPOINT=http://localhost:42069
EOF
echo "   Wrote $FRONTEND_ENV"

# ═══════════════════════════════════════════════════════════════════════════════
# MARKET CYCLE — runs for each new question
# ═══════════════════════════════════════════════════════════════════════════════
run_market_cycle() {
  local QUESTION="$1"
  MARKET_SEQ=$((MARKET_SEQ + 1))
  local MARKET_ID=$MARKET_SEQ

  echo ""
  echo "════════════════════════════════════════════════"
  echo "   Market Cycle #${MARKET_ID}"
  printf "   Question : %s\n" "$QUESTION"
  echo "════════════════════════════════════════════════"

  # ── 4 · Create market ─────────────────────────────────────────────────────
  echo ""
  echo "4. Creating market #${MARKET_ID}..."
  local CURRENT_TS DRAND_TARGET_ROUND
  CURRENT_TS=$(date +%s)
  DRAND_TARGET_ROUND=$(( (CURRENT_TS - DRAND_GENESIS) / DRAND_PERIOD + 20 ))

  # Build a proper schema JSON with the question + resolution config
  local TRADING_DURATION=300
  local DEADLINE SCHEMA_JSON
  DEADLINE=$(( $(date +%s) + TRADING_DURATION + 60 ))
  SCHEMA_JSON=$(jq -n \
    --arg desc "$QUESTION" \
    --arg prompt "$QUESTION" \
    --argjson dl "$DEADLINE" \
    '{version:"1.0",description:$desc,deadline:$dl,resolution:{method:"ai",provider:"gemini",model:"gemini-2.5-flash",prompt:$prompt,grounding:"google_search"}}')

  cd "$ROOT_DIR/contracts"
  MARKET_ADDRESS="$MARKET_ADDRESS" \
  QUESTION="$QUESTION" \
  SCHEMA_JSON="$SCHEMA_JSON" \
  MAX_SLOTS=5 \
  TICKET_COST=1000000 \
  CREATOR_OFFER=500000 \
  TRADING_DURATION=$TRADING_DURATION \
  DRAND_TARGET_ROUND="$DRAND_TARGET_ROUND" \
  forge script script/CreateMarket.s.sol:CreateMarket \
    --rpc-url "$RPC_URL" \
    --keystore "$KEYSTORE" \
    --chain-id 31337 \
    --broadcast \
    -vvv 2>&1 | tail -20
  echo "   Market ID: $MARKET_ID  (drand round: $DRAND_TARGET_ROUND)"

  # ── 5 · Cast votes ────────────────────────────────────────────────────────
  echo ""
  echo "5. Casting votes for market #${MARKET_ID}..."
  cd "$ROOT_DIR"
  for i in "${!VOTES[@]}"; do
    echo "   Vote $((i+1))/5: ${VOTES[$i]}/$((1000 - VOTES[i]))"
    PRIVATE_KEY="${ANVIL_KEYS[$i]}" \
    MARKET_ADDRESS="$MARKET_ADDRESS" \
    RPC_URL="$RPC_URL" \
    CHAIN_ID=31337 \
    TICKET_COST=1000000 \
    DRAND_TARGET_ROUND="$DRAND_TARGET_ROUND" \
      bun run scripts/cast-vote.ts "$MARKET_ID" "${VOTES[$i]}" 2>&1 \
        | grep -E "Vote cast|Error|error" || true
  done

  # ── 6 · Fast-forward ~1 min so drand round passes on-chain ────────────────
  echo ""
  echo "6. Fast-forwarding ~1 minute (drand round passes on-chain)..."
  cast rpc evm_increaseTime 60 --rpc-url "$RPC_URL" >/dev/null
  cast rpc evm_mine          --rpc-url "$RPC_URL" >/dev/null
  echo "   Time advanced"

  # ── 7 · Ponder (prompt only on first cycle) ────────────────────────────────
  if [ "$PONDER_STARTED" -eq 0 ]; then
    PONDER_STARTED=1
    echo ""
    echo "7. Start the Ponder indexer in a separate terminal:"
    echo ""
    echo "     cd $ROOT_DIR/indexer && npx ponder dev"
    echo ""
    echo "   Once Ponder has indexed (API at http://localhost:42069), press Enter..."
    read -r < /dev/tty
  else
    echo ""
    echo "7. Ponder already running — skipping prompt."
  fi

  # ── 8 · Wait for the real drand beacon (needed for decryption) ─────────────
  echo ""
  echo "8. Waiting for drand round $DRAND_TARGET_ROUND..."
  local ROUND_TS ROUND_STR
  ROUND_TS=$((DRAND_GENESIS + DRAND_TARGET_ROUND * DRAND_PERIOD))
  ROUND_STR=$(date -d "@$ROUND_TS" 2>/dev/null || date -r "$ROUND_TS" 2>/dev/null || echo "N/A")
  echo "   Available at: $ROUND_STR"
  echo ""
  while true; do
    local NOW WAIT
    NOW=$(date +%s)
    WAIT=$((ROUND_TS - NOW))
    if [ "$WAIT" -le 0 ]; then
      printf "\r   Round %s ready — beacon available.          \n" "$DRAND_TARGET_ROUND"
      break
    fi
    printf "\r   Countdown: %d:%02d   " "$((WAIT / 60))" "$((WAIT % 60))"
    sleep 1
  done

  # ── 9 · CRE workflow (decrypt → merkle → reveal → claim shares) ────────────
  echo ""
  echo "9. Running CRE workflow simulator..."
  cd "$ROOT_DIR"
  MARKET_ADDRESS="$MARKET_ADDRESS" \
  RPC_URL="$RPC_URL" \
  KEYSTORE="$KEYSTORE" \
  KEYSTORE_PASSWORD="$KEYSTORE_PASSWORD" \
  BYPASS_DRAND_ROUND=1 \
    bun run scripts/phase-1-test/cre-workflow-simulator.ts

  # ── 10 · Trade + Phase 2 with Gemini resolution ────────────────────────────
  echo ""
  echo "10. Running trade + Phase 2 (Gemini resolves: \"$QUESTION\")..."
  cd "$ROOT_DIR"
  MARKET_ADDRESS="$MARKET_ADDRESS" \
  ORDERBOOK_ADDRESS="$ORDERBOOK_ADDRESS" \
  RPC_URL="$RPC_URL" \
  KEYSTORE="$KEYSTORE" \
  KEYSTORE_PASSWORD="$KEYSTORE_PASSWORD" \
  MARKET_QUESTION="$QUESTION" \
  SCHEMA_JSON="$SCHEMA_JSON" \
    bun run scripts/phase-1-test/trade-and-phase2-simulator.ts

  echo ""
  echo "════════════════════════════════════════════════"
  echo "   Cycle #${MARKET_ID} complete!"
  echo "════════════════════════════════════════════════"
}

# ═══════════════════════════════════════════════════════════════════════════════
# MAIN LOOP
# ═══════════════════════════════════════════════════════════════════════════════
echo ""
printf "Market question: "
read -r CURRENT_QUESTION < /dev/tty
[ -z "$CURRENT_QUESTION" ] && CURRENT_QUESTION="Will ETH be above \$3000 tomorrow?"

run_market_cycle "$CURRENT_QUESTION"

while true; do
  echo ""
  echo "  ┌─────────────────────────────────────────────┐"
  echo "  │  Cycle complete. Ctrl+C to exit.            │"
  echo "  │  Press Enter to create a new market.        │"
  echo "  └─────────────────────────────────────────────┘"
  read -r < /dev/tty || break
  echo ""
  printf "  New question [Enter to reuse \"%s\"]: " "$CURRENT_QUESTION"
  read -r NEW_Q < /dev/tty || break
  [ -n "$NEW_Q" ] && CURRENT_QUESTION="$NEW_Q"
  run_market_cycle "$CURRENT_QUESTION"
done

# Keep anvil alive after the loop exits naturally (EOF / break)
echo ""
echo "  Press Ctrl+C to exit (anvil will stop)."
while true; do sleep 999; done
