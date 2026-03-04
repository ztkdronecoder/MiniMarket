'use client';

import Link from 'next/link';
import type { AgentMarket, AgentSubmarketStat } from '@/lib/agentApi';

interface AgentMarketListProps {
  markets: AgentMarket[];
}

function SubmarketRow({ s, ticketCost, optionCount, marketId }: {
  s: AgentSubmarketStat;
  ticketCost: bigint | null;
  optionCount: number;
  marketId: bigint;
}) {
  const total = Number(s.yesShares) + Number(s.noShares);
  const yesPct = total > 0 ? (Number(s.yesShares) / total * 100).toFixed(0) : null;
  const noPct = total > 0 ? (100 - Number(yesPct)).toFixed(0) : null;

  // Net P&L: payout minus ticket cost for this submarket (ticketCost is per submarket)
  const costPerSubmarket = ticketCost ? Number(ticketCost) : 0;
  const payout = Number(s.totalPayout);
  // Show net P&L whenever market is resolved (wasCorrect !== null) or payout received
  const net = (s.wasCorrect !== null || payout > 0) ? payout - costPerSubmarket : null;

  return (
    <Link href={`/market/${marketId}/submarket/${s.optionIndex}`} className="block">
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3 py-2.5 px-3 rounded-lg text-sm
        hover:bg-white/[0.03] transition-colors"
        style={{ borderTop: '1px solid rgba(255,255,255,0.04)' }}>

        {/* Option label */}
        <div className="md:col-span-1 flex items-center gap-1.5 min-w-0">
          {s.wasCorrect !== null && (
            <span className={`text-xs font-bold flex-shrink-0 ${s.wasCorrect ? 'text-green-400' : 'text-red-400'}`}>
              {s.wasCorrect ? '✓' : '✗'}
            </span>
          )}
          <span className="text-xs text-white truncate font-medium">
            {s.optionLabel ?? `Option ${s.optionIndex}`}
          </span>
        </div>

        {/* Share Split */}
        <div>
          <div className="text-[10px] text-chainlink-text-muted mb-0.5">Share Split</div>
          {yesPct !== null ? (
            <div className="font-mono text-xs">
              <span className="text-green-400">{yesPct}% YES</span>
              <span className="text-chainlink-text-muted"> / </span>
              <span className="text-red-400">{noPct}% NO</span>
            </div>
          ) : (
            <div className="font-mono text-xs text-chainlink-text-muted">—</div>
          )}
        </div>

        {/* Confidence */}
        <div>
          <div className="text-[10px] text-chainlink-text-muted mb-0.5">Confidence</div>
          <div className="font-mono text-xs">
            {s.wasCorrect !== null ? (
              <span style={{ color: s.wasCorrect ? '#34D399' : '#F87171' }}>
                {s.confidenceScore.toFixed(1)}%
              </span>
            ) : (
              <span className="text-chainlink-text-muted">—</span>
            )}
          </div>
        </div>

        {/* Swaps */}
        <div>
          <div className="text-[10px] text-chainlink-text-muted mb-0.5">Swaps</div>
          <div className="font-mono text-xs text-white">{s.totalSwaps.toString()}</div>
        </div>

        {/* Net P&L */}
        <div>
          <div className="text-[10px] text-chainlink-text-muted mb-0.5">Net P&L</div>
          <div className="font-mono text-xs">
            {net !== null ? (
              <span style={{ color: net >= 0 ? '#34D399' : '#F87171' }}>
                {net >= 0 ? '+' : ''}{(net / 1e6).toFixed(6)} USDC
              </span>
            ) : (
              <span className="text-chainlink-text-muted">—</span>
            )}
          </div>
        </div>
      </div>
    </Link>
  );
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
      {markets.map((am) => {
        const optionCount = am.submarkets.length || 1;
        // Aggregate totals for the parent market header
        const totalPayout = am.submarkets.reduce((s, sub) => s + Number(sub.totalPayout), 0);
        const isResolved = am.submarkets.some((sub) => sub.wasCorrect !== null);
        const totalCost = am.ticketCost ? Number(am.ticketCost) * optionCount : 0;
        const net = (totalPayout > 0 || isResolved)
          ? totalPayout - totalCost
          : null;

        return (
          <div key={am.id} className="card-flat">
            {/* Parent market header */}
            <Link href={`/market/${am.marketId}`} className="block mb-3">
              <div className="flex items-start justify-between">
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
                  {am.participated && (
                    <div className="badge-info text-xs">Participated</div>
                  )}
                </div>
                <div className="flex items-center gap-3 flex-shrink-0">
                  {am.ticketCost !== null && (
                    <span className="text-xs text-chainlink-text-muted font-mono">
                      {(Number(am.ticketCost ?? 0) / 1e6).toFixed(6)} USDC/submarket
                    </span>
                  )}
                  {net !== null && (
                    <span className="text-xs font-semibold font-mono"
                      style={{ color: net >= 0 ? '#34D399' : '#F87171' }}>
                      {net >= 0 ? '+' : ''}{(net / 1e6).toFixed(6)} total
                    </span>
                  )}
                </div>
              </div>
              {am.marketQuestion && (
                <p className="text-sm text-white mt-2 leading-snug line-clamp-2">
                  {am.marketQuestion}
                </p>
              )}
            </Link>

            {/* Per-submarket rows */}
            {am.submarkets.length > 0 ? (
              <div>
                {/* Column headers */}
                <div className="grid grid-cols-2 md:grid-cols-5 gap-3 px-3 pb-1">
                  <div className="text-[10px] text-chainlink-text-muted uppercase tracking-wide font-medium md:col-span-1">Option</div>
                  <div className="text-[10px] text-chainlink-text-muted uppercase tracking-wide font-medium">Share Split</div>
                  <div className="text-[10px] text-chainlink-text-muted uppercase tracking-wide font-medium">Confidence</div>
                  <div className="text-[10px] text-chainlink-text-muted uppercase tracking-wide font-medium">Swaps</div>
                  <div className="text-[10px] text-chainlink-text-muted uppercase tracking-wide font-medium">Net P&L</div>
                </div>
                {am.submarkets.map((s) => (
                  <SubmarketRow
                    key={s.submarketId}
                    s={s}
                    ticketCost={am.ticketCost}
                    optionCount={optionCount}
                    marketId={am.marketId}
                  />
                ))}
              </div>
            ) : (
              <div className="text-xs text-chainlink-text-muted px-3 py-2">
                No submarket data yet
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
