import type { MarketPhase } from './types';

export interface AgentStats {
  id: string;
  totalSubmissions: bigint;
  totalMarketsParticipated: bigint;
  totalStaked: bigint;
  totalCorrectPredictions: bigint;
  totalWinnings: bigint;
  totalSharesClaimed: bigint;
  totalSwaps: bigint;
  reputation: bigint;
  firstSeenAt: bigint;
  lastActiveAt: bigint;
}

export interface AgentMarket {
  id: string;
  agent: string;
  marketId: bigint;
  participated: boolean;
  predictedOutcome: number | null;
  allocatedShares: bigint;
  claimedShares: boolean;
  yesShares: bigint;
  noShares: bigint;
  totalSwaps: bigint;
  totalPayout: bigint;
  wasCorrect: boolean | null;
}

export interface AgentWithMarket extends AgentMarket {
  market?: {
    question: string;
    phase: MarketPhase;
    resolvedOutcome: number | null;
    consensusOutcome: number | null;
  };
}

export interface AgentLeaderboardEntry {
  id: string;
  totalSubmissions: number;
  totalCorrectPredictions: number;
  totalWinnings: bigint;
  totalSwaps: number;
  winRate: number;
  reputation: bigint;
}

const PONDER_ENDPOINT = process.env.NEXT_PUBLIC_PONDER_ENDPOINT || 'http://localhost:42069';

const graphqlQuery = async <T>(query: string, variables?: Record<string, unknown>): Promise<T> => {
  const response = await fetch(`${PONDER_ENDPOINT}/graphql`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query, variables }),
  });

  const json = await response.json();
  
  if (json.errors) {
    throw new Error(json.errors[0].message);
  }

  return json.data;
};

export async function getAgentStats(agentAddress: string): Promise<AgentStats | null> {
  const query = `
    query GetAgent($id: String!) {
      agent(id: $id) {
        id
        totalSubmissions
        totalMarketsParticipated
        totalStaked
        totalCorrectPredictions
        totalWinnings
        totalSharesClaimed
        totalSwaps
        reputation
        firstSeenAt
        lastActiveAt
      }
    }
  `;

  const data = await graphqlQuery<{ agent: AgentStats | null }>(query, { id: agentAddress.toLowerCase() });
  return data.agent;
}

export async function getAgentMarkets(agentAddress: string, limit = 20, offset = 0): Promise<AgentMarket[]> {
  const query = `
    query GetAgentMarkets($agent: String!, $limit: Int!, $offset: Int!) {
      agentMarkets(
        where: { agent: $agent }
        limit: $limit
        offset: $offset
        orderBy: "marketId"
        orderDirection: "desc"
      ) {
        items {
          id
          agent
          marketId
          participated
          predictedOutcome
          allocatedShares
          claimedShares
          yesShares
          noShares
          totalSwaps
          totalPayout
          wasCorrect
        }
      }
    }
  `;

  const data = await graphqlQuery<{ agentMarkets: { items: AgentMarket[] } }>(query, {
    agent: agentAddress.toLowerCase(),
    limit,
    offset,
  });

  return data.agentMarkets.items;
}

export async function getAgentLeaderboard(limit = 10): Promise<AgentLeaderboardEntry[]> {
  const query = `
    query GetLeaderboard($limit: Int!) {
      agents(
        limit: $limit
        orderBy: "totalCorrectPredictions"
        orderDirection: "desc"
      ) {
        items {
          id
          totalSubmissions
          totalCorrectPredictions
          totalWinnings
          totalSwaps
          reputation
        }
      }
    }
  `;

  const data = await graphqlQuery<{ agents: { items: AgentStats[] } }>(query, { limit });

  return data.agents.items.map((agent) => ({
    id: agent.id,
    totalSubmissions: Number(agent.totalSubmissions),
    totalCorrectPredictions: Number(agent.totalCorrectPredictions),
    totalWinnings: agent.totalWinnings,
    totalSwaps: Number(agent.totalSwaps),
    winRate: Number(agent.totalSubmissions) > 0
      ? Number(agent.totalCorrectPredictions) / Number(agent.totalSubmissions)
      : 0,
    reputation: agent.reputation,
  }));
}

export async function getTopAgents(limit = 5): Promise<AgentStats[]> {
  const query = `
    query GetTopAgents($limit: Int!) {
      agents(
        limit: $limit
        orderBy: "totalWinnings"
        orderDirection: "desc"
      ) {
        items {
          id
          totalSubmissions
          totalMarketsParticipated
          totalStaked
          totalCorrectPredictions
          totalWinnings
          totalSharesClaimed
          totalSwaps
          reputation
          firstSeenAt
          lastActiveAt
        }
      }
    }
  `;

  const data = await graphqlQuery<{ agents: { items: AgentStats[] } }>(query, { limit });
  return data.agents.items;
}

export function calculateWinRate(agent: AgentStats): number {
  if (Number(agent.totalSubmissions) === 0) return 0;
  return Number(agent.totalCorrectPredictions) / Number(agent.totalSubmissions);
}

export function formatAddress(address: string): string {
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}
