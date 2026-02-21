'use client';

import Link from 'next/link';
import type { Market } from '@/lib/types';
import { formatDistanceToNow, shortenAddress } from '@/lib/utils';

interface MarketDetailProps {
  market: Market;
}

export function MarketDetail({ market }: MarketDetailProps) {
  const yesPercentage = market.priceYes * 100;
  const noPercentage = market.priceNo * 100;

  const phaseColors = {
    INFO_COLLECTION: 'badge-info',
    TRADING: 'badge-trading',
    RESOLVED: 'badge-resolved',
  };

  const phaseLabels = {
    INFO_COLLECTION: 'Info Collection Phase',
    TRADING: 'Trading Phase',
    RESOLVED: 'Resolved',
  };

  return (
    <div className="container mx-auto px-4 py-8">
      <Link href="/" className="inline-flex items-center gap-2 text-chainlink-text-muted hover:text-white mb-8 transition-colors">
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
        </svg>
        Back to Markets
      </Link>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="lg:col-span-2">
          <div className="card-glow mb-6">
            <div className="flex items-start justify-between mb-6">
              <div className={`badge ${phaseColors[market.phase]}`}>
                {phaseLabels[market.phase]}
              </div>
              <div className="text-sm text-chainlink-text-muted font-mono">
                Market #{market.id}
              </div>
            </div>

            <h1 className="text-2xl md:text-3xl font-bold mb-6">
              {market.question}
            </h1>

            <div className="mb-8">
              <div className="flex justify-between text-sm mb-3">
                <span className="text-green-400 font-semibold">YES {yesPercentage.toFixed(1)}%</span>
                <span className="text-red-400 font-semibold">NO {noPercentage.toFixed(1)}%</span>
              </div>
              <div className="progress-bar h-3">
                <div
                  className="progress-fill bg-gradient-to-r from-green-500 to-green-400"
                  style={{ width: `${yesPercentage}%` }}
                />
              </div>
            </div>

            {market.phase === 'INFO_COLLECTION' && (
              <div className="bg-chainlink-blue/10 border border-chainlink-blue/30 rounded-lg p-4 mb-6">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-chainlink-blue/20 flex items-center justify-center">
                    <svg className="w-5 h-5 text-chainlink-accent" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                    </svg>
                  </div>
                  <div>
                    <div className="font-semibold text-white">Encrypted Submissions</div>
                    <div className="text-sm text-chainlink-text-muted">
                      Predictions are encrypted with drand timelock. Decrypts in{' '}
                      <span className="text-chainlink-accent font-mono">
                        {formatDistanceToNow(market.decryptAt)}
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {market.phase === 'TRADING' && market.consensusOutcome && (
              <div className="bg-green-500/10 border border-green-500/30 rounded-lg p-4 mb-6">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-green-500/20 flex items-center justify-center">
                    <svg className="w-5 h-5 text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                  </div>
                  <div>
                    <div className="font-semibold text-white">Consensus: {market.consensusOutcome}</div>
                    <div className="text-sm text-chainlink-text-muted">
                      Trading is active. Swap shares based on your prediction.
                    </div>
                  </div>
                </div>
              </div>
            )}

            {market.phase === 'RESOLVED' && market.resolvedOutcome && (
              <div className="bg-purple-500/10 border border-purple-500/30 rounded-lg p-4 mb-6">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-purple-500/20 flex items-center justify-center">
                    <svg className="w-5 h-5 text-purple-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                  </div>
                  <div>
                    <div className="font-semibold text-white">Resolved: {market.resolvedOutcome}</div>
                    <div className="text-sm text-chainlink-text-muted">
                      Winners can claim their payout.
                    </div>
                  </div>
                </div>
              </div>
            )}

            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div className="bg-chainlink-surface rounded-lg p-4">
                <div className="stat-label mb-1">Participants</div>
                <div className="stat-value text-xl">{market.participants}</div>
              </div>
              <div className="bg-chainlink-surface rounded-lg p-4">
                <div className="stat-label mb-1">Total Staked</div>
                <div className="stat-value text-xl">{market.totalStaked}</div>
              </div>
              <div className="bg-chainlink-surface rounded-lg p-4">
                <div className="stat-label mb-1">Ticket Cost</div>
                <div className="stat-value text-xl">{market.ticketCost}</div>
              </div>
              <div className="bg-chainlink-surface rounded-lg p-4">
                <div className="stat-label mb-1">Trading Ends</div>
                <div className="stat-value text-xl text-chainlink-accent">
                  {formatDistanceToNow(market.tradingEndsAt)}
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="lg:col-span-1">
          <div className="card-glow mb-6">
            <h3 className="text-lg font-semibold mb-4">Actions</h3>

            {market.phase === 'INFO_COLLECTION' && (
              <div className="space-y-3">
                <button className="btn-primary w-full">
                  Submit Encrypted Prediction
                </button>
                <p className="text-sm text-chainlink-text-muted text-center">
                  Your prediction will be encrypted using drand timelock
                </p>
              </div>
            )}

            {market.phase === 'TRADING' && (
              <div className="space-y-3">
                <button className="btn-primary w-full">
                  Swap YES → NO
                </button>
                <button className="btn-secondary w-full">
                  Swap NO → YES
                </button>
                <p className="text-sm text-chainlink-text-muted text-center">
                  Trade shares using the constant sum AMM
                </p>
              </div>
            )}

            {market.phase === 'RESOLVED' && (
              <div className="space-y-3">
                <button className="btn-primary w-full">
                  Claim Payout
                </button>
                <p className="text-sm text-chainlink-text-muted text-center">
                  Claim your winnings if you predicted correctly
                </p>
              </div>
            )}
          </div>

          <div className="card">
            <h3 className="text-lg font-semibold mb-4">Market Info</h3>
            <div className="space-y-3 text-sm">
              <div className="flex justify-between">
                <span className="text-chainlink-text-muted">Payment Token</span>
                <span className="font-mono">{market.paymentToken}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-chainlink-text-muted">Drand Round</span>
                <span className="font-mono">{market.drandTargetRound.toString()}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-chainlink-text-muted">Decrypt At</span>
                <span className="font-mono">{formatDistanceToNow(market.decryptAt)}</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
