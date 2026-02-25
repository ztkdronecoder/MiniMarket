#!/bin/bash
# Interactive wizard to create a new prediction market on a deployed MiniMarket contract.
#
# Usage:
#   ./scripts/create-market.sh
#
# Environment overrides (all optional):
#   KEYSTORE     Path to Foundry keystore file  (default: ~/.foundry/keystores/chack)
#   RPC_URL      RPC endpoint                   (default: https://sepolia.base.org)
#   CHAIN_ID     Chain ID                       (default: 84532)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"

KEYSTORE="${KEYSTORE:-$HOME/.foundry/keystores/chack}"
RPC_URL="${RPC_URL:-https://sepolia.base.org}"
CHAIN_ID="${CHAIN_ID:-84532}"

# drand quicknet constants (matches MiniMarket.sol)
DRAND_GENESIS=1692803367
DRAND_PERIOD=3
DRAND_QUICKNET_HASH="0x52db9ba70e0cc0f6eaf7803dd07447a1f5477735fd3f661792ba94600c84e971"

# ── Helpers ───────────────────────────────────────────────────────────────────

# Current drand round based on current time
current_drand_round() {
    local now
    now=$(date +%s)
    echo $(( (now - DRAND_GENESIS) / DRAND_PERIOD ))
}

# Convert a unix timestamp to a drand round number
timestamp_to_drand_round() {
    local ts=$1
    echo $(( (ts - DRAND_GENESIS) / DRAND_PERIOD ))
}

# Convert a drand round to an approximate unix timestamp
drand_round_to_timestamp() {
    local round=$1
    echo $(( round * DRAND_PERIOD + DRAND_GENESIS ))
}

# Pick a time unit from a numbered menu and store multiplier + label.
# Sets PICKED_MULTI and PICKED_LABEL in the caller's scope.
# Usage: pick_unit default_choice   (1=seconds 2=hours 3=days)
pick_unit() {
    local default="$1"
    local def_label
    case "$default" in 1) def_label="seconds";; 2) def_label="hours";; 3) def_label="days";; esac

    echo "    [1] seconds"
    echo "    [2] hours"
    echo "    [3] days"
    printf "  Choice [%s – %s]: " "$default" "$def_label"
    read -r _uc
    local choice="${_uc:-$default}"

    case "$choice" in
        1|s*) PICKED_MULTI=1;     PICKED_LABEL="seconds" ;;
        2|h*) PICKED_MULTI=3600;  PICKED_LABEL="hours"   ;;
        3|d*) PICKED_MULTI=86400; PICKED_LABEL="days"    ;;
        *)    echo "ERROR: invalid choice '$choice' — pick 1, 2, or 3."; exit 1 ;;
    esac
}

# Format a unix timestamp as a human-readable UTC string
format_ts() {
    date -d "@$1" "+%Y-%m-%d %H:%M:%S UTC" 2>/dev/null || echo "(unknown date)"
}

# Convert ETH string to wei (integer) using awk
eth_to_wei() {
    awk "BEGIN { printf \"%.0f\", $1 * 1e18 }"
}

# Read contract address from deployed-addresses.json
load_deployed_address() {
    local json_file="$ROOT_DIR/deployed-addresses.json"
    if [ -f "$json_file" ] && command -v jq >/dev/null 2>&1; then
        jq -r '.baseSepolia.MiniMarket // empty' "$json_file" 2>/dev/null || true
    fi
}

# ── Pre-flight ────────────────────────────────────────────────────────────────

command -v forge >/dev/null 2>&1 || { echo "ERROR: forge not found in PATH"; exit 1; }

if [ ! -f "$KEYSTORE" ]; then
    echo "ERROR: Keystore not found at: $KEYSTORE"
    echo "  Create one with: cast wallet import chack --interactive"
    exit 1
fi

# ── Banner ────────────────────────────────────────────────────────────────────

echo ""
echo "================================================"
echo "   MiniMarket — Create Market Wizard"
echo "================================================"
echo "   Network  : $([ "$CHAIN_ID" = "84532" ] && echo "Base Sepolia" || echo "Chain $CHAIN_ID")"
echo "   Keystore : $KEYSTORE"
echo "   RPC URL  : $RPC_URL"
echo "================================================"
echo ""

# ── Step 1: Contract address ──────────────────────────────────────────────────

echo "─── Contract ────────────────────────────────────"
echo ""

DEPLOYED=$(load_deployed_address)
if [ -n "$DEPLOYED" ]; then
    echo "  Detected from deployed-addresses.json: $DEPLOYED"
    printf "  Market contract address [%s]: " "$DEPLOYED"
else
    printf "  Market contract address: "
fi

read -r INPUT_ADDRESS
MARKET_ADDRESS="${INPUT_ADDRESS:-$DEPLOYED}"

if [ -z "$MARKET_ADDRESS" ]; then
    echo "ERROR: No contract address provided. Run contracts/script/deploy-base-sepolia.sh first."
    exit 1
fi

echo ""

# ── Step 2: Market question & schema ─────────────────────────────────────────

echo "─── Market Details ──────────────────────────────"
echo ""
echo "  Phase 1: agents submit encrypted yes/no as 1000 basis points (e.g. 700 = 70% yes, 30% no)."
echo ""

printf "  Question (what agents predict):\n  > "
read -r QUESTION

if [ -z "$QUESTION" ]; then
    echo "ERROR: Question cannot be empty."
    exit 1
fi

echo ""
echo "  Schema URI — points to the resolution schema (IPFS or HTTP)."
echo "  This is used by CRE to resolve the market outcome."
printf "  Schema URI: "
read -r SCHEMA_URI

if [ -z "$SCHEMA_URI" ]; then
    echo "ERROR: Schema URI cannot be empty."
    exit 1
fi

echo ""

# ── Step 3: Timing ────────────────────────────────────────────────────────────

echo "─── Timing ──────────────────────────────────────"
echo ""

CURRENT_ROUND=$(current_drand_round)
CURRENT_TS=$(date +%s)
echo "  Current drand round : $CURRENT_ROUND"
echo "  Current time        : $(format_ts "$CURRENT_TS")"
echo ""

# ── Reveal deadline ───────────────────────────────────────────────────────────
echo "  INFO REVEAL — when do encrypted predictions unlock?"
echo "  (Agents encrypt to this drand round; CRE decrypts after it passes)"
echo ""
pick_unit 2   # default: hours
printf "  Amount in %s [1]: " "$PICKED_LABEL"
read -r _ra
REVEAL_AMOUNT="${_ra:-1}"
if ! echo "$REVEAL_AMOUNT" | grep -qE '^[0-9]+$' || [ "$REVEAL_AMOUNT" -eq 0 ]; then
    echo "ERROR: amount must be a positive integer."; exit 1
fi
REVEAL_SECS=$(( REVEAL_AMOUNT * PICKED_MULTI ))
REVEAL_TS=$(( CURRENT_TS + REVEAL_SECS ))
DRAND_TARGET_ROUND=$(timestamp_to_drand_round "$REVEAL_TS")
REVEAL_DATE=$(format_ts "$REVEAL_TS")
echo "  → Drand round $DRAND_TARGET_ROUND  (~$REVEAL_DATE)"

echo ""

# ── Trading duration ──────────────────────────────────────────────────────────
echo "  TRADING DURATION — how long can participants trade after reveal?"
echo ""
pick_unit 3   # default: days
printf "  Amount in %s [1]: " "$PICKED_LABEL"
read -r _ta
TRADING_AMOUNT="${_ta:-1}"
if ! echo "$TRADING_AMOUNT" | grep -qE '^[0-9]+$' || [ "$TRADING_AMOUNT" -eq 0 ]; then
    echo "ERROR: amount must be a positive integer."; exit 1
fi
TRADING_SECS=$(( TRADING_AMOUNT * PICKED_MULTI ))
TRADING_LABEL="$TRADING_AMOUNT $PICKED_LABEL"
echo "  → $TRADING_LABEL (${TRADING_SECS}s)"

echo ""

# ── Step 4: Participation & costs ─────────────────────────────────────────────

echo "─── Participation ───────────────────────────────"
echo ""

printf "  Maximum number of participants (slots) [10]: "
read -r INPUT_SLOTS
MAX_SLOTS="${INPUT_SLOTS:-10}"

# Validate integer
if ! echo "$MAX_SLOTS" | grep -qE '^[0-9]+$' || [ "$MAX_SLOTS" -eq 0 ]; then
    echo "ERROR: Max slots must be a positive integer."
    exit 1
fi

printf "  Ticket cost in USDC per participant [1] (6 decimals): "
read -r INPUT_COST
TICKET_COST_ETH="${INPUT_COST:-1}"

# Validate number (basic check)
if ! echo "$TICKET_COST_ETH" | grep -qE '^[0-9]+(\.[0-9]+)?$'; then
    echo "ERROR: Ticket cost must be a number (e.g. 1 for 1 USDC)."
    exit 1
fi

# USDC has 6 decimals
TICKET_COST_WEI=$(awk "BEGIN { printf \"%.0f\", $TICKET_COST_ETH * 1e6 }")
TOTAL_FUNDING_WEI=$(awk "BEGIN { printf \"%.0f\", $MAX_SLOTS * $TICKET_COST_WEI }")
TOTAL_FUNDING_ETH=$(awk "BEGIN { printf \"%.6f\", $TOTAL_FUNDING_WEI / 1e6 }")

echo "  Total market cap    : $TOTAL_FUNDING_ETH USDC (you must approve + fund the contract)"

echo ""

# ── Step 5: Payment token (USDC Base Sepolia) ─────────────────────────────────

USDC_BASE_SEPOLIA="0x036CbD53842c5426634e7929541eC2318f3dCF7e"
echo "─── Payment Token ───────────────────────────────"
echo ""
echo "  Using USDC on Base Sepolia (ERC-20 only, ETH not supported)"
printf "  USDC address [%s]: " "$USDC_BASE_SEPOLIA"
read -r INPUT_TOKEN
PAYMENT_TOKEN="${INPUT_TOKEN:-$USDC_BASE_SEPOLIA}"
if ! echo "$PAYMENT_TOKEN" | grep -qE '^0x[0-9a-fA-F]{40}$'; then
    echo "ERROR: Invalid ERC-20 address format."
    exit 1
fi
TOKEN_LABEL="USDC: $PAYMENT_TOKEN"

echo ""

# ── Summary ───────────────────────────────────────────────────────────────────

echo "================================================"
echo "   Market Configuration Summary"
echo "================================================"
echo ""
printf "  %-20s %s\n" "Contract:"         "$MARKET_ADDRESS"
printf "  %-20s %s\n" "Question:"         "$QUESTION"
printf "  %-20s %s\n" "Schema URI:"       "$SCHEMA_URI"
printf "  %-20s %s\n" "Payment token:"    "$TOKEN_LABEL"
printf "  %-20s %s\n" "Max slots:"        "$MAX_SLOTS"
printf "  %-20s %s USDC (%s units)\n" "Ticket cost:"      "$TICKET_COST_ETH" "$TICKET_COST_WEI"
echo ""
printf "  %-20s %s USDC (%s units)\n" "You send:"         "$TOTAL_FUNDING_ETH" "$TOTAL_FUNDING_WEI"
printf "  %-20s Round %s  (~%s)\n"   "Reveal at:"        "$DRAND_TARGET_ROUND" "$REVEAL_DATE"
printf "  %-20s %s\n" "Trading duration:" "$TRADING_LABEL (${TRADING_SECS}s)"
echo ""
echo "================================================"
echo ""
printf "  Create this market? [y/N]: "
read -r CONFIRM

if [ "$CONFIRM" != "y" ] && [ "$CONFIRM" != "Y" ]; then
    echo ""
    echo "  Aborted."
    exit 0
fi

echo ""
echo "================================================"
echo "   Creating market..."
echo "================================================"
echo ""

# ── Run forge script ──────────────────────────────────────────────────────────

cd "$ROOT_DIR/contracts"

# Capture output to a temp file while still printing to terminal.
# Forge reads keystore password directly from /dev/tty so it survives the tee.
_OUTFILE=$(mktemp)

MARKET_ADDRESS="$MARKET_ADDRESS" \
QUESTION="$QUESTION" \
SCHEMA_URI="$SCHEMA_URI" \
PAYMENT_TOKEN="$PAYMENT_TOKEN" \
MAX_SLOTS="$MAX_SLOTS" \
TICKET_COST="$TICKET_COST_WEI" \
TRADING_DURATION="$TRADING_SECS" \
DRAND_TARGET_ROUND="$DRAND_TARGET_ROUND" \
forge script script/CreateMarket.s.sol:CreateMarket \
    --rpc-url "$RPC_URL" \
    --keystore "$KEYSTORE" \
    --chain-id "$CHAIN_ID" \
    --broadcast \
    -vvv 2>&1 | tee "$_OUTFILE" || { rm -f "$_OUTFILE"; exit 1; }

# Extract market ID from "Market created with ID: N" in the forge log output
CREATED_MARKET_ID=$(grep "Market created with ID:" "$_OUTFILE" | grep -oE '[0-9]+$' | head -1)
rm -f "$_OUTFILE"

echo ""
echo "================================================"
echo "   Market created successfully!"
echo "================================================"
if [ -n "$CREATED_MARKET_ID" ]; then
echo "  Market ID  : $CREATED_MARKET_ID"
fi
echo "  Contract   : $MARKET_ADDRESS"
echo "  Explorer   : https://sepolia.basescan.org/address/$MARKET_ADDRESS"
echo "================================================"
echo ""
if [ -n "$CREATED_MARKET_ID" ]; then
echo "  Phase 1 (price discovery) — cast votes (yes/no in 1000 basis points, e.g. 700=70% yes):"
echo "    PRIVATE_KEY=0x... ./scripts/simulate-phase1.sh $CREATED_MARKET_ID <yesPercent>"
echo "    (export key: cast wallet export chack)"
echo ""
echo "  Phase 1 resolution — after drand round passes, decrypt + build merkle + post:"
echo "    PRIVATE_KEY=0x... ./scripts/simulate-cre-phase1.sh $CREATED_MARKET_ID"
echo "    (signer must be authorized: cast send <CONTRACT> \"setAuthorizedSigner(address,bool)\" <ADDR> true --keystore chack)"
echo ""
echo "  Claim shares (after reveal):"
echo "    KEYS_FILE=./keys.txt bun run scripts/claim-shares.ts $CREATED_MARKET_ID"
echo ""
fi
