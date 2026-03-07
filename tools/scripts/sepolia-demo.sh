#!/bin/bash
# Base Sepolia demo: deploy contracts, create a market with fake-agent voters,
# update indexer/frontend .env.local, then show countdown until the drand reveal.
#
# Steps:
#   1. Deploy Cortex + OrderbookMarket  (skip if already in deployed-addresses.json)
#   2. Deploy FakeAgentFactory              (skip if already in deployed-addresses.json)
#   3. Run TypeScript orchestrator (scripts/sepolia-test/main.ts):
#       a. Prompt for market parameters
#       b. Create market on-chain
#       c. Deploy fake agents 0..(maxSlots-1) via factory (CREATE2; only as many as slots)
#       d. Fund each agent with USDC via factory.batchFundAgents
#       e. Encrypt votes + submitEncrypted as each agent (via factory.execute)
#       f. Write indexer/.env.local and frontend/.env.local for Base Sepolia
#       g. Ask you to start Ponder, wait for Enter
#       h. Show countdown until drand round is available
#       i. Ask "Did you run the CRE workflow?" — on Enter: fetch leaves from contract, claim, trade until phase 2 end
#
# Prerequisites:
#   - forge, cast, jq, bun
#   - keystore at ~/.foundry/keystores/chack  (or set KEYSTORE=...)
#   - Deployer has Base Sepolia ETH + USDC (0x036CbD53842c5426634e7929541eC2318f3dCF7e)
#     required: ~0.02 USDC per run (market cap + agent funding, very small)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"

# Load .env from root for ETHERSCAN_API_KEY
if [ -f "$ROOT_DIR/.env" ]; then
  set -o allexport
  source "$ROOT_DIR/.env"
  set +o allexport
fi

KEYSTORE="${KEYSTORE:-$HOME/.foundry/keystores/chack}"
RPC_URL="${RPC_URL:-https://sepolia.base.org}"
CHAIN_ID=84532
USDC_BASE_SEPOLIA="0x036CbD53842c5426634e7929541eC2318f3dCF7e"
ADDRESSES_FILE="$ROOT_DIR/deployed-addresses.json"

# ── Prerequisite checks ───────────────────────────────────────────────────────
command -v forge >/dev/null 2>&1 || { echo "ERROR: forge not found"; exit 1; }
command -v cast  >/dev/null 2>&1 || { echo "ERROR: cast not found";  exit 1; }
command -v jq    >/dev/null 2>&1 || { echo "ERROR: jq not found";    exit 1; }
command -v bun   >/dev/null 2>&1 || { echo "ERROR: bun not found";   exit 1; }
[ -f "$KEYSTORE" ] || { echo "ERROR: Keystore not found at $KEYSTORE"; exit 1; }

echo ""
echo "╔══════════════════════════════════════════════════╗"
echo "║   Cortex — Base Sepolia Demo                     ║"
echo "╚══════════════════════════════════════════════════╝"
echo "  RPC     : $RPC_URL"
echo "  Keystore: $KEYSTORE"
echo "  Addrs   : $ADDRESSES_FILE"
echo ""

# ── Keystore password ─────────────────────────────────────────────────────────
if [ -z "${KEYSTORE_PASSWORD:-}" ]; then
  read -rsp "Keystore password for chack: " KEYSTORE_PASSWORD
  echo ""
fi
export KEYSTORE_PASSWORD
export CAST_UNSAFE_PASSWORD="$KEYSTORE_PASSWORD"

DEPLOYER=$(cast wallet address --keystore "$KEYSTORE" --password "$KEYSTORE_PASSWORD" 2>/dev/null || true)
[ -n "$DEPLOYER" ] || { echo "ERROR: Could not resolve deployer address from keystore"; exit 1; }
echo "  Deployer: $DEPLOYER"
echo ""

# ── Helper: extract address from forge output ─────────────────────────────────
extract_addr() {
  local log="$1" pattern="$2"
  echo "$log" | grep -oE "${pattern}: 0x[a-fA-F0-9]{40}" | sed "s/${pattern}: //" | head -1
}

broadcast_addr() {
  local file="$1" name="$2"
  [ -f "$file" ] && jq -r --arg n "$name" \
    '.transactions[] | select(.contractName == $n) | .contractAddress // empty' "$file" 2>/dev/null | head -1 || true
}

# ── Check for existing deployment ─────────────────────────────────────────────
MARKET_ADDRESS=""
ORDERBOOK_ADDRESS=""
FACTORY_ADDRESS=""
DEPLOY_BLOCK="0"

if [ -f "$ADDRESSES_FILE" ] && [ -z "${FORCE_DEPLOY:-}" ]; then
  MARKET_ADDRESS=$(jq -r '.baseSepolia.Cortex // empty' "$ADDRESSES_FILE" 2>/dev/null || true)
  ORDERBOOK_ADDRESS=$(jq -r '.baseSepolia.OrderbookMarket // empty' "$ADDRESSES_FILE" 2>/dev/null || true)
  FACTORY_ADDRESS=$(jq -r '.baseSepolia.FakeAgentFactory // empty' "$ADDRESSES_FILE" 2>/dev/null || true)
  DEPLOY_BLOCK=$(jq -r '.baseSepolia.startBlock // "0"' "$ADDRESSES_FILE" 2>/dev/null || echo "0")
fi

if [ -n "$MARKET_ADDRESS" ] && [ -n "$FACTORY_ADDRESS" ]; then
  echo "⚡ Using existing deployment (set FORCE_DEPLOY=1 to redeploy):"
  echo "   Cortex:           $MARKET_ADDRESS"
  echo "   OrderbookMarket:  $ORDERBOOK_ADDRESS"
  echo "   FakeAgentFactory: $FACTORY_ADDRESS"
  echo "   Start block:      $DEPLOY_BLOCK"
  echo ""
else
  # ── STEP 1 · Deploy Cortex + OrderbookMarket ─────────────────────────────
  echo "═══ STEP 1: Deploy Cortex + OrderbookMarket ═══"
  cd "$ROOT_DIR/contracts"

  CRE_FORWARDER="0x82300bd7c3958625581cc2F77bC6464dcEcDF3e5" \
  OWNER="$DEPLOYER" \
  USDC="$USDC_BASE_SEPOLIA" \
  forge script script/Deploy.s.sol:DeployCortexSepolia \
    --rpc-url "$RPC_URL" \
    --keystore "$KEYSTORE" \
    --password "$KEYSTORE_PASSWORD" \
    --chain-id "$CHAIN_ID" \
    --broadcast \
    --verify \
    --verifier-url "https://api.etherscan.io/v2/api?chainid=84532" \
    -vvv 2>&1 | tee /tmp/mm-deploy-market.txt

  DEPLOY_LOG=$(cat /tmp/mm-deploy-market.txt)
  BROADCAST_M=$(find "$ROOT_DIR/contracts/broadcast/Deploy.s.sol/$CHAIN_ID" -name "run-latest.json" 2>/dev/null | head -1 || true)

  MARKET_ADDRESS=$(extract_addr "$DEPLOY_LOG" "Cortex deployed at")
  [ -z "$MARKET_ADDRESS" ] && MARKET_ADDRESS=$(broadcast_addr "$BROADCAST_M" "Cortex")
  [ -n "$MARKET_ADDRESS" ] || { echo "ERROR: Could not extract Cortex address"; exit 1; }

  ORDERBOOK_ADDRESS=$(extract_addr "$DEPLOY_LOG" "OrderbookMarket deployed at")
  [ -z "$ORDERBOOK_ADDRESS" ] && ORDERBOOK_ADDRESS=$(broadcast_addr "$BROADCAST_M" "OrderbookMarket")
  if [ -z "$ORDERBOOK_ADDRESS" ]; then
    ORDERBOOK_ADDRESS=$(cast call --rpc-url "$RPC_URL" "$MARKET_ADDRESS" "orderbook()(address)" 2>/dev/null || true)
  fi

  DEPLOY_BLOCK=$(cast block-number --rpc-url "$RPC_URL" 2>/dev/null || echo "0")
  echo ""
  echo "   Cortex:          $MARKET_ADDRESS"
  echo "   OrderbookMarket: $ORDERBOOK_ADDRESS"
  echo "   Block:           $DEPLOY_BLOCK"
  echo ""

  # Give public RPC time to update nonce before next deploy (avoids "nonce too low")
  echo "   Waiting 8s for RPC to sync..."
  sleep 8
  echo ""

  # ── STEP 2 · Deploy FakeAgentFactory ─────────────────────────────────────────
  echo "═══ STEP 2: Deploy FakeAgentFactory ═══"

  forge script script/DeployFakeAgentFactory.s.sol:DeployFakeAgentFactory \
    --rpc-url "$RPC_URL" \
    --keystore "$KEYSTORE" \
    --password "$KEYSTORE_PASSWORD" \
    --chain-id "$CHAIN_ID" \
    --broadcast \
    --verify \
    --verifier-url "https://api.etherscan.io/v2/api?chainid=84532" \
    -vvv 2>&1 | tee /tmp/mm-deploy-factory.txt

  FACTORY_LOG=$(cat /tmp/mm-deploy-factory.txt)
  BROADCAST_F=$(find "$ROOT_DIR/contracts/broadcast/DeployFakeAgentFactory.s.sol/$CHAIN_ID" -name "run-latest.json" 2>/dev/null | head -1 || true)

  FACTORY_ADDRESS=$(extract_addr "$FACTORY_LOG" "FakeAgentFactory deployed at")
  [ -z "$FACTORY_ADDRESS" ] && FACTORY_ADDRESS=$(broadcast_addr "$BROADCAST_F" "FakeAgentFactory")
  [ -n "$FACTORY_ADDRESS" ] || { echo "ERROR: Could not extract FakeAgentFactory address"; exit 1; }

  echo ""
  echo "   FakeAgentFactory: $FACTORY_ADDRESS"
  echo ""

  # ── Save addresses ────────────────────────────────────────────────────────────
  cd "$ROOT_DIR"
  jq -n \
    --arg market    "$MARKET_ADDRESS" \
    --arg orderbook "$ORDERBOOK_ADDRESS" \
    --arg factory   "$FACTORY_ADDRESS" \
    --arg usdc      "$USDC_BASE_SEPOLIA" \
    --arg deployer  "$DEPLOYER" \
    --argjson block "$DEPLOY_BLOCK" \
    '{
      baseSepolia: {
        Cortex:           $market,
        OrderbookMarket:  $orderbook,
        FakeAgentFactory: $factory,
        USDC:             $usdc,
        deployer:         $deployer,
        startBlock:       $block,
        chainId:          84532
      }
    }' > "$ADDRESSES_FILE"
  echo "✅ Saved $ADDRESSES_FILE"
  echo ""
fi

# ── STEP 3 · TypeScript orchestrator ─────────────────────────────────────────
echo "═══ STEP 3: Market Setup + Voting ═══"
echo ""

cd "$ROOT_DIR"
MARKET_ADDRESS="$MARKET_ADDRESS" \
ORDERBOOK_ADDRESS="$ORDERBOOK_ADDRESS" \
FACTORY_ADDRESS="$FACTORY_ADDRESS" \
RPC_URL="$RPC_URL" \
KEYSTORE="$KEYSTORE" \
KEYSTORE_PASSWORD="$KEYSTORE_PASSWORD" \
CHAIN_ID="$CHAIN_ID" \
USDC_ADDRESS="$USDC_BASE_SEPOLIA" \
DEPLOY_BLOCK="$DEPLOY_BLOCK" \
  bun run "$ROOT_DIR/tools/scripts/sepolia-test/main.ts"
