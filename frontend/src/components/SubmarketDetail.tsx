'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import type { Market, Submarket, PriceHistoryPoint } from '@/lib/types';
import { getSubmarketPriceHistory, getSubmarketOrders, type OrderbookOrder } from '@/lib/marketApi';
import { CandlestickChart } from './CandlestickChart';

interface SubmarketDetailProps {
  market: Market;
  submarket: Submarket;
}

export function SubmarketDetail({ market, submarket }: SubmarketDetailProps) {
  const [priceHistory, setPriceHistory] = useState<PriceHistoryPoint[]>([]);
  const [bucketMin, setBucketMin] = useState(15);
  const [orders, setOrders] = useState<OrderbookOrder[]>([]);
  const [orderbookTab, setOrderbookTab] = useState<'open' | 'filled'>('open');

  useEffect(() => {
    if (submarket.phase !== 'INFO_COLLECTION') {
      getSubmarketPriceHistory(submarket.id).then(setPriceHistory);
      getSubmarketOrders(submarket.id).then(setOrders);
    }
  }, [submarket.id, submarket.phase]);

  const showChart = submarket.phase !== 'INFO_COLLECTION';
  const yesPercent = submarket.priceYes * 100;

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
          <Link href={`/market/${market.id}`} className="btn-ghost text-sm gap-2">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
            Market #{market.id}
          </Link>
          <div className="text-xs font-mono" style={{ color: 'var(--text-muted)' }}>
            Option {submarket.optionIndex}
          </div>
        </div>
      </div>

      <div className="container mx-auto px-4 py-8">
        {/* Parent question breadcrumb */}
        <div className="text-xs mb-2" style={{ color: 'var(--text-muted)' }}>
          {market.question}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          {/* Main column */}
          <div className="lg:col-span-2 space-y-6">
            {/* Header card */}
            <div className="card-glow">
              <div className="flex items-start justify-between mb-3">
                {submarket.phase === 'INFO_COLLECTION' ? (
                  <span className="badge-infomarket">Encrypted</span>
                ) : submarket.phase === 'TRADING' ? (
                  <span className="badge-trading">Trading Live</span>
                ) : (
                  <span className="badge-resolved">Resolved</span>
                )}
                <div className="text-xs font-mono px-2 py-0.5 rounded"
                  style={{ background: 'rgba(255,255,255,0.04)', color: 'var(--text-muted)' }}>
                  Option {submarket.optionIndex}
                </div>
              </div>

              <h1 className="text-xl md:text-2xl font-bold text-white mb-4 leading-snug">
                {submarket.optionLabel ?? `Option ${submarket.optionIndex}`}
              </h1>

              {/* Price bar */}
              {showChart ? (
                <div className="mb-5">
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
                <div className="mb-5 flex items-center gap-3 py-4 rounded-xl justify-center"
                  style={{ background: 'rgba(124,58,237,0.06)', border: '1px solid rgba(124,58,237,0.12)' }}>
                  <svg className="w-5 h-5 animate-pulse" style={{ color: '#B78BFF' }} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                  </svg>
                  <span className="text-sm" style={{ color: '#B78BFF' }}>Predictions Encrypted</span>
                </div>
              )}

              {/* Stats */}
              <div className="grid grid-cols-3 gap-3">
                <div className="rounded-xl p-3" style={{ background: 'rgba(255,255,255,0.03)' }}>
                  <div className="stat-label mb-1">Valid Subs</div>
                  <div className="font-bold font-mono text-white">{submarket.validSubmissions}</div>
                </div>
                <div className="rounded-xl p-3" style={{ background: 'rgba(255,255,255,0.03)' }}>
                  <div className="stat-label mb-1">Reserve YES</div>
                  <div className="font-bold font-mono text-white text-xs">
                    {(Number(submarket.reserveYes) / 1e6).toFixed(2)}
                  </div>
                </div>
                <div className="rounded-xl p-3" style={{ background: 'rgba(255,255,255,0.03)' }}>
                  <div className="stat-label mb-1">Reserve NO</div>
                  <div className="font-bold font-mono text-white text-xs">
                    {(Number(submarket.reserveNo) / 1e6).toFixed(2)}
                  </div>
                </div>
              </div>
            </div>

            {/* Outcome / consensus banners */}
            {submarket.phase === 'TRADING' && submarket.consensusOutcome && (
              <div className="card-glow" style={{
                background: 'linear-gradient(135deg, rgba(22,27,34,0.9), rgba(10,30,25,0.4))',
                borderColor: 'rgba(16,185,129,0.15)',
              }}>
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0"
                    style={{ background: 'rgba(16,185,129,0.12)' }}>
                    <svg className="w-4 h-4 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                  </div>
                  <div>
                    <div className="text-sm font-semibold text-white mb-0.5">Agent Consensus</div>
                    <div className="inline-flex items-center gap-2 text-sm">
                      <span style={{ color: 'var(--text-muted)' }}>Consensus:</span>
                      <span className="font-bold"
                        style={{ color: submarket.consensusOutcome === 'YES' ? '#34D399' : '#F87171' }}>
                        {submarket.consensusOutcome}
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {submarket.resolvedOutcome && (
              <div className="card-glow" style={{
                background: 'linear-gradient(135deg, rgba(22,27,34,0.9), rgba(30,10,50,0.3))',
                borderColor: 'rgba(167,139,250,0.15)',
              }}>
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0"
                    style={{ background: 'rgba(167,139,250,0.12)' }}>
                    <svg className="w-4 h-4" style={{ color: '#A78BFA' }} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M5 13l4 4L19 7" />
                    </svg>
                  </div>
                  <div>
                    <div className="text-sm font-semibold text-white mb-0.5">Resolved</div>
                    <div className="inline-flex items-center gap-2 text-sm">
                      <span style={{ color: 'var(--text-muted)' }}>Outcome:</span>
                      <span className="font-bold"
                        style={{ color: submarket.resolvedOutcome === 'YES' ? '#34D399' : '#F87171' }}>
                        {submarket.resolvedOutcome}
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

            {/* Orderbook */}
            {submarket.phase !== 'INFO_COLLECTION' && (
              <div className="card-flat">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="section-title text-sm mb-0">Orderbook</h3>
                  <div className="flex items-center gap-0.5 p-0.5 rounded-lg"
                    style={{ background: 'rgba(13,17,23,0.8)', border: '1px solid var(--border)' }}>
                    {(['open', 'filled'] as const).map((tab) => (
                      <button key={tab} onClick={() => setOrderbookTab(tab)}
                        className="px-3 py-1 rounded text-xs font-medium transition-all duration-100 capitalize"
                        style={orderbookTab === tab
                          ? { background: 'rgba(42,90,218,0.2)', color: '#60A5FA' }
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
                    return <div className="text-center py-8 text-sm" style={{ color: 'var(--text-muted)' }}>No open orders</div>;
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
                          {openOrders.map((o) => (
                            <tr key={o.id} className="border-t" style={{ borderColor: 'rgba(255,255,255,0.04)' }}>
                              <td className="py-2 pr-4">
                                <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold"
                                  style={o.sellYes
                                    ? { background: 'rgba(248,113,113,0.1)', color: '#F87171' }
                                    : { background: 'rgba(52,211,153,0.1)', color: '#34D399' }}>
                                  {o.sellYes ? 'SELL YES' : 'SELL NO'}
                                </span>
                              </td>
                              <td className="py-2 pr-4 font-mono text-white">
                                <a href={`/agent/${o.maker}`} className="hover:underline">
                                  {o.maker.slice(0, 6)}…{o.maker.slice(-4)}
                                </a>
                              </td>
                              <td className="py-2 pr-4 text-right font-mono text-white">
                                {(Number(o.amount) / 1e6).toFixed(4)}
                              </td>
                              <td className="py-2 text-right font-mono"
                                style={{ color: o.sellYes ? '#F87171' : '#34D399' }}>
                                {(Number(o.price) / 1e18 * 100).toFixed(1)}%
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  );
                })()}

                {orderbookTab === 'filled' && (() => {
                  const trades = orders.filter(o => o.status === 'filled').slice().reverse();
                  if (trades.length === 0) {
                    return <div className="text-center py-8 text-sm" style={{ color: 'var(--text-muted)' }}>No trades yet</div>;
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
                          {trades.map((o) => (
                            <tr key={o.id} className="border-t" style={{ borderColor: 'rgba(255,255,255,0.04)' }}>
                              <td className="py-2 pr-3">
                                <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold"
                                  style={o.sellYes
                                    ? { background: 'rgba(248,113,113,0.1)', color: '#F87171' }
                                    : { background: 'rgba(52,211,153,0.1)', color: '#34D399' }}>
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
                                {(Number(o.sharesAmount ?? o.amount) / 1e6).toFixed(4)}
                              </td>
                              <td className="py-2 text-right font-mono"
                                style={{ color: o.sellYes ? '#F87171' : '#34D399' }}>
                                {(Number(o.price) / 1e18 * 100).toFixed(1)}%
                              </td>
                            </tr>
                          ))}
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
            {/* Submarket details */}
            <div className="card-flat">
              <h3 className="section-title text-sm">Submarket Details</h3>
              <div className="space-y-0">
                {[
                  { label: 'Option Index', value: submarket.optionIndex.toString() },
                  { label: 'Total YES Shares', value: (Number(submarket.totalYesShares) / 1e6).toFixed(4) },
                  { label: 'Total NO Shares', value: (Number(submarket.totalNoShares) / 1e6).toFixed(4) },
                  { label: 'Valid Submissions', value: submarket.validSubmissions.toString() },
                  ...(submarket.totalPenaltyCollected > BigInt(0)
                    ? [{ label: 'Penalty Collected', value: `${(Number(submarket.totalPenaltyCollected) / 1e6).toFixed(2)} USDC` }]
                    : []),
                ].map((row) => (
                  <div key={row.label} className="data-row">
                    <span className="text-xs" style={{ color: 'var(--text-muted)' }}>{row.label}</span>
                    <span className="font-mono text-xs text-white">{row.value}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Other options in this market */}
            {market.submarkets.length > 1 && (
              <div className="card-flat">
                <h3 className="section-title text-sm">Other Options</h3>
                <div className="space-y-2">
                  {market.submarkets
                    .filter((sm) => sm.optionIndex !== submarket.optionIndex)
                    .map((sm) => (
                      <Link key={sm.id}
                        href={`/market/${market.id}/submarket/${sm.optionIndex}`}
                        className="block rounded-lg px-3 py-2 text-xs hover:bg-white/5 transition-colors"
                        style={{ border: '1px solid rgba(255,255,255,0.06)' }}>
                        <div className="flex items-center justify-between">
                          <span style={{ color: 'rgba(255,255,255,0.7)' }}>
                            {sm.optionLabel ?? `Option ${sm.optionIndex}`}
                          </span>
                          {sm.resolvedOutcome ? (
                            <span className="font-bold"
                              style={{ color: sm.resolvedOutcome === 'YES' ? '#34D399' : '#F87171' }}>
                              {sm.resolvedOutcome}
                            </span>
                          ) : sm.phase !== 'INFO_COLLECTION' ? (
                            <span className="font-mono" style={{ color: '#34D399' }}>
                              {(sm.priceYes * 100).toFixed(0)}%
                            </span>
                          ) : (
                            <span style={{ color: 'var(--text-muted)' }}>—</span>
                          )}
                        </div>
                      </Link>
                    ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
