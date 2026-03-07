'use client';

import { useEffect, useRef, useMemo } from 'react';
import { createChart, ColorType } from 'lightweight-charts';
import type { PriceHistoryPoint } from '@/lib/types';

interface CandlestickChartProps {
  data: PriceHistoryPoint[];
  height?: number;
  bucketMinutes?: number;
  startTime?: number;
  endTime?: number;
  tradeCount?: number;
}

/** Catmull-Rom spline interpolation — smooths jagged price lines */
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

export function CandlestickChart({ data, height = 220, bucketMinutes = 30, startTime, endTime, tradeCount }: CandlestickChartProps) {
  const chartContainerRef = useRef<HTMLDivElement>(null);

  const { chartData, currentPrice, changePct, rawCount } = useMemo(() => {
    if (data.length === 0) return { chartData: [] as { time: number; value: number }[], currentPrice: 0.5, changePct: 0, rawCount: 0 };

    const nowSec = Math.floor(Date.now() / 1000);
    const gridEnd = endTime ?? nowSec;
    const windowSec = bucketMinutes * 60;
    const gridStart = gridEnd - windowSec;

    let sorted = [...data].sort((a, b) => a.timestamp - b.timestamp).filter(p => p.timestamp >= gridStart && p.timestamp <= gridEnd);
    if (sorted.length === 0) sorted = [...data].sort((a, b) => a.timestamp - b.timestamp);
    if (sorted.length === 0) return { chartData: [] as { time: number; value: number }[], currentPrice: 0.5, changePct: 0, rawCount: 0 };

    const raw: { time: number; value: number }[] = [];
    let lastTime = -1;
    for (const p of sorted) {
      let time = p.timestamp;
      if (time <= lastTime) time = lastTime + 0.001;
      lastTime = time;
      raw.push({ time, value: p.priceYes * 100 });
    }

    const currentPrice = sorted[sorted.length - 1].priceYes;
    const firstPrice = sorted[0].priceYes;
    const changePct = firstPrice !== 0 ? ((currentPrice - firstPrice) / firstPrice) * 100 : 0;
    const rawCount = raw.length;

    // Extend as flatline to gridEnd if there's a gap (sparse activity)
    if (raw.length > 0 && raw[raw.length - 1].time < gridEnd - 1) {
      raw.push({ time: gridEnd, value: raw[raw.length - 1].value });
    }

    // Smooth the line with Catmull-Rom interpolation
    const chartData = catmullRom(raw, 4);

    return { chartData, currentPrice, changePct, rawCount };
  }, [data, bucketMinutes, startTime, endTime]);

  useEffect(() => {
    if (!chartContainerRef.current || chartData.length === 0) return;

    const chart = createChart(chartContainerRef.current, {
      autoSize: true, // fills container width responsively
      layout: {
        background: { type: ColorType.Solid, color: 'transparent' },
        textColor: 'rgba(107,114,128,0.8)',
        fontFamily: 'inherit',
        fontSize: 11,
      },
      grid: {
        vertLines: { color: 'rgba(255,255,255,0.04)' },
        horzLines: { color: 'rgba(255,255,255,0.06)' },
      },
      rightPriceScale: {
        borderColor: 'rgba(255,255,255,0.1)',
        scaleMargins: { top: 0.1, bottom: 0.1 },
      },
      timeScale: {
        borderColor: 'rgba(255,255,255,0.1)',
        timeVisible: true,
        secondsVisible: false,
      },
      crosshair: {
        vertLine: { color: 'rgba(255,255,255,0.2)' },
        horzLine: { color: 'rgba(255,255,255,0.2)' },
      },
    });

    const lineSeries = chart.addLineSeries({
      color: 'rgba(59,130,246,0.95)',
      lineWidth: 2,
      crosshairMarkerVisible: true,
      crosshairMarkerRadius: 4,
      crosshairMarkerBorderColor: 'rgba(59,130,246,0.95)',
      crosshairMarkerBackgroundColor: 'rgba(13,17,23,0.9)',
    });

    lineSeries.setData(chartData);
    chart.timeScale().fitContent(); // always fit all data naturally

    return () => chart.remove();
  }, [chartData]);

  if (data.length === 0) {
    return (
      <div className="rounded-xl p-4 flex items-center justify-center"
        style={{ height, background: 'rgba(13,17,23,0.6)', border: '1px solid var(--border)' }}>
        <p className="text-xs" style={{ color: 'var(--text-muted)' }}>No price history available</p>
      </div>
    );
  }

  const positive = changePct >= 0;

  return (
    <div className="rounded-xl p-4 overflow-hidden" style={{ background: 'rgba(13,17,23,0.6)', border: '1px solid var(--border)' }}>
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium" style={{ color: 'var(--text-muted)' }}>YES price</span>
          <span className="text-sm font-bold font-mono text-white">
            {(currentPrice * 100).toFixed(3)}%
          </span>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs font-mono px-2 py-0.5 rounded-full"
            style={{
              background: positive ? 'rgba(16,185,129,0.12)' : 'rgba(239,68,68,0.12)',
              color: positive ? 'rgba(255,255,255,0.9)' : 'var(--text-muted)',
              border: `1px solid ${positive ? 'rgba(16,185,129,0.2)' : 'rgba(239,68,68,0.2)'}`,
            }}>
            {positive ? '+' : ''}{changePct.toFixed(3)}%
          </span>
          <div className="flex items-center gap-1 text-[10px]" style={{ color: 'var(--text-muted)' }}>
            <div className="w-2.5 h-0.5 rounded" style={{ background: 'rgba(255,255,255,0.6)' }} />
            YES
          </div>
        </div>
      </div>

      <div ref={chartContainerRef} style={{ height }} />

      <div className="mt-1.5 flex items-center justify-between text-[9px]" style={{ color: 'rgba(100,116,139,0.4)' }}>
        <span>last {bucketMinutes === 60 ? '1h' : bucketMinutes === 240 ? '4h' : `${bucketMinutes}m`} · {rawCount} trades</span>
        {tradeCount != null && tradeCount > 0 && <span>{tradeCount} total</span>}
      </div>
    </div>
  );
}
