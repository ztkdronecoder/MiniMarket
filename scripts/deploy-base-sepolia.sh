#!/bin/bash
# Deploy MiniMarket to Base Sepolia using a Foundry keystore account.
# Saves the deployed contract address to <root>/deployed-addresses.json.
#
# Usage:
#   ./scripts/deploy-base-sepolia.sh
#
# Environment overrides (all optional):
#   KEYSTORE            Path to Foundry keystore file  (default: ~/.foundry/keystores/chack)
#   RPC_URL             Base Sepolia RPC endpoint       (default: https://sepolia.base.org)
#   CRE_FORWARDER       CRE forwarder address           (default: Base Sepolia constant in SPDC.sol)
#   ETHERSCAN_API_KEY   Basescan API key for verification (skipped if unset)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"

KEYSTORE="${KEYSTORE:-$HOME/.foundry/keystores/chack}"
RPC_URL="${RPC_URL:-https://sepolia.base.org}"
CHAIN_ID=84532

echo "================================================"
echo "  MiniMarket — Deploy to Base Sepolia"
echo "================================================"
echo "  Keystore : $KEYSTORE"
echo "  RPC URL  : $RPC_URL"
echo "  Chain ID : $CHAIN_ID"
echo "================================================"
echo ""

# ── Pre-flight checks ────────────────────────────────────────────────────────

if [ ! -f "$KEYSTORE" ]; then
    echo "ERROR: Keystore not found at: $KEYSTORE"
    echo "  Create one with: cast wallet import chack --interactive"
    exit 1
fi

command -v forge >/dev/null 2>&1 || { echo "ERROR: forge not found in PATH"; exit 1; }
command -v jq    >/dev/null 2>&1 || { echo "ERROR: jq not found. Install with: sudo apt install jq"; exit 1; }

# ── Build verification flags ─────────────────────────────────────────────────

VERIFY_FLAGS=()
if [ -n "${ETHERSCAN_API_KEY:-}" ]; then
    VERIFY_FLAGS+=(--verify --etherscan-api-key "$ETHERSCAN_API_KEY")
    echo "  Basescan verification: enabled"
else
    echo "  Basescan verification: skipped (set ETHERSCAN_API_KEY to enable)"
fi
echo ""

# ── Run forge script ─────────────────────────────────────────────────────────

cd "$ROOT_DIR/contracts"

echo "Running forge script..."
echo ""

forge script script/Deploy.s.sol:DeployMiniMarketSepolia \
    --rpc-url "$RPC_URL" \
    --keystore "$KEYSTORE" \
    --chain-id "$CHAIN_ID" \
    --broadcast \
    "${VERIFY_FLAGS[@]}" \
    -vvv

# ── Extract deployed address from broadcast JSON ──────────────────────────────

BROADCAST_FILE="$ROOT_DIR/contracts/broadcast/Deploy.s.sol/$CHAIN_ID/run-latest.json"

if [ ! -f "$BROADCAST_FILE" ]; then
    echo ""
    echo "ERROR: Broadcast file not found at:"
    echo "  $BROADCAST_FILE"
    echo "The deployment may have failed. Check forge output above."
    exit 1
fi

ADDRESS=$(jq -r '
  .transactions[]
  | select((.transactionType == "CREATE" or .transactionType == "CREATE2") and (.contractName == "MiniMarket" or .contractName == null))
  | .contractAddress
  | select(. != null)
' "$BROADCAST_FILE" | head -1)

# Fallback: first CREATE transaction
if [ -z "$ADDRESS" ] || [ "$ADDRESS" = "null" ]; then
    ADDRESS=$(jq -r '
      .transactions[]
      | select(.transactionType == "CREATE" or .transactionType == "CREATE2")
      | .contractAddress
      | select(. != null)
    ' "$BROADCAST_FILE" | head -1)
fi

if [ -z "$ADDRESS" ] || [ "$ADDRESS" = "null" ]; then
    echo ""
    echo "ERROR: Could not extract MiniMarket address from broadcast JSON."
    echo "  File: $BROADCAST_FILE"
    exit 1
fi

# ── Write deployed-addresses.json ─────────────────────────────────────────────

DEPLOYED_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

cat > "$ROOT_DIR/deployed-addresses.json" <<EOF
{
  "baseSepolia": {
    "MiniMarket": "$ADDRESS",
    "network": "base-sepolia",
    "chainId": $CHAIN_ID,
    "deployedAt": "$DEPLOYED_AT"
  }
}
EOF

# ── Done ──────────────────────────────────────────────────────────────────────

echo ""
echo "================================================"
echo "  Deployment complete!"
echo "================================================"
echo "  MiniMarket : $ADDRESS"
echo "  Network    : Base Sepolia (chain $CHAIN_ID)"
echo "  Saved to   : deployed-addresses.json"
echo "================================================"
echo ""
echo "Next steps:"
echo "  Create a market:  ./scripts/create-market.sh"
echo "  View on explorer: https://sepolia.basescan.org/address/$ADDRESS"
echo ""
