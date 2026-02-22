'use client';

import Link from 'next/link';
import type { Market } from '@/lib/types';
import { formatDistanceToNow } from '@/lib/utils';

interface MarketCardProps {
  market: Market;
}

export function MarketCard({ market }: MarketCardProps) {
  const phaseConfig = {
    INFO_COLLECTION: { 
      badge: 'badge-info', 
      label: 'Info Phase',
      icon: (
        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
        </svg>
      ),
    },
    TRADING: { 
      badge: 'badge-trading', 
      label: 'Trading',
      icon: (
        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
        </svg>
      ),
    },
    RESOLVED: { 
      badge: 'badge-resolved', 
      label: 'Resolved',
      icon: (
        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
        </svg>
      ),
    },
  };

  const config = phaseConfig[market.phase];
  const showPercentages = market.phase !== 'INFO_COLLECTION';
  const yesPercentage = showPercentages ? market.priceYes * 100 : null;

  return (
    <Link href={`/market/${market.id}`} className="block group">
      <div className="card-glow h-full flex flex-col transition-all duration-300">
        <div className="flex items-start justify-between mb-4">
          <div className={`badge ${config.badge} gap-1.5`}>
            {config.icon}
            {config.label}
          </div>
          <div className="text-xs text-chainlink-text-muted font-mono bg-chainlink-surface px-2 py-0.5 rounded">
            #{market.id}
          </div>
        </div>

        <h3 className="text-base font-semibold mb-4 line-clamp-2 flex-grow group-hover:text-chainlink-accent transition-colors">
          {market.question}
        </h3>

        {showPercentages && yesPercentage !== null ? (
          <div className="mb-4">
            <div className="flex justify-between text-sm mb-2 font-medium">
              <span className="text-green-400">YES {yesPercentage.toFixed(1)}%</span>
              <span className="text-red-400">{(100 - yesPercentage).toFixed(1)}% NO</span>
            </div>
            <div className="progress-bar">
              <div
                className="progress-fill bg-gradient-to-r from-green-500 to-emerald-400"
                style={{ width: `${yesPercentage}%` }}
              />
            </div>
          </div>
        ) : (
          <div className="mb-4">
            <div className="flex items-center justify-center gap-2 py-3 bg-chainlink-surface/50 rounded-lg border border-chainlink-border/30">
              <svg className="w-4 h-4 text-chainlink-accent animate-pulse" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
              </svg>
              <span className="text-chainlink-text-muted text-sm font-medium">Predictions Encrypted</span>
            </div>
          </div>
        )}

        <div className="grid grid-cols-2 gap-3 text-sm mb-4">
          <div className="bg-chainlink-surface rounded-lg p-2.5">
            <div className="text-xs text-chainlink-text-muted mb-0.5">Participants</div>
            <div className="font-mono font-semibold">{market.participants}</div>
          </div>
          <div className="bg-chainlink-surface rounded-lg p-2.5">
            <div className="text-xs text-chainlink-text-muted mb-0.5">Total Staked</div>
            <div className="font-mono font-semibold">{market.totalStaked}</div>
          </div>
        </div>

        {market.phase === 'INFO_COLLECTION' && (
          <div className="pt-3 border-t border-chainlink-border/50">
            <div className="flex items-center justify-between text-sm">
              <span className="text-chainlink-text-muted flex items-center gap-1.5">
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                Decrypts in
              </span>
              <span className="font-mono text-chainlink-accent font-medium">
                {formatDistanceToNow(market.decryptAt)}
              </span>
            </div>
          </div>
        )}

        {market.phase === 'TRADING' && market.consensusOutcome && (
          <div className="pt-3 border-t border-chainlink-border/50">
            <div className="flex items-center justify-between text-sm">
              <span className="text-chainlink-text-muted">Agent Consensus</span>
              <span className={`font-bold ${market.consensusOutcome === 'YES' ? 'text-green-400' : 'text-red-400'}`}>
                {market.consensusOutcome}
              </span>
            </div>
          </div>
        )}

        {market.phase === 'RESOLVED' && market.resolvedOutcome && (
          <div className="pt-3 border-t border-chainlink-border/50">
            <div className="flex items-center justify-between text-sm">
              <span className="text-chainlink-text-muted">Final Outcome</span>
              <span className={`font-bold ${market.resolvedOutcome === 'YES' ? 'text-green-400' : 'text-red-400'}`}>
                {market.resolvedOutcome}
              </span>
            </div>
          </div>
        )}
      </div>
    </Link>
  );
}
