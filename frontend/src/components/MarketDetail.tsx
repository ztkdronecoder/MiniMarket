'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import type { Market, PriceHistoryPoint } from '@/lib/types';
import { formatDistanceToNow, formatDateTime } from '@/lib/utils';
import { getPriceHistory, getAgentMarketStatus } from '@/lib/marketApi';
import { CandlestickChart } from './CandlestickChart';
import { useWallet } from '@/hooks/useWallet';

interface MarketDetailProps {
  market: Market;
}

export function MarketDetail({ market }: MarketDetailProps) {
  const [priceHistory, setPriceHistory] = useState<PriceHistoryPoint[]>([]);
  const [bucketMin, setBucketMin] = useState(15);
  const [agentStatus, setAgentStatus] = useState<{ participated: boolean; hasClaimed: boolean } | null>(null);
  const { isConnected, connect, address } = useWallet();

  useEffect(() => {
    if (market.phase !== 'INFO_COLLECTION') {
      getPriceHistory(market.id).then(setPriceHistory);
    }
  }, [market.id, market.phase]);

  useEffect(() => {
    if (market.phase === 'RESOLVED' && isConnected && address) {
      getAgentMarketStatus(market.id, address).then(setAgentStatus);
    } else {
      setAgentStatus(null);
    }
  }, [market.id, market.phase, isConnected, address]);

  const showChart = market.phase !== 'INFO_COLLECTION';
  const yesPercent = showChart ? market.priceYes * 100 : null;

  const phaseInfo = {
    INFO_COLLECTION: {
      badgeClass: 'badge-infomarket',
      label: 'InfoMarket',
      description: 'Encrypted predictions are being collected. Decryption pending via drand timelock.',
    },
    TRADING: {
      badgeClass: 'badge-trading',
      label: 'Prediction Market — Trading Live',
      description: 'Agent predictions revealed. Trade YES/NO shares on the orderbook.',
    },
    RESOLVED: {
      badgeClass: 'badge-resolved',
      label: 'Resolved',
      description: 'Market resolved. Winners can claim their payouts.',
    },
  };

  const pi = phaseInfo[market.phase];

  return (
    <div className="min-h-screen ambient-bg">
      {/* Sticky back bar */}
      <div className="border-b sticky top-0 z-10"
        style={{
          background: 'rgba(10,14,23,0.85)',
          borderColor: 'rgba(33,41,58,0.6)',
          backdropFilter: 'blur(16px)',
        }}>
        <div className="container mx-auto px-4 py-3 flex items-center justify-between">
          <Link href="/" className="btn-ghost text-sm gap-2">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
            Markets
          </Link>
          <div className="text-xs font-mono" style={{ color: 'var(--text-muted)' }}>Market #{market.id}</div>
        </div>
      </div>

      <div className="container mx-auto px-4 py-8">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          {/* Main column */}
          <div className="lg:col-span-2 space-y-6">
            {/* Header card */}
            <div className="card-glow">
              <div className="flex items-start justify-between mb-4">
                <span className={pi.badgeClass}>{pi.label}</span>
                <div className="text-xs font-mono px-2 py-0.5 rounded"
                  style={{ background: 'rgba(255,255,255,0.04)', color: 'var(--text-muted)' }}>
                  #{market.id}
                </div>
              </div>

              <h1 className="text-xl md:text-2xl font-bold text-white mb-3 leading-snug">
                {market.question}
              </h1>
              <p className="text-sm mb-6" style={{ color: 'var(--text-muted)' }}>{pi.description}</p>

              {/* Price bar or encrypted indicator */}
              {showChart && yesPercent !== null ? (
                <div className="mb-6">
                  <div className="flex justify-between items-center mb-2">
                    <span className="font-bold text-lg" style={{ color: '#34D399' }}>
                      YES {yesPercent.toFixed(1)}%
                    </span>
                    <span className="font-bold text-lg" style={{ color: '#F87171' }}>
                      {(100 - yesPercent).toFixed(1)}% NO
                    </span>
                  </div>
                  <div className="progress-bar" style={{ height: '8px' }}>
                    <div className="progress-fill-yes" style={{ width: `${yesPercent}%` }} />
                  </div>
                </div>
              ) : (
                <div className="mb-6 flex items-center justify-center gap-3 py-5 rounded-xl"
                  style={{ background: 'rgba(124,58,237,0.06)', border: '1px solid rgba(124,58,237,0.12)' }}>
                  <svg className="w-5 h-5 animate-pulse" style={{ color: '#B78BFF' }} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                  </svg>
                  <div>
                    <div className="text-sm font-medium" style={{ color: '#B78BFF' }}>Predictions Encrypted</div>
                    <div className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>
                      Decrypts at drand round {market.drandTargetRound.toString()}
                    </div>
                  </div>
                </div>
              )}

              {/* Stats grid */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                {[
                  { label: 'Participants', value: market.participants.toString() },
                  { label: 'Total Staked', value: market.totalStaked },
                  { label: 'Ticket Cost', value: market.ticketCost },
                  market.phase === 'INFO_COLLECTION'
                    ? { label: 'Decrypts In', value: formatDistanceToNow(market.decryptAt), accent: true }
                    : market.phase === 'TRADING'
                    ? { label: 'Trading Ends', value: formatDistanceToNow(market.tradingEndsAt), accent: true }
                    : { label: 'Created', value: formatDateTime(market.createdAt), accent: false },
                ].map((s) => (
                  <div key={s.label} className="rounded-xl p-3"
                    style={{ background: 'rgba(255,255,255,0.03)' }}>
                    <div className="stat-label mb-1">{s.label}</div>
                    <div className="text-base font-bold font-mono"
                      style={{ color: s.accent ? '#60A5FA' : 'white' }}>
                      {s.value}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* InfoMarket — drand info */}
            {market.phase === 'INFO_COLLECTION' && (
              <div className="card-glow" style={{
                background: 'linear-gradient(135deg, rgba(22,27,34,0.9), rgba(30,20,60,0.4))',
                borderColor: 'rgba(124,58,237,0.15)',
              }}>
                <div className="flex items-start gap-4">
                  <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"
                    style={{ background: 'rgba(124,58,237,0.15)' }}>
                    <svg className="w-5 h-5" style={{ color: '#B78BFF' }} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                    </svg>
                  </div>
                  <div className="flex-1">
                    <h3 className="font-semibold text-white mb-1">Timelock Encryption Active</h3>
                    <p className="text-xs mb-4" style={{ color: 'var(--text-muted)' }}>
                      Predictions are sealed using drand quicknet timelock encryption.
                      The key becomes available when the target round is published on the drand beacon chain.
                    </p>
                    <div className="grid grid-cols-2 gap-3">
                      <div className="rounded-lg p-3" style={{ background: 'rgba(255,255,255,0.03)' }}>
                        <div className="stat-label mb-1">Drand Round</div>
                        <div className="font-mono font-bold text-sm text-white">{market.drandTargetRound.toString()}</div>
                      </div>
                      <div className="rounded-lg p-3" style={{ background: 'rgba(255,255,255,0.03)' }}>
                        <div className="stat-label mb-1">Decrypts In</div>
                        <div className="font-mono font-bold text-sm" style={{ color: '#B78BFF' }}>
                          {formatDistanceToNow(market.decryptAt)}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Market Timeline */}
            {(() => {
              const phase1End = market.decryptAt;
              const phase2End = market.tradingEndsAt;
              const now = new Date();
              const phase1Done = now > phase1End;
              const phase2Done = now > phase2End;
              return (
                <div className="card-flat">
                  <h3 className="section-title text-sm">Market Timeline</h3>
                  <div className="space-y-3">
                    {/* Phase 1 */}
                    <div className="flex items-start gap-3">
                      <div className="w-2 h-2 rounded-full mt-1.5 flex-shrink-0"
                        style={{ background: phase1Done ? '#34D399' : '#60A5FA' }} />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-0.5">
                          <span className="text-xs font-semibold text-white">Phase 1 · Info Collection</span>
                          {phase1Done && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded"
                              style={{ background: 'rgba(52,211,153,0.1)', color: '#34D399' }}>done</span>
                          )}
                        </div>
                        <div className="text-xs font-mono" style={{ color: 'var(--text-muted)' }}>
                          {formatDateTime(market.createdAt)} → {formatDateTime(phase1End)}
                        </div>
                      </div>
                    </div>
                    {/* Phase 2 */}
                    <div className="flex items-start gap-3">
                      <div className="w-2 h-2 rounded-full mt-1.5 flex-shrink-0"
                        style={{ background: phase2Done ? '#34D399' : phase1Done ? '#60A5FA' : 'rgba(255,255,255,0.15)' }} />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-0.5">
                          <span className="text-xs font-semibold"
                            style={{ color: phase1Done ? 'white' : 'rgba(255,255,255,0.4)' }}>
                            Phase 2 · Prediction Market
                          </span>
                          {phase2Done && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded"
                              style={{ background: 'rgba(52,211,153,0.1)', color: '#34D399' }}>done</span>
                          )}
                        </div>
                        <div className="text-xs font-mono" style={{ color: 'var(--text-muted)' }}>
                          {formatDateTime(phase1End)} → {formatDateTime(phase2End)}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })()}

            {/* Trading/Resolved — consensus/outcome banner */}
            {market.phase === 'TRADING' && market.consensusOutcome && (
              <div className="card-glow" style={{
                background: 'linear-gradient(135deg, rgba(22,27,34,0.9), rgba(10,30,25,0.4))',
                borderColor: 'rgba(16,185,129,0.15)',
              }}>
                <div className="flex items-center gap-4">
                  <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"
                    style={{ background: 'rgba(16,185,129,0.12)' }}>
                    <svg className="w-5 h-5 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                  </div>
                  <div className="flex-1">
                    <h3 className="font-semibold text-white mb-1">Agent Consensus Revealed</h3>
                    <p className="text-xs mb-3" style={{ color: 'var(--text-muted)' }}>
                      Encrypted predictions decrypted and validated by Chainlink CRE.
                    </p>
                    <div className="inline-flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm"
                      style={{ background: 'rgba(255,255,255,0.04)' }}>
                      <span style={{ color: 'var(--text-muted)' }}>Consensus:</span>
                      <span className="font-bold"
                        style={{ color: market.consensusOutcome === 'YES' ? '#34D399' : '#F87171' }}>
                        {market.consensusOutcome}
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {market.phase === 'RESOLVED' && market.resolvedOutcome && (
              <div className="card-glow" style={{
                background: 'linear-gradient(135deg, rgba(22,27,34,0.9), rgba(30,10,50,0.3))',
                borderColor: 'rgba(167,139,250,0.15)',
              }}>
                <div className="flex items-center gap-4">
                  <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"
                    style={{ background: 'rgba(167,139,250,0.12)' }}>
                    <svg className="w-5 h-5" style={{ color: '#A78BFA' }} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M5 3v4M3 5h4M6 17v4m-2-2h4m5-16l2.286 6.857L21 12l-5.714 2.143L13 21l-2.286-6.857L5 12l5.714-2.143L13 3z" />
                    </svg>
                  </div>
                  <div>
                    <h3 className="font-semibold text-white mb-1">Market Resolved</h3>
                    <div className="inline-flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm"
                      style={{ background: 'rgba(255,255,255,0.04)' }}>
                      <span style={{ color: 'var(--text-muted)' }}>Final outcome:</span>
                      <span className="font-bold"
                        style={{ color: market.resolvedOutcome === 'YES' ? '#34D399' : '#F87171' }}>
                        {market.resolvedOutcome}
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Chart */}
            {showChart && (
              <div>
                <div className="flex items-center justify-between mb-3">
                  <h3 className="section-title text-sm mb-0">Price History</h3>
                  {priceHistory.length > 0 && (
                    <div className="flex items-center gap-1 p-0.5 rounded-lg"
                      style={{ background: 'rgba(13,17,23,0.8)', border: '1px solid var(--border)' }}>
                      {([5, 15, 60] as const).map((m) => (
                        <button key={m} onClick={() => setBucketMin(m)}
                          className="px-2.5 py-1 rounded text-xs font-medium transition-all duration-100"
                          style={bucketMin === m ? {
                            background: 'rgba(42,90,218,0.2)', color: '#60A5FA',
                          } : { color: 'var(--text-muted)' }}>
                          {m}m
                        </button>
                      ))}
                    </div>
                  )}
                </div>
                {priceHistory.length > 0 ? (
                  <CandlestickChart
                    data={priceHistory}
                    height={220}
                    bucketMinutes={bucketMin}
                    startTime={priceHistory[0].timestamp}
                    endTime={Math.floor(
                      Math.min(market.tradingEndsAt.getTime(), Date.now()) / 1000
                    )}
                  />
                ) : (
                  <div className="rounded-xl flex items-center justify-center py-10 text-sm"
                    style={{ background: 'rgba(13,17,23,0.6)', border: '1px solid var(--border)', color: 'var(--text-muted)' }}>
                    No trading activity yet
                  </div>
                )}
              </div>
            )}

            {/* Lifecycle */}
            <div className="card-flat">
              <h3 className="section-title text-sm">Market Lifecycle</h3>
              <div className="space-y-3">
                {[
                  { step: 1, title: 'Encrypted Submission (InfoMarket)', desc: 'AI agents encrypt predictions with drand timelock', done: true },
                  { step: 2, title: 'Automated Reveal', desc: 'Chainlink CRE decrypts and computes consensus', done: market.phase !== 'INFO_COLLECTION' },
                  { step: 3, title: 'Trading Phase (PredictionMarket)', desc: 'Participants trade shares on the AMM orderbook', done: market.phase === 'RESOLVED' },
                  { step: 4, title: 'Resolution & Penalty', desc: 'Winners claim payouts; wrong predictors are penalized', done: market.phase === 'RESOLVED' && !!market.resolvedOutcome },
                ].map((item) => (
                  <div key={item.step} className="flex items-start gap-3">
                    <div className="w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold flex-shrink-0"
                      style={{
                        background: item.done ? 'rgba(16,185,129,0.15)' : 'rgba(42,90,218,0.1)',
                        color: item.done ? '#34D399' : '#60A5FA',
                      }}>
                      {item.done ? '✓' : item.step}
                    </div>
                    <div>
                      <div className="font-medium text-sm" style={{ color: item.done ? 'white' : 'rgba(255,255,255,0.5)' }}>
                        {item.title}
                      </div>
                      <div className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>{item.desc}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
            {/* Resolution Schema */}
            {market.schema && (() => {
              let parsed: Record<string, unknown> = {};
              try { parsed = JSON.parse(market.schema); } catch { /* raw */ }
              const flat: Array<{ key: string; value: string }> = [];
              const flatten = (obj: Record<string, unknown>, prefix = '') => {
                for (const [k, v] of Object.entries(obj)) {
                  const key = prefix ? `${prefix}.${k}` : k;
                  if (v !== null && typeof v === 'object' && !Array.isArray(v)) {
                    flatten(v as Record<string, unknown>, key);
                  } else {
                    flat.push({ key, value: String(v ?? '') });
                  }
                }
              };
              flatten(parsed);
              return (
                <div className="card-flat">
                  <h3 className="section-title text-sm">Resolution Schema</h3>
                  <div className="rounded-lg overflow-hidden" style={{ background: 'rgba(13,17,23,0.8)', border: '1px solid var(--border)' }}>
                    {flat.length > 0 ? flat.map(({ key, value }) => (
                      <div key={key} className="flex items-start gap-2 px-3 py-1.5 border-b last:border-b-0"
                        style={{ borderColor: 'rgba(255,255,255,0.04)' }}>
                        <span className="font-mono text-xs flex-shrink-0 pt-px" style={{ color: '#7DD3FC', minWidth: '7rem' }}>{key}</span>
                        <span className="font-mono text-xs break-all" style={{ color: 'rgba(255,255,255,0.7)' }}>
                          {value || <span style={{ color: 'var(--text-muted)' }}>(empty)</span>}
                        </span>
                      </div>
                    )) : (
                      <pre className="p-3 text-xs overflow-auto" style={{ color: 'rgba(255,255,255,0.7)' }}>
                        {market.schema}
                      </pre>
                    )}
                  </div>
                </div>
              );
            })()}
          </div>

          {/* Sidebar */}
          <div className="space-y-5">
            {/* Actions */}
            <div className="card-glow">
              <h3 className="section-title text-sm">Actions</h3>
              {!isConnected ? (
                <div className="text-center py-4">
                  <p className="text-xs mb-3" style={{ color: 'var(--text-muted)' }}>Connect wallet to interact</p>
                  <button onClick={connect} className="btn-primary w-full justify-center text-sm gap-2">
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 9V7a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2m2 4h10a2 2 0 002-2v-6a2 2 0 00-2-2H9a2 2 0 00-2 2v6a2 2 0 002 2zm7-5a2 2 0 11-4 0 2 2 0 014 0z" />
                    </svg>
                    Connect Wallet
                  </button>
                </div>
              ) : (
                <div className="space-y-2">
                  {market.phase === 'INFO_COLLECTION' && (
                    <>
                      <button className="btn-purple w-full justify-center text-sm gap-2">
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                        </svg>
                        Submit Encrypted Prediction
                      </button>
                      <p className="text-[10px] text-center" style={{ color: 'var(--text-muted)' }}>
                        Encrypted via drand timelock — no one can see your prediction until reveal
                      </p>
                    </>
                  )}
                  {market.phase === 'TRADING' && (
                    <>
                      <button className="btn-primary w-full justify-center text-sm gap-2">
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" />
                        </svg>
                        Swap YES → NO
                      </button>
                      <button className="btn-secondary w-full justify-center text-sm gap-2">
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" />
                        </svg>
                        Swap NO → YES
                      </button>
                    </>
                  )}
                  {market.phase === 'RESOLVED' && agentStatus?.participated && (
                    agentStatus.hasClaimed ? (
                      <div className="w-full text-center text-sm py-2 rounded-xl"
                        style={{ background: 'rgba(255,255,255,0.03)', color: 'var(--text-muted)' }}>
                        Payout already claimed
                      </div>
                    ) : (
                      <button className="btn-primary w-full justify-center text-sm gap-2">
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </svg>
                        Claim Payout
                      </button>
                    )
                  )}
                </div>
              )}
            </div>

            {/* Technical details */}
            <div className="card-flat">
              <h3 className="section-title text-sm">Technical Details</h3>
              <div className="space-y-0">
                {[
                  { label: 'Token', value: 'USDC (6 dec)' },
                  { label: 'Drand Network', value: 'quicknet (3s)' },
                  { label: 'Drand Round', value: market.drandTargetRound.toString() },
                  { label: 'Decrypts', value: formatDistanceToNow(market.decryptAt) },
                ].map((row) => (
                  <div key={row.label} className="data-row">
                    <span className="text-xs" style={{ color: 'var(--text-muted)' }}>{row.label}</span>
                    <span className="font-mono text-xs text-white">{row.value}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
