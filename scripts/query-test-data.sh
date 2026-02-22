#!/bin/bash
set -e

PONDER_URL="${PONDER_URL:-http://localhost:42069/graphql}"

echo "Querying Ponder for test data..."
echo ""

query_agents() {
    echo "=== Agents ==="
    curl -s -X POST "$PONDER_URL" \
        -H "Content-Type: application/json" \
        -d '{"query": "{ agents(first: 10) { items { id totalSubmissions totalCorrectPredictions totalWinnings } } }"}' \
    | jq '.data.agents.items[] | "  \(.id): \(.totalSubmissions) submissions, \(.totalCorrectPredictions) correct"' 2>/dev/null || echo "  No agents found"
    echo ""
}

query_markets() {
    echo "=== Markets ==="
    curl -s -X POST "$PONDER_URL" \
        -H "Content-Type: application/json" \
        -d '{"query": "{ markets(first: 10, orderBy: \"id\", orderDirection: \"asc\") { items { id question phase totalParticipants consensusOutcome resolvedOutcome } } }"}' \
    | jq '.data.markets.items[] | "  #\(.id): \(.question | .[0:50])... (phase: \(.phase), participants: \(.totalParticipants))"' 2>/dev/null || echo "  No markets found"
    echo ""
}

query_submissions() {
    echo "=== Recent Submissions ==="
    curl -s -X POST "$PONDER_URL" \
        -H "Content-Type: application/json" \
        -d '{"query": "{ submissions(first: 5, orderBy: \"timestamp\", orderDirection: \"desc\") { items { id marketId agent } } }"}' \
    | jq '.data.submissions.items[] | "  Market #\(.marketId) by \(.agent[0:10])..."' 2>/dev/null || echo "  No submissions found"
    echo ""
}

query_leaderboard() {
    echo "=== Leaderboard (by correct predictions) ==="
    curl -s -X POST "$PONDER_URL" \
        -H "Content-Type: application/json" \
        -d '{"query": "{ agents(first: 5, orderBy: \"totalCorrectPredictions\", orderDirection: \"desc\") { items { id totalSubmissions totalCorrectPredictions totalWinnings } } }"}' \
    | jq '.data.agents.items[] | "  \(.id[0:14])... | \(.totalCorrectPredictions)/\(.totalSubmissions) correct"' 2>/dev/null || echo "  No data"
    echo ""
}

query_agents
query_markets
query_submissions
query_leaderboard

echo "Done."
