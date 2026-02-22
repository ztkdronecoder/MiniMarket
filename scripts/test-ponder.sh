#!/bin/bash
set -e

echo "Testing Ponder GraphQL connection..."

PONDER_URL="${PONDER_URL:-http://localhost:42069/graphql}"

QUERY='{
  "query": "{ markets(first: 5) { items { id question phase totalParticipants } } }"
}'

RESPONSE=$(curl -s -X POST "$PONDER_URL" \
  -H "Content-Type: application/json" \
  -d "$QUERY")

echo "Response:"
echo "$RESPONSE" | jq '.' 2>/dev/null || echo "$RESPONSE"

if echo "$RESPONSE" | grep -q '"errors"'; then
    echo ""
    echo "ERROR: GraphQL query failed"
    exit 1
fi

if echo "$RESPONSE" | grep -q '"items"'; then
    echo ""
    echo "SUCCESS: Ponder is responding correctly"
else
    echo ""
    echo "WARNING: Unexpected response format"
fi
