'use client';

import Link from 'next/link';
import type { AgentMarket } from '@/lib/agentApi';

interface AgentMarketListProps {
  markets: AgentMarket[];
}

export function AgentMarketList({ markets }: AgentMarketListProps) {
  if (markets.length === 0) {
    return (
      <div className="card-flat text-center py-12">
        <svg className="w-12 h-12 mx-auto text-chainlink-text-muted/50 mb-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
        </svg>
        <p className="text-chainlink-text-muted">No market participation found</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {markets.map((am) => (
        <Link key={am.id} href={`/market/${am.marketId}`} className="block">
          <div className="card-flat hover:border-chainlink-accent/30 transition-colors">
            {/* Header row */}
            <div className="flex items-start justify-between mb-2">
              <div className="flex items-center gap-2 flex-wrap">
                <div className="text-xs text-chainlink-text-muted font-mono bg-chainlink-surface px-2 py-0.5 rounded">
                  #{am.marketId.toString()}
                </div>
                {am.marketLabel && (
                  <span className="text-[10px] px-1.5 py-0.5 rounded font-medium uppercase tracking-wide"
                    style={{ background: 'rgba(96,165,250,0.1)', color: '#60A5FA' }}>
                    {am.marketLabel}
                  </span>
                )}
                {am.wasCorrect !== null && (
                  <div className={`text-xs font-semibold ${am.wasCorrect ? 'text-green-400' : 'text-red-400'}`}>
                    {am.wasCorrect ? '✓ Correct' : '✗ Incorrect'}
                  </div>
                )}
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                {am.ticketCost !== null && (
                  <span className="text-xs text-chainlink-text-muted font-mono">
                    {(Number(am.ticketCost) / 1e6).toFixed(2)} USDC/ticket
                  </span>
                )}
                {am.participated && (
                  <div className="badge-info text-xs">Participated</div>
                )}
              </div>
            </div>

            {/* Market question */}
            {am.marketQuestion && (
              <p className="text-sm text-white mb-3 leading-snug line-clamp-2">{am.marketQuestion}</p>
            )}

            {/* Stats */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
              <div>
                <div className="text-chainlink-text-muted mb-1">Share Split</div>
                {(() => {
                  const total = Number(am.yesShares) + Number(am.noShares);
                  if (total === 0) return <div className="font-mono text-chainlink-text-muted">—</div>;
                  const yesPct = (Number(am.yesShares) / total * 100).toFixed(0);
                  const noPct = (Number(am.noShares) / total * 100).toFixed(0);
                  return (
                    <div className="font-mono text-xs">
                      <span className="text-green-400">{yesPct}% YES</span>
                      <span className="text-chainlink-text-muted"> / </span>
                      <span className="text-red-400">{noPct}% NO</span>
                    </div>
                  );
                })()}
              </div>
              <div>
                <div className="text-chainlink-text-muted mb-1">Confidence</div>
                <div className="font-mono">
                  {am.wasCorrect !== null
                    ? <span style={{ color: am.wasCorrect ? '#34D399' : '#F87171' }}>{am.confidenceScore.toFixed(1)}%</span>
                    : <span className="text-chainlink-text-muted">—</span>}
                </div>
              </div>
              <div>
                <div className="text-chainlink-text-muted mb-1">Swaps</div>
                <div className="font-mono">{am.totalSwaps.toString()}</div>
              </div>
              <div>
                <div className="text-chainlink-text-muted mb-1">Payout</div>
                <div className="font-mono text-chainlink-accent">
                  {Number(am.totalPayout) > 0
                    ? `${(Number(am.totalPayout) / 1e6).toFixed(2)} USDC`
                    : '—'}
                </div>
              </div>
            </div>
          </div>
        </Link>
      ))}
    </div>
  );
}
