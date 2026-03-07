#!/bin/bash
# Cast encrypted votes (Phase 1 price discovery) on Cortex.
# Votes use yes/no in 1000 basis points (e.g. 700 = 70% yes, 30% no).
#
# Usage:
#   ./scripts/simulate-phase1.sh <marketId> [yesPercent1] [yesPercent2] ...
#
# Examples:
#   ./scripts/simulate-phase1.sh 1              # interactive: prompt for vote
#   ./scripts/simulate-phase1.sh 1 700 300 500   # cast 3 votes: 70%, 30%, 50% yes
#
# Environment:
#   MARKET_ADDRESS      Contract (or from deployed-addresses.json)
#   RPC_URL             RPC endpoint (default: https://sepolia.base.org)
#   KEYSTORE            Foundry keystore path (default: ~/.foundry/keystores/chack)
#   KEYSTORE_PASSWORD   Keystore password (prompted if not set)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"

RPC_URL="${RPC_URL:-https://sepolia.base.org}"
MARKET_ADDRESS="${MARKET_ADDRESS:-}"

# Load market address from deployed-addresses.json if not set
load_market_address() {
    if [ -n "$MARKET_ADDRESS" ]; then return; fi
    local json_file="$ROOT_DIR/deployed-addresses.json"
    if [ -f "$json_file" ] && command -v jq >/dev/null 2>&1; then
        MARKET_ADDRESS=$(jq -r '.baseSepolia.MiniMarket // empty' "$json_file" 2>/dev/null || true)
    fi
}

if [ $# -lt 1 ]; then
    echo "Usage: $0 <marketId> [yesPercent1] [yesPercent2] ..."
    echo ""
    echo "  marketId    Market ID (from contracts/script/create-market.sh)"
    echo "  yesPercent  Optional: 0-1000 basis points (700 = 70% yes, 30% no)"
    echo "              If omitted, prompts for one vote using KEYSTORE."
    echo ""
    echo "Examples:"
    echo "  $0 1 700 300 500   # Cast 3 votes: 70%, 30%, 50% yes"
    echo "  $0 1               # Interactive: enter yesPercent, cast one vote"
    exit 1
fi

MARKET_ID="$1"
shift
VOTES=("$@")

load_market_address
if [ -z "$MARKET_ADDRESS" ]; then
    echo "ERROR: Set MARKET_ADDRESS or have deployed-addresses.json with baseSepolia.MiniMarket"
    exit 1
fi

BUN="${BUN:-$HOME/.bun/bin/bun}"
if ! command -v "$BUN" >/dev/null 2>&1; then
    BUN="bun"
    command -v bun >/dev/null 2>&1 || { echo "ERROR: bun not found. Install: https://bun.sh"; exit 1; }
fi

echo ""
echo "================================================"
echo "   Phase 1 — Cast Encrypted Votes"
echo "================================================"
echo "  Market   : $MARKET_ID"
echo "  Votes    : ${VOTES[*]:-<will prompt>}"
echo "  Contract : $MARKET_ADDRESS"
echo "  RPC      : $RPC_URL"
echo "================================================"
echo ""

# If no votes provided, prompt for one
if [ ${#VOTES[@]} -eq 0 ]; then
    echo "Enter yes percent (0-1000 basis points, e.g. 700 = 70% yes):"
    read -r YES_PERCENT
    VOTES=("$YES_PERCENT")
fi

# Keystore setup — prompt password once for all votes
KEYSTORE="${KEYSTORE:-$HOME/.foundry/keystores/chack}"
if [ ! -f "$KEYSTORE" ]; then
    echo "ERROR: Keystore not found at $KEYSTORE"
    exit 1
fi
if [ -z "${KEYSTORE_PASSWORD:-}" ]; then
    read -rsp "Keystore password for $(basename "$KEYSTORE"): " KEYSTORE_PASSWORD
    echo ""
fi
export KEYSTORE KEYSTORE_PASSWORD

SUCCESS=0
FAILED=0
for i in "${!VOTES[@]}"; do
    YP="${VOTES[$i]}"
    echo "--- Vote $((i+1))/${#VOTES[@]}: ${YP}bp yes ($((1000 - YP))bp no) ---"
    if MARKET_ADDRESS="$MARKET_ADDRESS" RPC_URL="$RPC_URL" \
        "$BUN" run "$SCRIPT_DIR/cast-vote.ts" "$MARKET_ID" "$YP" 2>&1; then
        SUCCESS=$((SUCCESS + 1))
    else
        FAILED=$((FAILED + 1))
    fi
    echo ""
done

echo "================================================"
echo "   Done: $SUCCESS cast, $FAILED failed"
echo "================================================"
echo ""
echo "Next: wait for drand round, then run:"
echo "  ./scripts/simulate-cre-phase1.sh $MARKET_ID"
echo ""
