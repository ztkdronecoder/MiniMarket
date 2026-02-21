'use client';

import Link from 'next/link';
import type { Market } from '@/lib/types';
import { formatDistanceToNow } from '@/lib/utils';

interface MarketCardProps {
  market: Market;
}

export function MarketCard({ market }: MarketCardProps) {
  const phaseColors = {
    INFO_COLLECTION: 'badge-info',
    TRADING: 'badge-trading',
    RESOLVED: 'badge-resolved',
  };

  const phaseLabels = {
    INFO_COLLECTION: 'Info Phase',
    TRADING: 'Trading',
    RESOLVED: 'Resolved',
  };

  const yesPercentage = market.priceYes * 100;
  const noPercentage = market.priceNo * 100;

  return (
    <Link href={`/market/${market.id}`}>
      <div className="card-glow hover:border-chainlink-accent/50 transition-all duration-300 cursor-pointer h-full">
        <div className="flex items-start justify-between mb-4">
          <div className={`badge ${phaseColors[market.phase]}`}>
            {phaseLabels[market.phase]}
          </div>
          <div className="text-sm text-chainlink-text-muted font-mono">
            #{market.id}
          </div>
        </div>

        <h3 className="text-lg font-semibold mb-4 line-clamp-2">
          {market.question}
        </h3>

        <div className="mb-4">
          <div className="flex justify-between text-sm mb-2">
            <span className="text-green-400">YES {yesPercentage.toFixed(1)}%</span>
            <span className="text-red-400">NO {noPercentage.toFixed(1)}%</span>
          </div>
          <div className="progress-bar">
            <div
              className="progress-fill bg-gradient-to-r from-green-500 to-green-400"
              style={{ width: `${yesPercentage}%` }}
            />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4 text-sm">
          <div>
            <div className="text-chainlink-text-muted mb-1">Participants</div>
            <div className="font-mono">{market.participants}</div>
          </div>
          <div>
            <div className="text-chainlink-text-muted mb-1">Total Staked</div>
            <div className="font-mono">{market.totalStaked}</div>
          </div>
        </div>

        {market.phase === 'INFO_COLLECTION' && (
          <div className="mt-4 pt-4 border-t border-chainlink-border">
            <div className="flex items-center justify-between">
              <span className="text-sm text-chainlink-text-muted">Decrypts in</span>
              <span className="text-sm font-mono text-chainlink-accent">
                {formatDistanceToNow(market.decryptAt)}
              </span>
            </div>
          </div>
        )}

        {market.phase === 'TRADING' && market.consensusOutcome && (
          <div className="mt-4 pt-4 border-t border-chainlink-border">
            <div className="flex items-center justify-between">
              <span className="text-sm text-chainlink-text-muted">Consensus</span>
              <span className={`text-sm font-medium ${market.consensusOutcome === 'YES' ? 'text-green-400' : 'text-red-400'}`}>
                {market.consensusOutcome}
              </span>
            </div>
          </div>
        )}

        {market.phase === 'RESOLVED' && market.resolvedOutcome && (
          <div className="mt-4 pt-4 border-t border-chainlink-border">
            <div className="flex items-center justify-between">
              <span className="text-sm text-chainlink-text-muted">Resolved</span>
              <span className={`text-sm font-bold ${market.resolvedOutcome === 'YES' ? 'text-green-400' : 'text-red-400'}`}>
                {market.resolvedOutcome}
              </span>
            </div>
          </div>
        )}
      </div>
    </Link>
  );
}
