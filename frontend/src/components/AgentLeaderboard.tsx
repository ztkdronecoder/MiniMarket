'use client';

import Link from 'next/link';
import { shortenAddress } from '@/lib/utils';
import type { AgentLeaderboardEntry } from '@/lib/agentApi';

const RANK_STYLE = [
  { bg: 'rgba(255,255,255,0.12)', color: 'rgba(255,255,255,0.95)', label: '🥇' },
  { bg: 'rgba(255,255,255,0.1)', color: 'rgba(255,255,255,0.8)', label: '🥈' },
  { bg: 'rgba(255,255,255,0.08)', color: 'rgba(255,255,255,0.65)', label: '🥉' },
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
        <Link href="/leaderboard" className="text-xs font-medium transition-colors text-white/90"
          onMouseEnter={(e) => { e.currentTarget.style.color = 'rgba(255,255,255,0.7)'; }}
          onMouseLeave={(e) => { e.currentTarget.style.color = 'rgba(255,255,255,0.9)'; }}>
          View all →
        </Link>
      </div>

      <div className="space-y-2">
        {agents.map((agent, i) => {
          const rankStyle = i < 3 ? RANK_STYLE[i] : { bg: 'rgba(255,255,255,0.08)', color: 'rgba(255,255,255,0.9)', label: `${i + 1}` };
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
                    style={{ color: agent.avgConfidence > 0.5 ? 'rgba(255,255,255,0.9)' : 'var(--text-muted)' }}>
                    {(agent.avgConfidence * 100).toFixed(0)}%
                  </div>
                  {agent.totalStaked > BigInt(0) && (
                    <div className="text-[10px] font-mono"
                      style={{ color: netProfit >= 0 ? 'rgba(255,255,255,0.9)' : 'var(--text-muted)' }}>
                      {netProfit >= 0 ? '+' : ''}{netProfit.toFixed(6)} USDC
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
