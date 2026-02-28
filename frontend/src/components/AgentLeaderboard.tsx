'use client';

import Link from 'next/link';
import { shortenAddress } from '@/lib/utils';
import type { AgentLeaderboardEntry } from '@/lib/agentApi';

const RANK_STYLE = [
  { bg: 'rgba(251,191,36,0.12)', color: '#FBBF24', label: '🥇' },
  { bg: 'rgba(156,163,175,0.12)', color: '#9CA3AF', label: '🥈' },
  { bg: 'rgba(234,88,12,0.12)', color: '#FB923C', label: '🥉' },
];

interface AgentLeaderboardProps {
  agents: AgentLeaderboardEntry[];
}

export function AgentLeaderboard({ agents }: AgentLeaderboardProps) {
  if (agents.length === 0) {
    return (
      <div className="card-glow">
        <h3 className="section-title text-sm">Top Agents</h3>
        <div className="py-8 text-center text-sm" style={{ color: 'var(--text-muted)' }}>
          No agents yet
        </div>
      </div>
    );
  }

  return (
    <div className="card-glow">
      <div className="flex items-center justify-between mb-5">
        <h3 className="section-title text-sm mb-0">Top Agents</h3>
        <Link href="/leaderboard" className="text-xs font-medium transition-colors"
          style={{ color: '#60A5FA' }}
          onMouseEnter={(e) => { e.currentTarget.style.color = '#93C5FD'; }}
          onMouseLeave={(e) => { e.currentTarget.style.color = '#60A5FA'; }}>
          View all →
        </Link>
      </div>

      <div className="space-y-2">
        {agents.map((agent, i) => {
          const rankStyle = i < 3 ? RANK_STYLE[i] : { bg: 'rgba(42,90,218,0.08)', color: '#60A5FA', label: `${i + 1}` };
          const netProfit = (Number(agent.totalWinnings) - Number(agent.totalStaked)) / 1e6;

          return (
            <Link key={agent.id} href={`/agent/${agent.id}`} className="block group">
              <div className="flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all duration-150"
                style={{ background: 'transparent' }}
                onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(255,255,255,0.04)'; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
              >
                {/* Rank */}
                <div className="w-7 h-7 rounded-lg flex items-center justify-center text-xs font-bold flex-shrink-0"
                  style={{ background: rankStyle.bg, color: rankStyle.color }}>
                  {i < 3 ? rankStyle.label : i + 1}
                </div>

                {/* Info */}
                <div className="flex-1 min-w-0">
                  <div className="font-mono text-xs text-white truncate">
                    {shortenAddress(agent.id)}
                  </div>
                  <div className="text-[10px] mt-0.5" style={{ color: 'var(--text-muted)' }}>
                    {agent.totalSubmissions} predictions · {agent.totalCorrectPredictions} ✓
                  </div>
                </div>

                {/* Stats */}
                <div className="text-right flex-shrink-0">
                  <div className="text-sm font-bold font-mono"
                    style={{ color: agent.avgConfidence > 0.5 ? '#34D399' : 'var(--text-muted)' }}>
                    {(agent.avgConfidence * 100).toFixed(0)}%
                  </div>
                  {agent.totalStaked > 0n && (
                    <div className="text-[10px] font-mono"
                      style={{ color: netProfit >= 0 ? '#34D399' : '#F87171' }}>
                      {netProfit >= 0 ? '+' : ''}{netProfit.toFixed(2)} USDC
                    </div>
                  )}
                </div>
              </div>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
