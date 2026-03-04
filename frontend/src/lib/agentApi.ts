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
  totalConfidenceScore: bigint;
  totalResolvedMarkets: bigint;
  firstSeenAt: bigint;
  lastActiveAt: bigint;
}

export interface AgentSubmarketStat {
  submarketId: string;
  optionIndex: number;
  optionLabel: string | null;
  yesShares: bigint;
  noShares: bigint;
  totalSwaps: bigint;
  totalPayout: bigint;
  wasCorrect: boolean | null;
  confidenceScore: number; // 0–100 (%)
}

export interface AgentMarket {
  id: string;
  agent: string;
  marketId: bigint;
  participated: boolean;
  marketQuestion: string | null;
  ticketCost: bigint | null;
  marketLabel: string | null;
  submarkets: AgentSubmarketStat[];
}


export interface AgentLabelReputation {
  id: string;
  label: string;
  reputation: bigint;       // bps-based points (0-10000 per market)
  totalPredictions: number;
  correctPredictions: number;
  totalWinnings: bigint;
  totalStaked: bigint;
}

export interface AgentLeaderboardEntry {
  id: string;
  totalSubmissions: number;
  totalCorrectPredictions: number;
  totalResolvedMarkets: number;
  totalWinnings: bigint;
  totalStaked: bigint;
  totalSwaps: number;
  // 0–1: average confidence score (winning_shares / total_shares) across resolved markets
  avgConfidence: number;
  reputation: bigint;
}

interface PonderAgent {
  id: string;
  totalSubmissions: string;
  totalMarketsParticipated: string;
  totalStaked: string;
  totalCorrectPredictions: string;
  totalWinnings: string;
  totalSharesClaimed: string;
  totalSwaps: string;
  reputation: string;
  totalConfidenceScore: string;
  totalResolvedMarkets: string;
  firstSeenAt: string | null;
  lastActiveAt: string | null;
}

interface PonderAgentMarket {
  id: string;
  agent: string;
  marketId: string;
  participated: boolean;
  marketQuestion: string | null;
  ticketCost: string | null;
  marketLabel: string | null;
  submarkets: Array<{
    submarketId: string;
    optionIndex: number;
    optionLabel: string | null;
    yesShares: string | null;
    noShares: string | null;
    totalSwaps: string | null;
    totalPayout: string | null;
    wasCorrect: boolean | null;
    confidenceScore: string | null;
  }>;
}

const PONDER_ENDPOINT = process.env.NEXT_PUBLIC_PONDER_ENDPOINT || 'http://localhost:42069';

const restGet = async <T>(path: string): Promise<T> => {
  const response = await fetch(`${PONDER_ENDPOINT}${path}`, { cache: 'no-store' });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
  }
  return response.json();
};

function mapPonderAgent(a: PonderAgent): AgentStats {
  return {
    id: a.id,
    totalSubmissions: BigInt(a.totalSubmissions || 0),
    totalMarketsParticipated: BigInt(a.totalMarketsParticipated || 0),
    totalStaked: BigInt(a.totalStaked || 0),
    totalCorrectPredictions: BigInt(a.totalCorrectPredictions || 0),
    totalWinnings: BigInt(a.totalWinnings || 0),
    totalSharesClaimed: BigInt(a.totalSharesClaimed || 0),
    totalSwaps: BigInt(a.totalSwaps || 0),
    reputation: BigInt(a.reputation || 0),
    totalConfidenceScore: BigInt(a.totalConfidenceScore || 0),
    totalResolvedMarkets: BigInt(a.totalResolvedMarkets || 0),
    firstSeenAt: BigInt(a.firstSeenAt || 0),
    lastActiveAt: BigInt(a.lastActiveAt || 0),
  };
}

function mapPonderAgentMarket(m: PonderAgentMarket): AgentMarket {
  return {
    id: m.id,
    agent: m.agent,
    marketId: BigInt(m.marketId),
    participated: m.participated,
    marketQuestion: m.marketQuestion ?? null,
    ticketCost: m.ticketCost ? BigInt(m.ticketCost) : null,
    marketLabel: m.marketLabel ?? null,
    submarkets: (m.submarkets ?? []).map((s) => ({
      submarketId: s.submarketId,
      optionIndex: s.optionIndex,
      optionLabel: s.optionLabel ?? null,
      yesShares: BigInt(s.yesShares || 0),
      noShares: BigInt(s.noShares || 0),
      totalSwaps: BigInt(s.totalSwaps || 0),
      totalPayout: BigInt(s.totalPayout || 0),
      wasCorrect: s.wasCorrect ?? null,
      confidenceScore: Number(s.confidenceScore || 0) / 100, // bps → 0–100%
    })),
  };
}

export async function getAgentStats(agentAddress: string): Promise<AgentStats | null> {
  try {
    const a = await restGet<PonderAgent>(`/agents/${agentAddress.toLowerCase()}`);
    return mapPonderAgent(a);
  } catch {
    return null;
  }
}

export async function getAgentMarkets(agentAddress: string, limit = 20, offset = 0): Promise<AgentMarket[]> {
  try {
    const markets = await restGet<PonderAgentMarket[]>(
      `/agents/${agentAddress.toLowerCase()}/markets?limit=${limit}&offset=${offset}`
    );
    return markets.map(mapPonderAgentMarket);
  } catch {
    return [];
  }
}

export async function getAgentReputation(agentAddress: string): Promise<AgentLabelReputation[]> {
  try {
    const rows = await restGet<Array<{
      id: string;
      label: string;
      reputation: string;
      totalPredictions: string;
      correctPredictions: string;
      totalWinnings: string;
      totalStaked: string;
    }>>(`/agents/${agentAddress.toLowerCase()}/reputation`);
    return rows.map((r) => ({
      id: r.id,
      label: r.label,
      reputation: BigInt(r.reputation || 0),
      totalPredictions: Number(r.totalPredictions || 0),
      correctPredictions: Number(r.correctPredictions || 0),
      totalWinnings: BigInt(r.totalWinnings || 0),
      totalStaked: BigInt(r.totalStaked || 0),
    }));
  } catch {
    return [];
  }
}

export async function getLabels(): Promise<string[]> {
  try {
    return await restGet<string[]>(`/labels`);
  } catch {
    return [];
  }
}

export async function getAgentLeaderboard(limit = 10, label?: string): Promise<AgentLeaderboardEntry[]> {
  try {
    const labelParam = label ? `&label=${encodeURIComponent(label)}` : '';
    const agents = await restGet<PonderAgent[]>(
      `/agents?limit=${limit}&orderBy=totalCorrectPredictions${labelParam}`
    );

    return agents.map((a) => {
      const resolvedMarkets = Number(a.totalResolvedMarkets || 0);
      return {
        id: a.id,
        totalSubmissions: Number(a.totalSubmissions),
        totalCorrectPredictions: Number(a.totalCorrectPredictions),
        totalResolvedMarkets: resolvedMarkets,
        totalWinnings: BigInt(a.totalWinnings || 0),
        totalStaked: BigInt(a.totalStaked || 0),
        totalSwaps: Number(a.totalSwaps),
        // avgConfidence: sum of winning_share% across resolved markets / count
        avgConfidence: resolvedMarkets > 0
          ? Number(a.totalConfidenceScore || 0) / resolvedMarkets / 10000
          : 0,
        reputation: BigInt(a.reputation || 0),
      };
    });
  } catch {
    return [];
  }
}

export async function getTopAgents(limit = 5, label?: string): Promise<AgentStats[]> {
  try {
    const labelParam = label ? `&label=${encodeURIComponent(label)}` : '';
    const agents = await restGet<PonderAgent[]>(
      `/agents?limit=${limit}&orderBy=totalWinnings${labelParam}`
    );
    return agents.map(mapPonderAgent);
  } catch {
    return [];
  }
}

// Returns average confidence score (0–1): winning_shares/total_shares per resolved market
export function calculateWinRate(agent: AgentStats): number {
  if (Number(agent.totalResolvedMarkets) === 0) return 0;
  return Number(agent.totalConfidenceScore) / Number(agent.totalResolvedMarkets) / 10000;
}

/** Overall reputation: combined ratio of avg confidence + winrate across all labels (0–100%) */
export function calculateOverallReputation(agent: AgentStats): number {
  const resolved = Number(agent.totalResolvedMarkets);
  if (resolved === 0) return 0;
  const winrate = Number(agent.totalCorrectPredictions) / resolved;
  const avgConfidence = Number(agent.totalConfidenceScore) / resolved / 10000;
  return ((winrate + avgConfidence) / 2) * 100;
}

export function formatAddress(address: string): string {
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}
