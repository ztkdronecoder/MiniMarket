#!/bin/bash
# Switch the active network for indexer + frontend.
#
# Usage:
#   ./scripts/use-network.sh anvil    — local Anvil fork
#   ./scripts/use-network.sh sepolia  — Base Sepolia testnet
#
# What it writes:
#   indexer/.env.local   (gitignored — overrides ponder.config chain/address)
#   frontend/.env.local  (gitignored — overrides NEXT_PUBLIC_* from .env)
#
# Note: restart `ponder dev` and `next dev` after switching.

set -euo pipefail

NETWORK="${1:-}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEPLOYED="$ROOT/deployed-addresses.json"

command -v jq >/dev/null 2>&1 || { echo "ERROR: jq not found"; exit 1; }

USDC_SEPOLIA="0x036CbD53842c5426634e7929541eC2318f3dCF7e"

write_envs() {
  local rpc="$1" contract="$2" chain_id="$3" start_block="$4" label="$5"

  # indexer/.env.local
  cat > "$ROOT/indexer/.env.local" << EOF
NETWORK=$label
RPC_URL=$rpc
CONTRACT_ADDRESS=$contract
START_BLOCK=$start_block
EOF
  echo "  indexer/.env.local     → NETWORK=$label  CONTRACT=$contract"

  # frontend/.env.local
  cat > "$ROOT/frontend/.env.local" << EOF
NEXT_PUBLIC_CHAIN_ID=$chain_id
NEXT_PUBLIC_MARKET_ADDRESS=$contract
NEXT_PUBLIC_USDC_ADDRESS=$USDC_SEPOLIA
NEXT_PUBLIC_PONDER_ENDPOINT=http://localhost:42069
EOF
  echo "  frontend/.env.local    → CHAIN_ID=$chain_id  CONTRACT=$contract"
}

case "$NETWORK" in

  anvil|local)
    ANVIL_DEPLOYED="$ROOT/scripts/phase-1-test/deployed.json"
    if [ ! -f "$ANVIL_DEPLOYED" ]; then
      echo "ERROR: $ANVIL_DEPLOYED not found."
      echo "       Run scripts/phase-1-test/script.sh first to deploy locally."
      exit 1
    fi
    CONTRACT=$(jq -r '.localhost.Cortex // empty' "$ANVIL_DEPLOYED")
    if [ -z "$CONTRACT" ]; then
      echo "ERROR: Could not read MiniMarket address from $ANVIL_DEPLOYED"
      exit 1
    fi
    echo ""
    echo "Switching to: Anvil (localhost)"
    write_envs "http://127.0.0.1:8545" "$CONTRACT" "31337" "1" "local"
    ;;

  sepolia|base-sepolia)
    if [ ! -f "$DEPLOYED" ]; then
      echo "ERROR: $DEPLOYED not found. Deploy to Sepolia first."
      exit 1
    fi
    CONTRACT=$(jq -r '.baseSepolia.Cortex // empty' "$DEPLOYED")
    START_BLOCK=$(jq -r '.baseSepolia.startBlock // "0"' "$DEPLOYED")
    if [ -z "$CONTRACT" ]; then
      echo "ERROR: Could not read baseSepolia.Cortex from $DEPLOYED"
      exit 1
    fi
    echo ""
    echo "Switching to: Base Sepolia"
    write_envs "https://sepolia.base.org" "$CONTRACT" "84532" "$START_BLOCK" "base-sepolia"
    ;;

  *)
    echo "Usage: $0 [anvil|sepolia]"
    echo ""
    echo "  anvil    — local Anvil fork (reads address from scripts/phase-1-test/deployed.json)"
    echo "  sepolia  — Base Sepolia testnet (reads address from deployed-addresses.json)"
    echo ""
    echo "Current network (indexer/.env.local):"
    if [ -f "$ROOT/indexer/.env.local" ]; then
      grep -E "^(NETWORK|RPC_URL|CONTRACT_ADDRESS)" "$ROOT/indexer/.env.local" | sed 's/^/  /'
    else
      echo "  (not set)"
    fi
    exit 1
    ;;

esac

echo ""
echo "Done. Restart ponder (indexer/) and next dev (frontend/) to apply."
echo ""
