'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { AgentLeaderboard } from '@/components/AgentLeaderboard';
import { calculateWinRate, type AgentStats } from '@/lib/agentApi';

interface TopAgentsSectionProps {
  agents: AgentStats[];
  labels: string[];
  selectedLabel?: string;
}

export function TopAgentsSection({ agents, labels, selectedLabel }: TopAgentsSectionProps) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const setLabelFilter = (label: string) => {
    const params = new URLSearchParams(searchParams.toString());
    if (label) params.set('label', label);
    else params.delete('label');
    router.push(`/?${params.toString()}#markets`);
  };

  const leaderboardAgents = agents.map((a) => ({
    id: a.id,
    totalSubmissions: Number(a.totalSubmissions),
    totalCorrectPredictions: Number(a.totalCorrectPredictions),
    totalResolvedMarkets: Number(a.totalResolvedMarkets),
    totalWinnings: a.totalWinnings,
    totalStaked: a.totalStaked,
    totalSwaps: Number(a.totalSwaps),
    avgConfidence: calculateWinRate(a),
    reputation: a.reputation,
  }));

  return (
    <div className="space-y-3">
      {labels.length > 0 && (
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-chainlink-text-muted uppercase tracking-wide">Filter:</span>
          <select
            value={selectedLabel ?? ''}
            onChange={(e) => setLabelFilter(e.target.value)}
            className="flex-1 min-w-0 px-2 py-1.5 rounded-lg text-xs bg-chainlink-surface border border-chainlink-border/50 text-white focus:outline-none focus:ring-1 focus:ring-chainlink-accent"
          >
            <option value="">All labels</option>
            {labels.map((l) => (
              <option key={l} value={l}>{l}</option>
            ))}
          </select>
        </div>
      )}
      <AgentLeaderboard agents={leaderboardAgents} />
    </div>
  );
}
