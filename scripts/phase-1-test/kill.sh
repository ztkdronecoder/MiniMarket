#!/bin/bash
# Kill anvil and ponder processes (run this if the phase-1-test script didn't exit cleanly)
pkill -9 -f "anvil.*8545" 2>/dev/null || true
pkill -9 -f "ponder dev" 2>/dev/null || true
pkill -9 -f "ponder.*dev" 2>/dev/null || true
echo "Killed anvil and ponder processes"
