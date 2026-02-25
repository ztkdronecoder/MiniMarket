#!/bin/bash
# Full Phase 1 resolution: fetch real submissions from deployed contract, decrypt, build merkle, post.
# Uses the contract at deployed-addresses.json (current Base Sepolia deployment).
# Fetches actual encrypted submissions from chain — e.g. 10 participants = 10 real submissions.
#
# Usage:
#   ./scripts/simulate-cre-phase1.sh <marketId>
#
# Prerequisites:
#   - deployed-addresses.json with baseSepolia.MiniMarket
#   - Drand target round must have passed (predictions can be decrypted)
#   - PRIVATE_KEY must be CRE forwarder (or authorized signer with onReport)
#
# Environment:
#   RPC_URL      RPC endpoint (default: https://sepolia.base.org)
#   PRIVATE_KEY  Signer (CRE forwarder or authorized signer)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"
DEPLOYED_JSON="$ROOT_DIR/deployed-addresses.json"

RPC_URL="${RPC_URL:-https://sepolia.base.org}"

# Always use contract from deployed-addresses.json (current deployment)
if [ ! -f "$DEPLOYED_JSON" ]; then
    echo "ERROR: deployed-addresses.json not found. Run contracts/script/deploy-base-sepolia.sh first."
    exit 1
fi

command -v jq >/dev/null 2>&1 || { echo "ERROR: jq not found"; exit 1; }

MARKET_ADDRESS=$(jq -r '.baseSepolia.MiniMarket // empty' "$DEPLOYED_JSON")
if [ -z "$MARKET_ADDRESS" ] || [ "$MARKET_ADDRESS" = "null" ]; then
    echo "ERROR: baseSepolia.MiniMarket not found in deployed-addresses.json"
    exit 1
fi

if [ $# -lt 1 ]; then
    echo "Usage: $0 <marketId>"
    echo ""
    echo "  Fetches real encrypted submissions from the deployed contract (deployed-addresses.json),"
    echo "  decrypts with drand, builds merkle, posts revealInfoPhase."
    echo ""
    echo "  Contract: $MARKET_ADDRESS"
    echo "  Network:  Base Sepolia (testnet)"
    echo ""
    echo "  Requires PRIVATE_KEY (CRE forwarder or authorized signer)."
    echo "  Export from keystore: cast wallet export chack"
    exit 1
fi

MARKET_ID="$1"

if [ -z "${PRIVATE_KEY:-}" ]; then
    echo "ERROR: Set PRIVATE_KEY (must be CRE forwarder for revealInfoPhase)"
    echo "  Export from keystore: cast wallet export chack"
    exit 1
fi

command -v bun >/dev/null 2>&1 || { echo "ERROR: bun not found"; exit 1; }

echo ""
echo "================================================"
echo "   CRE Phase 1 Resolution"
echo "================================================"
echo "  Market    : $MARKET_ID"
echo "  Contract  : $MARKET_ADDRESS (from deployed-addresses.json)"
echo "  Network   : Base Sepolia (testnet)"
echo "  Fetching  : Real submissions from chain"
echo "================================================"
echo ""

cd "$ROOT_DIR"
PRIVATE_KEY="$PRIVATE_KEY" MARKET_ADDRESS="$MARKET_ADDRESS" RPC_URL="$RPC_URL" \
    bun run "$SCRIPT_DIR/reveal-phase1.ts" "$MARKET_ID"

echo ""
echo "Phase 1 complete. Users can now claim shares and trade (Phase 2)."
echo ""
