'use client';

import { shortenAddress } from '@/lib/utils';
import type { CreatorStats } from '@/lib/marketApi';

interface CreatorStatsCardProps {
  creator: CreatorStats;
  address: string;
}

export function CreatorStatsCard({ creator, address }: CreatorStatsCardProps) {
  const pnl = Number(creator.totalPnL) / 1e6;
  const avgPremium = Number(creator.totalPremium) / 1e6 / Math.max(creator.totalMarkets, 1);

  const stats = [
    {
      label: 'Markets Created',
      value: creator.totalMarkets.toString(),
      icon: (
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
        </svg>
      ),
    },
    {
      label: 'Realized PnL',
      value: `${pnl >= 0 ? '+' : ''}${pnl.toFixed(6)} USDC`,
      highlight: true,
      icon: (
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
      ),
    },
    {
      label: 'Avg Premium',
      value: `${avgPremium.toFixed(6)} USDC`,
      icon: (
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 8v13m0-13V6a2 2 0 112 2h-2zm0 0V5.5A2.5 2.5 0 109.5 8H12zm-7 4h14M5 12a2 2 0 110-4h14a2 2 0 110 4M5 12v7a2 2 0 002 2h10a2 2 0 002-2v-7" />
        </svg>
      ),
    },
  ];

  return (
    <div className="card-glow">
      <div className="flex items-start justify-between mb-6">
        <div>
          <div className="text-xs text-chainlink-text-muted uppercase tracking-wider mb-1">Creator Address</div>
          <div className="text-xl font-mono font-bold">{shortenAddress(address)}</div>
        </div>
        <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-amber-500/20 to-orange-500/20 border border-amber-500/30 flex items-center justify-center">
          <svg className="w-6 h-6 text-amber-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4" />
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
            <div className={`text-lg font-bold font-mono ${stat.highlight ? (pnl >= 0 ? 'text-green-400' : 'text-red-400') : ''}`}>
              {stat.value}
            </div>
          </div>
        ))}
      </div>

      {Object.keys(creator.labels).length > 0 && (
        <div className="mt-6 pt-6 border-t border-chainlink-border/50">
          <div className="text-xs text-chainlink-text-muted uppercase tracking-wider mb-3">By Label</div>
          <div className="flex flex-wrap gap-2">
            {Object.entries(creator.labels).map(([label, data]) => (
              <div key={label} className="px-3 py-1.5 rounded-lg bg-chainlink-surface text-sm">
                <span className="font-medium">{label}</span>
                <span className="text-chainlink-text-muted ml-2">
                  {data.markets} markets · {(Number(data.pnl) / 1e6).toFixed(6)} USDC
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
