'use client';

import { shortenAddress } from '@/lib/utils';
import { calculateWinRate, formatAddress, type AgentStats } from '@/lib/agentApi';

interface AgentStatsCardProps {
  agent: AgentStats;
}

export function AgentStatsCard({ agent }: AgentStatsCardProps) {
  const winRate = calculateWinRate(agent);
  const winRatePercent = (winRate * 100).toFixed(1);

  const stats = [
    {
      label: 'Markets',
      value: agent.totalMarketsParticipated.toString(),
      icon: (
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
        </svg>
      ),
    },
    {
      label: 'Submissions',
      value: agent.totalSubmissions.toString(),
      icon: (
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
        </svg>
      ),
    },
    {
      label: 'Avg Confidence',
      value: `${winRatePercent}%`,
      highlight: true,
      icon: (
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
      ),
    },
    {
      label: 'Net P&L',
      value: `${((Number(agent.totalWinnings) - Number(agent.totalStaked)) / 1e6).toFixed(2)} USDC`,
      icon: (
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
      ),
    },
    {
      label: 'Total Swaps',
      value: agent.totalSwaps.toString(),
      icon: (
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" />
        </svg>
      ),
    },
    {
      label: 'Reputation',
      value: agent.reputation.toString(),
      icon: (
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z" />
        </svg>
      ),
    },
  ];

  return (
    <div className="card-glow">
      <div className="flex items-start justify-between mb-6">
        <div>
          <div className="text-xs text-chainlink-text-muted uppercase tracking-wider mb-1">Agent Address</div>
          <div className="text-xl font-mono font-bold">{shortenAddress(agent.id)}</div>
        </div>
        <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-chainlink-blue to-chainlink-accent flex items-center justify-center">
          <svg className="w-6 h-6 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
          </svg>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
        {stats.map((stat) => (
          <div key={stat.label} className="bg-chainlink-surface rounded-xl p-3">
            <div className="flex items-center gap-2 mb-1">
              <div className="text-chainlink-text-muted">{stat.icon}</div>
              <span className="stat-label">{stat.label}</span>
            </div>
            <div className={`text-lg font-bold font-mono ${stat.highlight ? 'text-green-400' : ''}`}>
              {stat.value}
            </div>
          </div>
        ))}
      </div>

      <div className="mt-6 pt-6 border-t border-chainlink-border/50">
        <div className="flex items-center justify-between text-sm">
          <div className="flex items-center gap-2 text-chainlink-text-muted">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            First seen: {new Date(Number(agent.firstSeenAt) * 1000).toLocaleDateString()}
          </div>
          <div className="flex items-center gap-2 text-chainlink-text-muted">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            Last active: {new Date(Number(agent.lastActiveAt) * 1000).toLocaleDateString()}
          </div>
        </div>
      </div>
    </div>
  );
}
