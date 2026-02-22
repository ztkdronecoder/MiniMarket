'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import type { Market, PriceHistoryPoint } from '@/lib/types';
import { formatDistanceToNow, shortenAddress } from '@/lib/utils';
import { getPriceHistory } from '@/lib/marketApi';
import { PriceChart } from './PriceChart';

interface MarketDetailProps {
  market: Market;
}

export function MarketDetail({ market }: MarketDetailProps) {
  const [priceHistory, setPriceHistory] = useState<PriceHistoryPoint[]>([]);
  
  useEffect(() => {
    if (market.phase !== 'INFO_COLLECTION') {
      getPriceHistory(market.id).then(setPriceHistory);
    }
  }, [market.id, market.phase]);

  const showPercentages = market.phase !== 'INFO_COLLECTION';
  const yesPercentage = showPercentages ? market.priceYes * 100 : null;

  const phaseConfig = {
    INFO_COLLECTION: { 
      badge: 'badge-info', 
      label: 'Info Collection',
      description: 'Agents are submitting encrypted predictions. Decryption pending.',
    },
    TRADING: { 
      badge: 'badge-trading', 
      label: 'Trading Active',
      description: 'Predictions revealed. Agents can trade shares on the AMM.',
    },
    RESOLVED: { 
      badge: 'badge-resolved', 
      label: 'Resolved',
      description: 'Market resolved. Winners can claim their payouts.',
    },
  };

  const config = phaseConfig[market.phase];

  return (
    <div className="min-h-screen">
      <div className="border-b border-chainlink-border/50 bg-chainlink-surface/80 backdrop-blur-lg sticky top-0 z-10">
        <div className="container mx-auto px-4 py-4">
          <Link href="/" className="btn-ghost inline-flex items-center gap-2 text-sm">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
            Back to Markets
          </Link>
        </div>
      </div>

      <div className="container mx-auto px-4 py-8">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          <div className="lg:col-span-2 space-y-6">
            <div className="card-glow">
              <div className="flex items-start justify-between mb-4">
                <div className={`badge ${config.badge} gap-1.5`}>
                  {config.label}
                </div>
                <div className="text-xs text-chainlink-text-muted font-mono bg-chainlink-surface px-2 py-1 rounded">
                  Market #{market.id}
                </div>
              </div>

              <h1 className="text-2xl md:text-3xl font-bold mb-3 leading-tight">
                {market.question}
              </h1>
              
              <p className="text-chainlink-text-muted mb-6">{config.description}</p>

              {showPercentages && yesPercentage !== null ? (
                <div className="mb-8">
                  <div className="flex justify-between items-center mb-3">
                    <span className="text-green-400 font-bold text-lg">YES {yesPercentage.toFixed(1)}%</span>
                    <span className="text-red-400 font-bold text-lg">{(100 - yesPercentage).toFixed(1)}% NO</span>
                  </div>
                  <div className="progress-bar h-3">
                    <div
                      className="progress-fill bg-gradient-to-r from-green-500 to-emerald-400"
                      style={{ width: `${yesPercentage}%` }}
                    />
                  </div>
                </div>
              ) : (
                <div className="mb-8">
                  <div className="flex items-center justify-center gap-3 py-4 bg-chainlink-surface/50 rounded-xl border border-chainlink-border/30">
                    <svg className="w-5 h-5 text-chainlink-accent animate-pulse" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                    </svg>
                    <span className="text-chainlink-text-muted font-medium">Predictions Encrypted Until Drand Round</span>
                  </div>
                </div>
              )}

              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <div className="bg-chainlink-surface rounded-xl p-3">
                  <div className="stat-label mb-1">Participants</div>
                  <div className="text-xl font-bold font-mono">{market.participants}</div>
                </div>
                <div className="bg-chainlink-surface rounded-xl p-3">
                  <div className="stat-label mb-1">Total Staked</div>
                  <div className="text-xl font-bold font-mono">{market.totalStaked}</div>
                </div>
                <div className="bg-chainlink-surface rounded-xl p-3">
                  <div className="stat-label mb-1">Ticket Cost</div>
                  <div className="text-xl font-bold font-mono">{market.ticketCost}</div>
                </div>
                <div className="bg-chainlink-surface rounded-xl p-3">
                  <div className="stat-label mb-1">Trading Ends</div>
                  <div className="text-xl font-bold font-mono text-chainlink-accent">
                    {formatDistanceToNow(market.tradingEndsAt)}
                  </div>
                </div>
              </div>
            </div>

            {market.phase === 'INFO_COLLECTION' && (
              <div className="card-glow bg-gradient-to-br from-chainlink-blue/5 to-transparent border-chainlink-blue/20">
                <div className="flex items-start gap-4">
                  <div className="w-12 h-12 rounded-xl bg-chainlink-blue/20 flex items-center justify-center flex-shrink-0">
                    <svg className="w-6 h-6 text-chainlink-accent" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                    </svg>
                  </div>
                  <div className="flex-grow">
                    <h3 className="font-semibold text-lg mb-2">Timelock Encryption Active</h3>
                    <p className="text-chainlink-text-muted text-sm mb-4">
                      Predictions are encrypted using drand timelock encryption. The decryption key will automatically become available when the target round is reached.
                    </p>
                    <div className="grid grid-cols-2 gap-4">
                      <div className="bg-chainlink-surface/50 rounded-lg p-3">
                        <div className="text-xs text-chainlink-text-muted mb-1">Target Round</div>
                        <div className="font-mono font-semibold">{market.drandTargetRound.toString()}</div>
                      </div>
                      <div className="bg-chainlink-surface/50 rounded-lg p-3">
                        <div className="text-xs text-chainlink-text-muted mb-1">Decrypts In</div>
                        <div className="font-mono font-semibold text-chainlink-accent">
                          {formatDistanceToNow(market.decryptAt)}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {market.phase === 'TRADING' && market.consensusOutcome && (
              <div className="card-glow bg-gradient-to-br from-green-500/5 to-transparent border-green-500/20">
                <div className="flex items-start gap-4">
                  <div className="w-12 h-12 rounded-xl bg-green-500/20 flex items-center justify-center flex-shrink-0">
                    <svg className="w-6 h-6 text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                  </div>
                  <div>
                    <h3 className="font-semibold text-lg mb-2">Agent Consensus Revealed</h3>
                    <p className="text-chainlink-text-muted text-sm mb-3">
                      Encrypted predictions have been decrypted and validated by Chainlink CRE.
                    </p>
                    <div className="inline-flex items-center gap-2 bg-chainlink-surface rounded-lg px-4 py-2">
                      <span className="text-chainlink-text-muted text-sm">Consensus:</span>
                      <span className={`text-lg font-bold ${market.consensusOutcome === 'YES' ? 'text-green-400' : 'text-red-400'}`}>
                        {market.consensusOutcome}
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {market.phase === 'RESOLVED' && market.resolvedOutcome && (
              <div className="card-glow bg-gradient-to-br from-purple-500/5 to-transparent border-purple-500/20">
                <div className="flex items-start gap-4">
                  <div className="w-12 h-12 rounded-xl bg-purple-500/20 flex items-center justify-center flex-shrink-0">
                    <svg className="w-6 h-6 text-purple-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M5 3v4M3 5h4M6 17v4m-2-2h4m5-16l2.286 6.857L21 12l-5.714 2.143L13 21l-2.286-6.857L5 12l5.714-2.143L13 3z" />
                    </svg>
                  </div>
                  <div>
                    <h3 className="font-semibold text-lg mb-2">Market Resolved</h3>
                    <p className="text-chainlink-text-muted text-sm mb-3">
                      This market has been resolved. Winners can claim their payouts.
                    </p>
                    <div className="inline-flex items-center gap-2 bg-chainlink-surface rounded-lg px-4 py-2">
                      <span className="text-chainlink-text-muted text-sm">Final Outcome:</span>
                      <span className={`text-lg font-bold ${market.resolvedOutcome === 'YES' ? 'text-green-400' : 'text-red-400'}`}>
                        {market.resolvedOutcome}
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            )}

            <div className="card-flat">
              <h3 className="section-title text-base">Market Lifecycle</h3>
              <div className="space-y-3">
                {[
                  { step: 1, title: 'Encrypted Submission', desc: 'AI agents encrypt predictions with drand timelock' },
                  { step: 2, title: 'Automated Reveal', desc: 'Chainlink CRE decrypts and computes consensus' },
                  { step: 3, title: 'Trading Phase', desc: 'Participants trade shares on the AMM' },
                  { step: 4, title: 'Resolution', desc: 'Winners claim payouts based on outcome' },
                ].map((item) => (
                  <div key={item.step} className="flex items-start gap-3">
                    <div className="w-6 h-6 rounded-full bg-chainlink-blue/20 flex items-center justify-center text-chainlink-accent text-xs font-bold flex-shrink-0">
                      {item.step}
                    </div>
                    <div>
                      <div className="font-medium text-sm">{item.title}</div>
                      <div className="text-xs text-chainlink-text-muted">{item.desc}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {priceHistory.length > 0 && (
              <PriceChart data={priceHistory} height={180} />
            )}
          </div>

          <div className="space-y-6">
            <div className="card-glow">
              <h3 className="section-title text-base mb-4">Actions</h3>

              {market.phase === 'INFO_COLLECTION' && (
                <div className="space-y-3">
                  <button className="btn-primary w-full justify-center">
                    <svg className="w-4 h-4 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                    </svg>
                    Submit Encrypted Prediction
                  </button>
                  <p className="text-xs text-chainlink-text-muted text-center">
                    Your prediction will be encrypted using drand timelock
                  </p>
                </div>
              )}

              {market.phase === 'TRADING' && (
                <div className="space-y-3">
                  <button className="btn-primary w-full justify-center">
                    <svg className="w-4 h-4 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" />
                    </svg>
                    Swap YES → NO
                  </button>
                  <button className="btn-secondary w-full justify-center">
                    <svg className="w-4 h-4 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" />
                    </svg>
                    Swap NO → YES
                  </button>
                  <p className="text-xs text-chainlink-text-muted text-center">
                    Trade shares using the constant sum AMM
                  </p>
                </div>
              )}

              {market.phase === 'RESOLVED' && (
                <div className="space-y-3">
                  <button className="btn-primary w-full justify-center">
                    <svg className="w-4 h-4 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    Claim Payout
                  </button>
                  <p className="text-xs text-chainlink-text-muted text-center">
                    Claim your winnings if you predicted correctly
                  </p>
                </div>
              )}
            </div>

            <div className="card-flat">
              <h3 className="section-title text-base mb-4">Technical Details</h3>
              <div className="space-y-3 text-sm">
                <div className="flex justify-between items-center py-2 border-b border-chainlink-border/30">
                  <span className="text-chainlink-text-muted">Payment Token</span>
                  <span className="font-mono text-xs">{market.paymentToken}</span>
                </div>
                <div className="flex justify-between items-center py-2 border-b border-chainlink-border/30">
                  <span className="text-chainlink-text-muted">Drand Round</span>
                  <span className="font-mono text-xs">{market.drandTargetRound.toString()}</span>
                </div>
                <div className="flex justify-between items-center py-2 border-b border-chainlink-border/30">
                  <span className="text-chainlink-text-muted">Network</span>
                  <span className="font-mono text-xs">quicknet (3s)</span>
                </div>
                <div className="flex justify-between items-center py-2">
                  <span className="text-chainlink-text-muted">Decrypt At</span>
                  <span className="font-mono text-xs text-chainlink-accent">
                    {formatDistanceToNow(market.decryptAt)}
                  </span>
                </div>
              </div>
            </div>

            <div className="card-flat bg-gradient-to-br from-chainlink-blue/5 to-chainlink-accent/5 border-chainlink-accent/20">
              <div className="flex items-center gap-3 mb-3">
                <div className="w-10 h-10 rounded-lg bg-chainlink-blue/20 flex items-center justify-center">
                  <svg className="w-5 h-5 text-chainlink-accent" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                  </svg>
                </div>
                <div>
                  <div className="font-semibold text-sm">Agent-Driven Market</div>
                  <div className="text-xs text-chainlink-text-muted">Humans navigate, Agents predict</div>
                </div>
              </div>
              <p className="text-xs text-chainlink-text-muted leading-relaxed">
                This market is powered by AI agents using drand timelock encryption for privacy-preserving predictions.
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
