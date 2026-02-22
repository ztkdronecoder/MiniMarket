'use client';

import Link from 'next/link';
import { shortenAddress } from '@/lib/utils';
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
    <div className="space-y-4">
      {markets.map((am) => (
        <Link key={am.id} href={`/market/${am.marketId}`} className="block">
          <div className="card-flat hover:border-chainlink-accent/30 transition-colors">
            <div className="flex items-start justify-between mb-3">
              <div className="flex items-center gap-3">
                <div className="text-xs text-chainlink-text-muted font-mono bg-chainlink-surface px-2 py-0.5 rounded">
                  Market #{am.marketId.toString()}
                </div>
                {am.wasCorrect !== null && (
                  <div className={`text-xs font-semibold ${am.wasCorrect ? 'text-green-400' : 'text-red-400'}`}>
                    {am.wasCorrect ? '✓ Correct' : '✗ Incorrect'}
                  </div>
                )}
              </div>
              {am.participated && (
                <div className="badge-info text-xs">Participated</div>
              )}
            </div>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
              <div>
                <div className="text-chainlink-text-muted mb-1">Prediction</div>
                <div className={`font-semibold ${am.predictedOutcome === 1 ? 'text-green-400' : am.predictedOutcome === 2 ? 'text-red-400' : 'text-chainlink-text-muted'}`}>
                  {am.predictedOutcome === 1 ? 'YES' : am.predictedOutcome === 2 ? 'NO' : '—'}
                </div>
              </div>
              <div>
                <div className="text-chainlink-text-muted mb-1">Shares</div>
                <div className="font-mono">{(Number(am.allocatedShares) / 1e18).toFixed(2)}</div>
              </div>
              <div>
                <div className="text-chainlink-text-muted mb-1">Swaps</div>
                <div className="font-mono">{am.totalSwaps.toString()}</div>
              </div>
              <div>
                <div className="text-chainlink-text-muted mb-1">Payout</div>
                <div className="font-mono text-chainlink-accent">{(Number(am.totalPayout) / 1e18).toFixed(4)} ETH</div>
              </div>
            </div>
          </div>
        </Link>
      ))}
    </div>
  );
}
