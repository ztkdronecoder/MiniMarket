'use client';

import { useState, useEffect, useRef, useMemo } from 'react';
import { createChart, ColorType } from 'lightweight-charts';
import type { UTCTimestamp } from 'lightweight-charts';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type { Market } from '@/lib/types';
import { formatDistanceToNow } from '@/lib/utils';
import { getSubmarketPriceHistory, getSubmarketPrice } from '@/lib/marketApi';

// Shared palette — matches MultiLineChart.tsx
const OPTION_COLORS = [
  '#3B82F6', // blue
  '#10B981', // emerald
  '#F59E0B', // amber
  '#EF4444', // red
  '#A855F7', // purple
  '#EC4899', // pink
];


/** Catmull-Rom spline interpolation — same as MultiLineChart */
function catmullRom(points: { time: number; value: number }[], steps = 4): { time: number; value: number }[] {
  if (points.length < 3) return points;
  const out: { time: number; value: number }[] = [];
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[Math.max(0, i - 1)];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[Math.min(points.length - 1, i + 2)];
    out.push(p1);
    for (let s = 1; s < steps; s++) {
      const t = s / steps;
      const t2 = t * t;
      const t3 = t2 * t;
      const v =
        0.5 *
        (2 * p1.value +
          (-p0.value + p2.value) * t +
          (2 * p0.value - 5 * p1.value + 4 * p2.value - p3.value) * t2 +
          (-p0.value + 3 * p1.value - 3 * p2.value + p3.value) * t3);
      out.push({
        time: p1.time + (p2.time - p1.time) * t,
        value: Math.max(0, Math.min(100, v)),
      });
    }
  }
  out.push(points[points.length - 1]);
  return out;
}

/**
 * Single-option sparkline using lightweight-charts — same engine as the market detail page.
 * Accepts one submarketId + color so clicking an option tab simply re-renders this.
 */
function OptionSparkline({ submarketId, color, currentPrice }: {
  submarketId: string;
  color: string;
  currentPrice?: number;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [basePoints, setBasePoints] = useState<{ time: number; value: number }[]>([]);

  // Fetch history once per submarket (no currentPrice dep to keep array size stable)
  useEffect(() => {
    let cancelled = false;
    getSubmarketPriceHistory(submarketId)
      .then((h) => {
        if (cancelled) return;
        const sorted = [...h].sort((a, b) => a.timestamp - b.timestamp);
        const raw: { time: number; value: number }[] = [];
        let lastTime = -1;
        for (const p of sorted) {
          let time = p.timestamp;
          if (time <= lastTime) time = lastTime + 0.001;
          lastTime = time;
          raw.push({ time, value: p.priceYes * 100 });
        }
        setBasePoints(raw);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [submarketId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Extend last point to current live price whenever either changes
  const points = useMemo(() => {
    if (basePoints.length === 0) return basePoints;
    const raw = [...basePoints];
    const nowSec = Math.floor(Date.now() / 1000);
    const endValue = currentPrice != null ? currentPrice * 100 : raw[raw.length - 1].value;
    if (raw[raw.length - 1].time < nowSec - 1) {
      raw.push({ time: nowSec, value: endValue });
    } else {
      raw[raw.length - 1] = { ...raw[raw.length - 1], value: endValue };
    }
    return catmullRom(raw, 4);
  }, [basePoints, currentPrice]);

  useEffect(() => {
    if (!containerRef.current || points.length === 0) return;
    const chart = createChart(containerRef.current, {
      autoSize: true,
      layout: { background: { type: ColorType.Solid, color: 'transparent' }, textColor: 'transparent' },
      grid: { vertLines: { visible: false }, horzLines: { visible: false } },
      rightPriceScale: { visible: false },
      leftPriceScale: { visible: false },
      timeScale: { visible: false },
      crosshair: { vertLine: { visible: false }, horzLine: { visible: false } },
      handleScroll: false,
      handleScale: false,
    });
    const line = chart.addLineSeries({
      color,
      lineWidth: 2,
      crosshairMarkerVisible: false,
      priceLineVisible: false,
      lastValueVisible: false,
    });
    line.setData(points.map(p => ({ ...p, time: p.time as UTCTimestamp })));
    chart.timeScale().fitContent();
    return () => chart.remove();
  }, [points, color]);

  if (points.length === 0) {
    return (
      <div className="flex items-center justify-center text-[10px]"
        style={{ height: '64px', color: 'rgba(255,255,255,0.1)' }}>
        no data
      </div>
    );
  }
  return <div ref={containerRef} style={{ height: '64px', width: '100%' }} />;
}

interface MarketCardProps {
  market: Market;
}

// ── InfoMarket card ──────────────────────────────────────────────────────────

function InfoMarketCard({ market }: MarketCardProps) {
  return (
    <Link href={`/market/${market.id}`} className="block group">
      <div className="h-full flex flex-col rounded-2xl overflow-hidden transition-all duration-200 hover:translate-y-[-2px]"
        style={{
          background: 'linear-gradient(135deg, rgba(109,40,217,0.08) 0%, rgba(13,17,23,0.95) 60%)',
          border: '1px solid rgba(109,40,217,0.25)',
          boxShadow: '0 0 0 0 rgba(109,40,217,0)',
        }}>

        {/* Top accent bar */}
        <div className="h-0.5 w-full" style={{ background: 'linear-gradient(90deg, rgba(109,40,217,0.8), rgba(139,92,246,0.3), transparent)' }} />

        <div className="flex flex-col flex-1 p-5">
          {/* Badge row */}
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-1.5 text-[10px] font-semibold tracking-wide uppercase px-2 py-1 rounded-full"
              style={{ background: 'rgba(109,40,217,0.15)', color: '#A78BFA', border: '1px solid rgba(109,40,217,0.3)' }}>
              <svg className="w-2.5 h-2.5 animate-pulse" fill="currentColor" viewBox="0 0 8 8">
                <circle cx="4" cy="4" r="3" />
              </svg>
              InfoMarket
            </div>
            <span className="text-[10px] font-mono" style={{ color: 'rgba(255,255,255,0.2)' }}>#{market.id}</span>
          </div>

          {/* Question */}
          <h3 className="text-sm font-semibold leading-snug mb-4 line-clamp-3 flex-grow"
            style={{ color: 'rgba(255,255,255,0.88)' }}>
            {market.question}
          </h3>

          {/* Options list (no prices yet) */}
          {market.submarkets.length > 1 && (
            <div className="flex flex-wrap gap-1.5 mb-4">
              {market.submarkets.map((sm, idx) => (
                <span key={sm.id}
                  className="text-[10px] font-medium px-2 py-0.5 rounded-full"
                  style={{
                    background: `${OPTION_COLORS[idx % OPTION_COLORS.length]}18`,
                    color: OPTION_COLORS[idx % OPTION_COLORS.length],
                    border: `1px solid ${OPTION_COLORS[idx % OPTION_COLORS.length]}33`,
                  }}>
                  {sm.optionLabel ?? `Option ${sm.optionIndex}`}
                </span>
              ))}
            </div>
          )}

          {/* Encrypted state */}
          <div className="flex items-center gap-2.5 rounded-xl px-3 py-2.5 mb-4"
            style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.07)' }}>
            <svg className="w-3.5 h-3.5 shrink-0" style={{ color: '#A78BFA' }} fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
            </svg>
            <div>
              <div className="text-[10px] font-semibold text-white/80">Predictions sealed</div>
              <div className="text-[9px] mt-0.5" style={{ color: 'var(--text-muted)' }}>Drand timelock encryption</div>
            </div>
          </div>

          {/* Footer */}
          <div className="flex items-center justify-between text-[10px] pt-3"
            style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }}>
            <div className="flex items-center gap-1" style={{ color: 'var(--text-muted)' }}>
              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
              {market.participants} agents
            </div>
            <div className="flex items-center gap-1 font-medium" style={{ color: '#A78BFA' }}>
              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              Decrypts {formatDistanceToNow(market.decryptAt)}
            </div>
          </div>
        </div>
      </div>
    </Link>
  );
}

// ── Trading card ─────────────────────────────────────────────────────────────

function TradingCard({ market }: MarketCardProps) {
  const router = useRouter();
  const [selectedIdx, setSelectedIdx] = useState(0);
  const [livePrices, setLivePrices] = useState<Record<string, number>>({});
  const isMultiOption = market.submarkets.length > 1;
  const selectedSm = market.submarkets[selectedIdx] ?? market.submarkets[0];
  const selectedColor = OPTION_COLORS[selectedIdx % OPTION_COLORS.length];

  // Poll live orderbook prices for all submarkets
  useEffect(() => {
    const fetchAll = () =>
      Promise.all(
        market.submarkets.map((sm) =>
          getSubmarketPrice(sm.id).then((p) => p ? [sm.id, p.priceYes] as [string, number] : null)
        )
      ).then((results) => {
        const map: Record<string, number> = {};
        for (const r of results) if (r) map[r[0]] = r[1];
        if (Object.keys(map).length > 0) setLivePrices(map);
      });

    fetchAll();
    const interval = setInterval(fetchAll, 10_000);
    return () => clearInterval(interval);
  }, [market.submarkets]);

  const getLivePrice = (sm: typeof selectedSm) =>
    sm ? (livePrices[sm.id] ?? sm.priceYes) : 0;

  const yesPrice = selectedSm ? (getLivePrice(selectedSm) * 100).toFixed(1) : '—';

  if (!selectedSm) return null;

  return (
    <div
      className="h-full flex flex-col rounded-2xl overflow-hidden cursor-pointer transition-all duration-200 hover:translate-y-[-2px]"
      style={{
        background: 'linear-gradient(135deg, rgba(16,185,129,0.06) 0%, rgba(13,17,23,0.95) 60%)',
        border: '1px solid rgba(16,185,129,0.2)',
      }}
      onClick={() => router.push(`/market/${market.id}`)}>

      {/* Top accent bar */}
      <div className="h-0.5 w-full" style={{ background: 'linear-gradient(90deg, rgba(16,185,129,0.9), rgba(52,211,153,0.3), transparent)' }} />

      <div className="flex flex-col flex-1 p-5">
        {/* Badge row */}
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-1.5 text-[10px] font-semibold tracking-wide uppercase px-2 py-1 rounded-full"
            style={{ background: 'rgba(16,185,129,0.12)', color: '#34D399', border: '1px solid rgba(16,185,129,0.25)' }}>
            <svg className="w-2.5 h-2.5 animate-pulse" fill="currentColor" viewBox="0 0 8 8">
              <circle cx="4" cy="4" r="3" />
            </svg>
            Live
          </div>
          <span className="text-[10px] font-mono" style={{ color: 'rgba(255,255,255,0.2)' }}>#{market.id}</span>
        </div>

        {/* Question */}
        <h3 className="text-sm font-semibold leading-snug mb-4 line-clamp-2 flex-grow"
          style={{ color: 'rgba(255,255,255,0.9)' }}>
          {market.question}
        </h3>

        {/* Option selector — clickable tabs, stopPropagation so card doesn't navigate */}
        {isMultiOption && (
          <div className="flex flex-wrap gap-1.5 mb-3"
            onClick={(e) => e.stopPropagation()}>
            {market.submarkets.slice(0, OPTION_COLORS.length).map((sm, idx) => {
              const color = OPTION_COLORS[idx % OPTION_COLORS.length];
              const active = idx === selectedIdx;
              return (
                <button
                  key={sm.id}
                  onClick={(e) => { e.stopPropagation(); setSelectedIdx(idx); }}
                  className="text-[10px] font-medium px-2.5 py-1 rounded-full transition-all duration-150"
                  style={{
                    background: active ? `${color}22` : 'rgba(255,255,255,0.04)',
                    color: active ? color : 'rgba(255,255,255,0.45)',
                    border: `1px solid ${active ? `${color}55` : 'rgba(255,255,255,0.08)'}`,
                  }}>
                  {sm.optionLabel ?? `Option ${sm.optionIndex}`}
                  <span className="ml-1 font-mono opacity-80">
                    {(getLivePrice(sm) * 100).toFixed(1)}%
                  </span>
                </button>
              );
            })}
          </div>
        )}

        {/* Price + chart */}
        <div className="rounded-xl overflow-hidden mb-3"
          style={{ background: 'rgba(8,12,20,0.7)', border: `1px solid ${selectedColor}22` }}>
          {/* Price header inside chart frame */}
          <div className="flex items-center justify-between px-3 pt-2.5 pb-1">
            <div className="flex items-baseline gap-1.5">
              <span className="text-lg font-bold font-mono" style={{ color: selectedColor }}>
                {yesPrice}%
              </span>
              <span className="text-[10px]" style={{ color: 'rgba(255,255,255,0.3)' }}>YES</span>
            </div>
            {!isMultiOption && market.consensusOutcome && (
              <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full"
                style={{ background: 'rgba(255,255,255,0.06)', color: 'rgba(255,255,255,0.5)' }}>
                consensus {market.consensusOutcome}
              </span>
            )}
          </div>
          <OptionSparkline
            submarketId={selectedSm.id}
            color={selectedColor}
            currentPrice={getLivePrice(selectedSm)}
          />
        </div>

        {/* Footer stats */}
        <div className="flex items-center justify-between text-[10px] pt-3"
          style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }}>
          <div className="flex items-center gap-3" style={{ color: 'var(--text-muted)' }}>
            <span className="font-mono">{market.totalStaked}</span>
            <span>·</span>
            <span>{market.participants} agents</span>
          </div>
          <div className="flex items-center gap-1" style={{ color: 'rgba(255,255,255,0.3)' }}>
            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            {formatDistanceToNow(market.tradingEndsAt)}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Resolved card ────────────────────────────────────────────────────────────

function ResolvedCard({ market }: MarketCardProps) {
  const router = useRouter();
  const [selectedIdx, setSelectedIdx] = useState(0);
  const isMultiOption = market.submarkets.length > 1;
  const selectedSm = market.submarkets[selectedIdx] ?? market.submarkets[0];
  const selectedColor = OPTION_COLORS[selectedIdx % OPTION_COLORS.length];

  if (!selectedSm) return null;

  return (
    <div
      className="h-full flex flex-col rounded-2xl overflow-hidden cursor-pointer transition-all duration-200 opacity-75 hover:opacity-100 hover:translate-y-[-2px]"
      style={{
        background: 'rgba(13,17,23,0.9)',
        border: '1px solid rgba(255,255,255,0.08)',
      }}
      onClick={() => router.push(`/market/${market.id}`)}>

      <div className="h-0.5 w-full" style={{ background: 'linear-gradient(90deg, rgba(255,255,255,0.25), rgba(255,255,255,0.05), transparent)' }} />

      <div className="flex flex-col flex-1 p-5">
        {/* Badge row */}
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-1.5 text-[10px] font-semibold tracking-wide uppercase px-2 py-1 rounded-full"
            style={{ background: 'rgba(255,255,255,0.06)', color: 'rgba(255,255,255,0.5)', border: '1px solid rgba(255,255,255,0.1)' }}>
            <svg className="w-2.5 h-2.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
            </svg>
            Resolved
          </div>
          <span className="text-[10px] font-mono" style={{ color: 'rgba(255,255,255,0.15)' }}>#{market.id}</span>
        </div>

        {/* Question */}
        <h3 className="text-sm font-semibold leading-snug mb-4 line-clamp-2 flex-grow"
          style={{ color: 'rgba(255,255,255,0.65)' }}>
          {market.question}
        </h3>

        {/* Option selector */}
        {isMultiOption && (
          <div className="flex flex-wrap gap-1.5 mb-3"
            onClick={(e) => e.stopPropagation()}>
            {market.submarkets.slice(0, OPTION_COLORS.length).map((sm, idx) => {
              const color = OPTION_COLORS[idx % OPTION_COLORS.length];
              const active = idx === selectedIdx;
              return (
                <button
                  key={sm.id}
                  onClick={(e) => { e.stopPropagation(); setSelectedIdx(idx); }}
                  className="text-[10px] font-medium px-2.5 py-1 rounded-full transition-all duration-150"
                  style={{
                    background: active ? `${color}18` : 'rgba(255,255,255,0.03)',
                    color: active ? color : 'rgba(255,255,255,0.3)',
                    border: `1px solid ${active ? `${color}44` : 'rgba(255,255,255,0.06)'}`,
                  }}>
                  {sm.optionLabel ?? `Option ${sm.optionIndex}`}
                  {sm.resolvedOutcome && (
                    <span className="ml-1 font-bold">· {sm.resolvedOutcome}</span>
                  )}
                </button>
              );
            })}
          </div>
        )}

        {/* Chart */}
        <div className="rounded-xl overflow-hidden mb-3"
          style={{ background: 'rgba(8,12,20,0.5)', border: '1px solid rgba(255,255,255,0.06)' }}>
          {!isMultiOption && market.resolvedOutcome && (
            <div className="flex items-center gap-2 px-3 pt-2.5 pb-1">
              <span className="text-xs font-bold" style={{ color: 'rgba(255,255,255,0.5)' }}>
                Final outcome:
              </span>
              <span className="text-sm font-bold font-mono"
                style={{ color: market.resolvedOutcome === 'YES' ? '#34D399' : '#F87171' }}>
                {market.resolvedOutcome}
              </span>
            </div>
          )}
          <OptionSparkline
            submarketId={selectedSm.id}
            color={selectedColor}
            currentPrice={selectedSm.priceYes}
          />
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between text-[10px] pt-3"
          style={{ borderTop: '1px solid rgba(255,255,255,0.05)' }}>
          <div className="flex items-center gap-3" style={{ color: 'rgba(255,255,255,0.3)' }}>
            <span className="font-mono">{market.totalStaked}</span>
            <span>·</span>
            <span>{market.participants} agents</span>
          </div>
          {isMultiOption && selectedSm.resolvedOutcome && (
            <span className="font-bold text-[10px] px-2 py-0.5 rounded-full"
              style={{ background: 'rgba(255,255,255,0.06)', color: 'rgba(255,255,255,0.5)' }}>
              {selectedSm.resolvedOutcome}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

function AbortedCard({ market }: MarketCardProps) {
  const router = useRouter();
  return (
    <div
      className="h-full flex flex-col rounded-2xl overflow-hidden cursor-pointer transition-all duration-200 opacity-60 hover:opacity-80 hover:translate-y-[-2px]"
      style={{
        background: 'linear-gradient(135deg, rgba(100,116,139,0.06) 0%, rgba(13,17,23,0.95) 60%)',
        border: '1px solid rgba(100,116,139,0.18)',
      }}
      onClick={() => router.push(`/market/${market.id}`)}>
      <div className="h-0.5 w-full" style={{ background: 'linear-gradient(90deg, rgba(100,116,139,0.5), transparent)' }} />
      <div className="flex flex-col flex-1 p-5">
        <div className="flex items-center justify-between mb-4">
          <div className="text-[10px] font-semibold tracking-wide uppercase px-2 py-1 rounded-full"
            style={{ background: 'rgba(100,116,139,0.12)', color: '#94A3B8', border: '1px solid rgba(100,116,139,0.2)' }}>
            Aborted
          </div>
          <span className="text-[10px] font-mono" style={{ color: 'rgba(255,255,255,0.2)' }}>#{market.id}</span>
        </div>
        <h3 className="text-sm font-semibold leading-snug mb-4 line-clamp-3 flex-grow"
          style={{ color: 'rgba(255,255,255,0.5)' }}>
          {market.question}
        </h3>
        <div className="flex items-center gap-2 rounded-xl px-3 py-2.5"
          style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)' }}>
          <svg className="w-3.5 h-3.5 shrink-0" style={{ color: '#64748B' }} fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" />
          </svg>
          <span className="text-[10px]" style={{ color: 'var(--text-muted)' }}>No participants — market did not progress</span>
        </div>
      </div>
    </div>
  );
}

export function MarketCard({ market }: MarketCardProps) {
  const isAborted = market.phase === 'INFO_COLLECTION'
    && market.participants === 0
    && new Date() > market.decryptAt;
  if (isAborted) return <AbortedCard market={market} />;
  if (market.phase === 'INFO_COLLECTION') return <InfoMarketCard market={market} />;
  if (market.phase === 'TRADING') return <TradingCard market={market} />;
  return <ResolvedCard market={market} />;
}
