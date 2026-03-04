'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import type { Market, PriceHistoryPoint } from '@/lib/types';
import { formatDistanceToNow, formatDateTime } from '@/lib/utils';
import { getPriceHistory, getAgentMarketStatus, getMarketOrders, type OrderbookOrder } from '@/lib/marketApi';
import { CandlestickChart } from './CandlestickChart';
import { SubmarketCard } from './SubmarketCard';
import { useWallet } from '@/hooks/useWallet';

interface MarketDetailProps {
  market: Market;
}

export function MarketDetail({ market }: MarketDetailProps) {
  const [priceHistory, setPriceHistory] = useState<PriceHistoryPoint[]>([]);
  const [bucketMin, setBucketMin] = useState(15);
  const [agentStatus, setAgentStatus] = useState<{ participated: boolean; hasClaimed: boolean } | null>(null);
  const [orders, setOrders] = useState<OrderbookOrder[]>([]);
  const [orderbookTab, setOrderbookTab] = useState<'open' | 'filled'>('open');
  const { isConnected, connect, address } = useWallet();

  useEffect(() => {
    if (market.phase !== 'INFO_COLLECTION') {
      getPriceHistory(market.id).then(setPriceHistory);
      getMarketOrders(market.id).then(setOrders);
    }
  }, [market.id, market.phase]);

  useEffect(() => {
    if ((market.phase === 'TRADING' || market.phase === 'RESOLVED') && isConnected && address) {
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
          <div className="flex items-center gap-3">
            <span className={pi.badgeClass}>{pi.label}</span>
            <div className="text-xs font-mono px-2 py-0.5 rounded"
              style={{ background: 'rgba(255,255,255,0.04)', color: 'var(--text-muted)' }}>
              #{market.id}
            </div>
          </div>
        </div>
      </div>

      <div className="container mx-auto px-4 py-8">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          {/* Main column */}
          <div className="lg:col-span-2 space-y-6">
            {/* Header card */}
            <div className="card-glow">
              <h1 className="text-xl md:text-2xl font-bold text-white mb-3 leading-snug">
                {market.question}
              </h1>
              <p className="text-sm mb-6" style={{ color: 'var(--text-muted)' }}>{pi.description}</p>

              {/* Price bar (single-option only) or encrypted indicator; multi-option has bars in Options */}
              {showChart && yesPercent !== null && market.submarkets.length <= 1 ? (
                <div className="mb-6">
                  <div className="flex justify-between items-center mb-2">
                    <span className="font-bold text-lg" style={{ color: '#60A5FA' }}>
                      YES {yesPercent.toFixed(1)}%
                    </span>
                    <span className="font-bold text-lg" style={{ color: '#F87171' }}>
                      {(100 - yesPercent).toFixed(1)}% NO
                    </span>
                  </div>
                  <div className="flex rounded-full overflow-hidden" style={{ height: '8px', background: 'rgba(255,255,255,0.06)' }}>
                    <div className="h-full transition-[width] duration-500" style={{ width: `${yesPercent}%`, background: 'linear-gradient(90deg, #2563EB, #60A5FA)' }} />
                    <div className="h-full transition-[width] duration-500" style={{ width: `${100 - yesPercent}%`, background: 'linear-gradient(90deg, #DC2626, #F87171)' }} />
                  </div>
                </div>
              ) : !showChart ? (
                <div className="mb-6 flex items-center justify-center gap-3 py-5 rounded-xl"
                  style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)' }}>
                  <svg className="w-5 h-5 animate-pulse text-white/90" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                  </svg>
                  <div>
                    <div className="text-sm font-medium text-white/90">Predictions Encrypted</div>
                    <div className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>
                      Decrypts at drand round {market.drandTargetRound.toString()}
                    </div>
                  </div>
                </div>
              ) : null}

              {/* Stats grid */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                {[
                  { label: 'Participants', value: market.participants.toString() },
                  { label: 'Total Pool', value: market.totalStaked },
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
                      style={{ color: s.accent ? 'rgba(255,255,255,0.9)' : 'white' }}>
                      {s.value}
                    </div>
                  </div>
                ))}
              </div>

              {/* Creator — embedded in header */}
              <div className="mt-6 pt-6 flex flex-wrap items-center gap-4" style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }}>
                {market.creator && (
                  <div className="flex items-center gap-2">
                    <span className="text-xs" style={{ color: 'var(--text-muted)' }}>Creator</span>
                    <Link href={`/agent/${market.creator}`}
                      className="font-mono text-xs hover:underline text-white/90">
                      {market.creator.slice(0, 6)}…{market.creator.slice(-4)}
                    </Link>
                  </div>
                )}
                <div className="flex items-center gap-2">
                  <span className="text-xs" style={{ color: 'var(--text-muted)' }}>Premium</span>
                  <span className="font-mono text-xs text-white">{market.creatorPremium}</span>
                </div>
                {market.phase === 'RESOLVED' && (
                  <div className="flex items-center gap-2">
                    <span className="text-xs" style={{ color: 'var(--text-muted)' }}>Penalty Received</span>
                    <span className="font-mono text-xs"
                      style={{ color: parseFloat(market.creatorPayout) > 0 ? 'rgba(255,255,255,0.9)' : 'var(--text-muted)' }}>
                      {market.creatorPayout}
                    </span>
                  </div>
                )}
              </div>
            </div>

            {/* Submarket grid — shown for multi-option markets */}
            {market.submarkets.length > 1 && (
              <div>
                <h3 className="section-title text-sm mb-3">Options</h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {market.submarkets.map((sm) => (
                    <SubmarketCard key={sm.id} submarket={sm} />
                  ))}
                </div>
              </div>
            )}

            {/* InfoMarket — drand info */}
            {market.phase === 'INFO_COLLECTION' && (
              <div className="card-glow" style={{
                background: 'rgba(22,27,34,0.9)',
                borderColor: 'rgba(255,255,255,0.12)',
              }}>
                <div className="flex items-start gap-4">
                  <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"
                    style={{ background: 'rgba(255,255,255,0.08)' }}>
                    <svg className="w-5 h-5 text-white/90" fill="none" viewBox="0 0 24 24" stroke="currentColor">
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
                        <div className="font-mono font-bold text-sm text-white/90">
                          {formatDistanceToNow(market.decryptAt)}
                        </div>
                      </div>
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
                            background: 'rgba(255,255,255,0.1)', color: 'rgba(255,255,255,0.9)',
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

            {/* Orderbook — only shown for TRADING / RESOLVED */}
            {market.phase !== 'INFO_COLLECTION' && (
              <div className="card-flat">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="section-title text-sm mb-0">Orderbook</h3>
                  <div className="flex items-center gap-0.5 p-0.5 rounded-lg"
                    style={{ background: 'rgba(13,17,23,0.8)', border: '1px solid var(--border)' }}>
                    {(['open', 'filled'] as const).map((tab) => (
                      <button key={tab} onClick={() => setOrderbookTab(tab)}
                        className="px-3 py-1 rounded text-xs font-medium transition-all duration-100 capitalize"
                        style={orderbookTab === tab
                          ? { background: 'rgba(255,255,255,0.1)', color: 'rgba(255,255,255,0.9)' }
                          : { color: 'var(--text-muted)' }}>
                        {tab === 'open' ? 'Open Orders' : 'Trade History'}
                        {' '}
                        <span className="opacity-50">
                          ({orders.filter(o => tab === 'open' ? o.status === 'open' : o.status === 'filled').length})
                        </span>
                      </button>
                    ))}
                  </div>
                </div>

                {orderbookTab === 'open' && (() => {
                  const openOrders = orders.filter(o => o.status === 'open');
                  if (openOrders.length === 0) {
                    return (
                      <div className="text-center py-8 text-sm" style={{ color: 'var(--text-muted)' }}>
                        No open orders
                      </div>
                    );
                  }
                  return (
                    <div className="overflow-x-auto">
                      <table className="w-full text-xs">
                        <thead>
                          <tr style={{ color: 'var(--text-muted)' }}>
                            <th className="text-left py-2 pr-4 font-medium">Type</th>
                            <th className="text-left py-2 pr-4 font-medium">Maker</th>
                            <th className="text-right py-2 pr-4 font-medium">Amount</th>
                            <th className="text-right py-2 font-medium">Price</th>
                          </tr>
                        </thead>
                        <tbody>
                          {openOrders.map((o) => {
                            const pricePct = Number(o.price) / 1e18 * 100;
                            const amountShares = Number(o.amount) / 1e6;
                            return (
                              <tr key={o.id} className="border-t" style={{ borderColor: 'rgba(255,255,255,0.04)' }}>
                                <td className="py-2 pr-4">
                                  <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold"
                                    style={o.sellYes
                                      ? { background: 'rgba(96,165,250,0.2)', color: '#60A5FA' }
                                      : { background: 'rgba(248,113,113,0.2)', color: '#F87171' }}>
                                    {o.sellYes ? 'SELL YES' : 'SELL NO'}
                                  </span>
                                </td>
                                <td className="py-2 pr-4 font-mono text-white">
                                  <a href={`/agent/${o.maker}`} className="hover:underline">
                                    {o.maker.slice(0, 6)}…{o.maker.slice(-4)}
                                  </a>
                                </td>
                                <td className="py-2 pr-4 text-right font-mono text-white">
                                  {amountShares.toFixed(4)}
                                </td>
                                <td className="py-2 text-right font-mono"
                                  style={{ color: o.sellYes ? '#F87171' : '#60A5FA' }}>
                                  {pricePct.toFixed(1)}%
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  );
                })()}

                {orderbookTab === 'filled' && (() => {
                  const trades = orders.filter(o => o.status === 'filled').slice().reverse();
                  if (trades.length === 0) {
                    return (
                      <div className="text-center py-8 text-sm" style={{ color: 'var(--text-muted)' }}>
                        No trades yet
                      </div>
                    );
                  }
                  return (
                    <div className="overflow-x-auto">
                      <table className="w-full text-xs">
                        <thead>
                          <tr style={{ color: 'var(--text-muted)' }}>
                            <th className="text-left py-2 pr-3 font-medium">Type</th>
                            <th className="text-left py-2 pr-3 font-medium">Maker</th>
                            <th className="text-left py-2 pr-3 font-medium">Taker</th>
                            <th className="text-right py-2 pr-3 font-medium">Amount</th>
                            <th className="text-right py-2 font-medium">Price</th>
                          </tr>
                        </thead>
                        <tbody>
                          {trades.map((o) => {
                            const pricePct = Number(o.price) / 1e18 * 100;
                            const amountShares = Number(o.sharesAmount ?? o.amount) / 1e6;
                            return (
                              <tr key={o.id} className="border-t" style={{ borderColor: 'rgba(255,255,255,0.04)' }}>
                                <td className="py-2 pr-3">
                                  <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold"
                                    style={o.sellYes
                                      ? { background: 'rgba(96,165,250,0.2)', color: '#60A5FA' }
                                      : { background: 'rgba(248,113,113,0.2)', color: '#F87171' }}>
                                    {o.sellYes ? 'YES→NO' : 'NO→YES'}
                                  </span>
                                </td>
                                <td className="py-2 pr-3 font-mono text-white">
                                  <a href={`/agent/${o.maker}`} className="hover:underline">
                                    {o.maker.slice(0, 6)}…{o.maker.slice(-4)}
                                  </a>
                                </td>
                                <td className="py-2 pr-3 font-mono" style={{ color: 'var(--text-muted)' }}>
                                  {o.taker
                                    ? <a href={`/agent/${o.taker}`} className="hover:underline">
                                        {o.taker.slice(0, 6)}…{o.taker.slice(-4)}
                                      </a>
                                    : '—'}
                                </td>
                                <td className="py-2 pr-3 text-right font-mono text-white">
                                  {amountShares.toFixed(4)}
                                </td>
                                <td className="py-2 text-right font-mono"
                                  style={{ color: o.sellYes ? '#F87171' : '#60A5FA' }}>
                                  {pricePct.toFixed(1)}%
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  );
                })()}
              </div>
            )}

          </div>

          {/* Sidebar */}
          <div className="space-y-5">
            {/* Actions — shown in INFO_COLLECTION for anyone, or TRADING/RESOLVED for participants only */}
            {(market.phase === 'INFO_COLLECTION' || agentStatus?.participated) && (
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
                    {market.phase === 'TRADING' && agentStatus?.participated && (
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
            )}

            {/* Market Status — phase only (no outcome; options show YES/NO per option) */}
            <div className="card-flat">
              <h3 className="section-title text-sm">Market Status</h3>
              <div className="inline-flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm"
                style={{
                  background: market.phase === 'RESOLVED' ? 'rgba(34,197,94,0.15)' : 'rgba(255,255,255,0.06)',
                  color: market.phase === 'RESOLVED' ? '#4ADE80' : 'var(--text)',
                }}>
                {market.phase === 'INFO_COLLECTION' && 'InfoMarket Phase 1'}
                {market.phase === 'TRADING' && 'Prediction Market Phase 2'}
                {market.phase === 'RESOLVED' && 'Resolved'}
              </div>
            </div>

            {/* Market Timeline */}
            {(() => {
              const phase1End = market.decryptAt;
              const phase2End = market.tradingEndsAt;
              const now = new Date();
              const phase1Done = now > phase1End;
              const phase2Done = now > phase2End;
              const resolved = market.phase === 'RESOLVED';
              return (
                <div className="card-flat">
                  <h3 className="section-title text-sm">Market Timeline</h3>
                  <div className="space-y-3">
                    <div className="flex items-start gap-3">
                      <div className="w-2 h-2 rounded-full mt-1.5 flex-shrink-0"
                        style={{ background: phase1Done ? 'rgba(255,255,255,0.8)' : 'rgba(255,255,255,0.5)' }} />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-0.5">
                          <span className="text-xs font-semibold text-white">Phase 1 · Info Collection</span>
                          {phase1Done && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded font-medium"
                              style={{ background: 'rgba(34,197,94,0.2)', color: '#4ADE80' }}>done</span>
                          )}
                        </div>
                        <div className="text-xs font-mono" style={{ color: 'var(--text-muted)' }}>
                          {formatDateTime(market.createdAt)} → {formatDateTime(phase1End)}
                        </div>
                      </div>
                    </div>
                    <div className="flex items-start gap-3">
                      <div className="w-2 h-2 rounded-full mt-1.5 flex-shrink-0"
                        style={{ background: phase2Done ? 'rgba(255,255,255,0.8)' : phase1Done ? 'rgba(255,255,255,0.5)' : 'rgba(255,255,255,0.15)' }} />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-0.5">
                          <span className="text-xs font-semibold"
                            style={{ color: phase1Done ? 'white' : 'rgba(255,255,255,0.4)' }}>
                            Phase 2 · Prediction Market
                          </span>
                          {phase2Done && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded font-medium"
                              style={{ background: 'rgba(34,197,94,0.2)', color: '#4ADE80' }}>done</span>
                          )}
                        </div>
                        <div className="text-xs font-mono" style={{ color: 'var(--text-muted)' }}>
                          {formatDateTime(phase1End)} → {formatDateTime(phase2End)}
                        </div>
                      </div>
                    </div>
                    {resolved && (
                      <div className="flex items-start gap-3">
                        <div className="w-2 h-2 rounded-full mt-1.5 flex-shrink-0"
                          style={{ background: 'rgba(255,255,255,0.8)' }} />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-0.5">
                            <span className="text-xs font-semibold text-white">Market Resolved</span>
                            <span className="text-[10px] px-1.5 py-0.5 rounded font-medium"
                              style={{ background: 'rgba(34,197,94,0.2)', color: '#4ADE80' }}>done</span>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              );
            })()}

            {/* Resolution Schema */}
            {market.schema && (() => {
              let parsed: Record<string, unknown> = {};
              try { parsed = JSON.parse(market.schema); } catch { /* raw */ }
              const flat: Array<{ key: string; value: string }> = [];
              const flatten = (obj: Record<string, unknown>, prefix = '') => {
                for (const [k, v] of Object.entries(obj)) {
                  const key = prefix ? `${prefix}.${k}` : k;
                  if (Array.isArray(v)) {
                    const items = v.map((item) => {
                      if (item !== null && typeof item === 'object' && !Array.isArray(item)) {
                        const o = item as Record<string, unknown>;
                        if ('label' in o && typeof o.label === 'string') return o.label;
                        if ('text' in o && typeof o.text === 'string') return o.text;
                        if ('name' in o && typeof o.name === 'string') return o.name;
                        return JSON.stringify(o);
                      }
                      return String(item ?? '');
                    });
                    flat.push({ key, value: items.join(', ') });
                  } else if (v !== null && typeof v === 'object' && !Array.isArray(v)) {
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
                    {flat.length > 0 ? (
                      <table className="w-full text-xs border-collapse">
                        <tbody>
                          {flat.map(({ key, value }) => (
                            <tr key={key} className="border-b last:border-b-0" style={{ borderColor: 'rgba(255,255,255,0.04)' }}>
                              <td className="py-2.5 pl-3 pr-4 font-mono align-top whitespace-nowrap border-r" style={{ color: '#7DD3FC', minWidth: '11rem', width: '11rem', borderColor: 'rgba(255,255,255,0.08)' }}>
                                {key}
                              </td>
                              <td className="py-2.5 px-3 font-mono align-top break-words" style={{ color: 'rgba(255,255,255,0.7)' }}>
                                {value || <span style={{ color: 'var(--text-muted)' }}>(empty)</span>}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    ) : (
                      <pre className="p-3 text-xs overflow-auto" style={{ color: 'rgba(255,255,255,0.7)' }}>
                        {market.schema}
                      </pre>
                    )}
                  </div>
                </div>
              );
            })()}
          </div>
        </div>
      </div>
    </div>
  );
}
