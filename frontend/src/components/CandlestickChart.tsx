'use client';

import { useMemo } from 'react';
import type { PriceHistoryPoint } from '@/lib/types';

interface CandlestickChartProps {
  data: PriceHistoryPoint[];
  height?: number;
  bucketMinutes?: number;
  startTime?: number; // unix seconds — chart start (defaults to first data point)
  endTime?: number;   // unix seconds — chart end (defaults to now)
}

interface Candle {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  bullish: boolean;
  empty?: boolean;
}

const MAX_CANDLES = 200;

function buildCandles(
  data: PriceHistoryPoint[],
  bucketMinutes: number,
  startTime?: number,
  endTime?: number,
): Candle[] {
  if (data.length === 0) return [];

  const nowSec = Math.floor(Date.now() / 1000);
  const bucketSec = bucketMinutes * 60;

  const gridStart = startTime ?? data[0].timestamp;
  const gridEnd = endTime ?? nowSec;

  const firstBucket = Math.floor(gridStart / bucketSec) * bucketSec;
  const lastBucket = Math.floor(gridEnd / bucketSec) * bucketSec;

  // Group actual data into buckets
  const groups = new Map<number, number[]>();
  for (const pt of data) {
    const bucket = Math.floor(pt.timestamp / bucketSec) * bucketSec;
    if (!groups.has(bucket)) groups.set(bucket, []);
    groups.get(bucket)!.push(pt.priceYes);
  }

  // Build full grid — empty slots carry forward the previous close
  const all: Candle[] = [];
  let prevClose = 0.5; // AMM starts at 50/50

  for (let ts = firstBucket; ts <= lastBucket; ts += bucketSec) {
    const prices = groups.get(ts);
    if (prices && prices.length > 0) {
      const open = prices[0];
      const close = prices[prices.length - 1];
      const high = Math.max(...prices);
      const low = Math.min(...prices);
      all.push({ timestamp: ts, open, high, low, close, bullish: close >= open });
      prevClose = close;
    } else {
      // Empty period — flat dash at last known price
      all.push({
        timestamp: ts,
        open: prevClose, high: prevClose, low: prevClose, close: prevClose,
        bullish: true,
        empty: true,
      });
    }
  }

  // Cap at MAX_CANDLES (keep most recent)
  return all.length > MAX_CANDLES ? all.slice(all.length - MAX_CANDLES) : all;
}

function formatShortTime(ts: number): string {
  const d = new Date(ts * 1000);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) {
    return d.toLocaleString('en', { hour: '2-digit', minute: '2-digit', hour12: false });
  }
  return d.toLocaleString('en', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false });
}

export function CandlestickChart({ data, height = 220, bucketMinutes = 15, startTime, endTime }: CandlestickChartProps) {
  const { candles, yMin, yMax, currentPrice, change24h } = useMemo(() => {
    if (data.length === 0) return { candles: [], yMin: 0, yMax: 1, currentPrice: 0.5, change24h: 0 };

    const rawCandles = buildCandles(data, bucketMinutes, startTime, endTime);
    if (rawCandles.length === 0) return { candles: [], yMin: 0, yMax: 1, currentPrice: 0.5, change24h: 0 };

    // Price range based only on real (non-empty) candles
    const realCandles = rawCandles.filter(c => !c.empty);
    if (realCandles.length === 0) return { candles: rawCandles, yMin: 0.4, yMax: 0.6, currentPrice: 0.5, change24h: 0 };

    const allPrices = realCandles.flatMap(c => [c.high, c.low]);
    const rawMin = Math.min(...allPrices);
    const rawMax = Math.max(...allPrices);
    const pad = (rawMax - rawMin) * 0.15 || 0.05;
    const yMin = Math.max(0, rawMin - pad);
    const yMax = Math.min(1, rawMax + pad);

    const lastReal = realCandles[realCandles.length - 1];
    const firstReal = realCandles[0];
    const currentPrice = lastReal.close;
    const change24h = firstReal.open !== 0
      ? ((currentPrice - firstReal.open) / firstReal.open) * 100
      : 0;

    return { candles: rawCandles, yMin, yMax, currentPrice, change24h };
  }, [data, bucketMinutes, startTime, endTime]);

  if (data.length === 0) {
    return (
      <div className="rounded-xl p-4 flex items-center justify-center"
        style={{ height, background: 'rgba(13,17,23,0.6)', border: '1px solid var(--border)' }}>
        <p className="text-xs" style={{ color: 'var(--text-muted)' }}>No price history available</p>
      </div>
    );
  }

  const chartW = 100;
  const candleW = chartW / candles.length;
  const bodyW = Math.max(candleW * 0.55, 0.3);
  const wickW = 0.15;

  const toY = (price: number) => height - ((price - yMin) / (yMax - yMin)) * height;
  const toX = (i: number) => (i + 0.5) * candleW;

  const gridPrices = [0.25, 0.5, 0.75].map(r => yMin + (yMax - yMin) * r);

  // X-axis: ~5 evenly spaced time labels
  const labelCount = Math.min(5, candles.length);
  const labelIndices = labelCount <= 1
    ? [0]
    : Array.from({ length: labelCount }, (_, i) =>
        Math.round((i / (labelCount - 1)) * (candles.length - 1))
      );

  const positive = change24h >= 0;

  return (
    <div className="rounded-xl p-4" style={{ background: 'rgba(13,17,23,0.6)', border: '1px solid var(--border)' }}>
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium" style={{ color: 'var(--text-muted)' }}>YES price</span>
          <span className="text-sm font-bold font-mono text-white">
            {(currentPrice * 100).toFixed(1)}%
          </span>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs font-mono px-2 py-0.5 rounded-full"
            style={{
              background: positive ? 'rgba(16,185,129,0.12)' : 'rgba(239,68,68,0.12)',
              color: positive ? '#34D399' : '#F87171',
              border: `1px solid ${positive ? 'rgba(16,185,129,0.2)' : 'rgba(239,68,68,0.2)'}`,
            }}>
            {positive ? '+' : ''}{change24h.toFixed(2)}%
          </span>
          <div className="flex items-center gap-1 text-[10px]" style={{ color: 'var(--text-muted)' }}>
            <div className="w-2.5 h-0.5 rounded" style={{ background: '#10B981' }} />
            YES
          </div>
        </div>
      </div>

      {/* Chart area */}
      <div className="relative" style={{ height }}>
        <svg viewBox={`0 0 100 ${height}`} preserveAspectRatio="none" className="w-full h-full">
          {/* Grid lines */}
          {gridPrices.map((price, i) => (
            <line key={i}
              x1="0" y1={toY(price)} x2="100" y2={toY(price)}
              stroke="rgba(255,255,255,0.05)"
              strokeWidth="0.3"
              strokeDasharray="2,3"
              vectorEffect="non-scaling-stroke"
            />
          ))}

          {/* 50% reference */}
          <line x1="0" y1={toY(0.5)} x2="100" y2={toY(0.5)}
            stroke="rgba(255,255,255,0.1)"
            strokeWidth="0.3"
            strokeDasharray="4,4"
            vectorEffect="non-scaling-stroke"
          />

          {/* Candles & dashes */}
          {candles.map((c, i) => {
            const x = toX(i);

            if (c.empty) {
              // Flat dash — no trading in this period
              return (
                <line key={i}
                  x1={x - bodyW * 0.7} y1={toY(c.close)}
                  x2={x + bodyW * 0.7} y2={toY(c.close)}
                  stroke="rgba(100,116,139,0.3)"
                  strokeWidth="0.4"
                  vectorEffect="non-scaling-stroke"
                />
              );
            }

            const openY = toY(c.open);
            const closeY = toY(c.close);
            const highY = toY(c.high);
            const lowY = toY(c.low);
            const bodyTop = Math.min(openY, closeY);
            const bodyBot = Math.max(openY, closeY);
            const bodyHeight = Math.max(bodyBot - bodyTop, 0.5);
            const color = c.bullish ? '#10B981' : '#EF4444';
            const colorDim = c.bullish ? 'rgba(16,185,129,0.5)' : 'rgba(239,68,68,0.5)';

            return (
              <g key={i}>
                <line x1={x} y1={highY} x2={x} y2={lowY}
                  stroke={colorDim} strokeWidth={wickW} vectorEffect="non-scaling-stroke"
                />
                <rect
                  x={x - bodyW / 2} y={bodyTop}
                  width={bodyW} height={bodyHeight}
                  fill={color} fillOpacity={0.8} rx="0.3"
                />
              </g>
            );
          })}
        </svg>

        {/* Y axis labels */}
        <div className="absolute left-0 top-0 bottom-0 pointer-events-none">
          {gridPrices.map((price, i) => (
            <span key={i}
              className="absolute text-[9px] font-mono"
              style={{
                top: `${((height - toY(price)) / height) * 100}%`,
                transform: 'translateY(-50%)',
                color: 'rgba(107,114,128,0.6)',
                left: '2px',
              }}>
              {(price * 100).toFixed(0)}%
            </span>
          ))}
        </div>
      </div>

      {/* X-axis time labels */}
      {candles.length > 0 && (
        <div className="relative mt-1.5" style={{ height: 14 }}>
          {labelIndices.map((candleIdx, i) => {
            const c = candles[candleIdx];
            const pct = ((candleIdx + 0.5) / candles.length) * 100;
            const isFirst = i === 0;
            const isLast = i === labelIndices.length - 1;
            return (
              <span key={i}
                className="absolute text-[9px] font-mono"
                style={{
                  left: `${pct}%`,
                  transform: isFirst ? 'none' : isLast ? 'translateX(-100%)' : 'translateX(-50%)',
                  color: 'rgba(100,116,139,0.55)',
                  whiteSpace: 'nowrap',
                  top: 0,
                }}>
                {formatShortTime(c.timestamp)}
              </span>
            );
          })}
        </div>
      )}

      {/* Footer meta */}
      <div className="mt-1.5 flex items-center justify-between text-[9px]" style={{ color: 'rgba(100,116,139,0.4)' }}>
        <span>{candles.length} × {bucketMinutes}m slots</span>
        <div className="flex items-center gap-1">
          <div className="w-3 h-px" style={{ background: 'rgba(100,116,139,0.35)' }} />
          <span>no trades</span>
        </div>
      </div>
    </div>
  );
}
