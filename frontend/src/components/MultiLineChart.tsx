'use client';

import { useEffect, useRef, useMemo } from 'react';
import { createChart, ColorType } from 'lightweight-charts';
import type { UTCTimestamp } from 'lightweight-charts';
import type { PriceHistoryPoint } from '@/lib/types';

// Same hue order as OPTION_COLORS in MarketCard.tsx
const LINE_COLORS = [
  'rgba(59,130,246,0.95)',
  'rgba(16,185,129,0.95)',
  'rgba(245,158,11,0.95)',
  'rgba(239,68,68,0.95)',
  'rgba(168,85,247,0.95)',
  'rgba(236,72,153,0.95)',
];

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

export interface MultiLineSeries {
  id: string;
  label: string;
  data: PriceHistoryPoint[];
  /** Live price (0–1) to display in legend — overrides last history point */
  currentPrice?: number;
}

interface MultiLineChartProps {
  series: MultiLineSeries[];
  height?: number;
  endTime?: number;
}

export function MultiLineChart({ series, height = 220, endTime }: MultiLineChartProps) {
  const chartContainerRef = useRef<HTMLDivElement>(null);

  const { seriesData, hasData } = useMemo(() => {
    const nowSec = Math.floor(Date.now() / 1000);
    const targetEnd = endTime ?? nowSec;

    const seriesData = series.map((s, idx) => {
      const sorted = [...s.data].sort((a, b) => a.timestamp - b.timestamp);

      const raw: { time: number; value: number }[] = [];
      let lastTime = -1;
      for (const p of sorted) {
        let time = p.timestamp;
        if (time <= lastTime) time = lastTime + 0.001;
        lastTime = time;
        raw.push({ time, value: p.priceYes * 100 });
      }

      // Extend to endTime — always end at currentPrice if provided, so chart matches the price bar
      if (raw.length > 0) {
        const endValue = s.currentPrice != null ? s.currentPrice * 100 : raw[raw.length - 1].value;
        if (raw[raw.length - 1].time < targetEnd - 1) {
          raw.push({ time: targetEnd, value: endValue });
        } else if (s.currentPrice != null) {
          raw[raw.length - 1] = { time: raw[raw.length - 1].time, value: endValue };
        }
      }

      // Smooth with Catmull-Rom
      const points = catmullRom(raw, 4);

      return {
        id: s.id,
        label: s.label,
        color: LINE_COLORS[idx % LINE_COLORS.length],
        points,
        // Prefer explicit currentPrice (from live submarket state) over last history point
        currentValue: s.currentPrice != null ? s.currentPrice * 100 : raw.length > 0 ? raw[raw.length - 1].value : 50,
      };
    });

    const hasData = seriesData.some((s) => s.points.length > 0);
    return { seriesData, hasData };
  }, [series, endTime]);

  useEffect(() => {
    if (!chartContainerRef.current || !hasData) return;

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

    for (const s of seriesData) {
      if (s.points.length === 0) continue;
      const line = chart.addLineSeries({
        color: s.color,
        lineWidth: 2,
        crosshairMarkerVisible: true,
        crosshairMarkerRadius: 4,
        crosshairMarkerBorderColor: s.color,
        crosshairMarkerBackgroundColor: 'rgba(13,17,23,0.9)',
      });
      line.setData(s.points.map(p => ({ ...p, time: p.time as UTCTimestamp })));
    }

    chart.timeScale().fitContent(); // always fit all data naturally

    return () => chart.remove();
  }, [seriesData, hasData]);

  if (!hasData) {
    return (
      <div
        className="rounded-xl p-4 flex items-center justify-center"
        style={{ height, background: 'rgba(13,17,23,0.6)', border: '1px solid var(--border)' }}
      >
        <p className="text-xs" style={{ color: 'var(--text-muted)' }}>No price history available</p>
      </div>
    );
  }

  return (
    <div
      className="rounded-xl p-4 overflow-hidden"
      style={{ background: 'rgba(13,17,23,0.6)', border: '1px solid var(--border)' }}
    >
      {/* Legend */}
      <div className="flex items-center flex-wrap gap-4 mb-3">
        {seriesData.map((s) => (
          <div key={s.id} className="flex items-center gap-1.5">
            <div className="w-4 h-0.5 rounded" style={{ background: s.color }} />
            <span className="text-xs font-medium" style={{ color: s.color }}>{s.label}</span>
            <span className="text-xs font-mono font-bold text-white/90">
              {s.currentValue.toFixed(1)}%
            </span>
          </div>
        ))}
      </div>

      <div ref={chartContainerRef} style={{ height }} />

      <div className="mt-1.5 text-[9px]" style={{ color: 'rgba(100,116,139,0.4)' }}>
        <span>{series.length} option{series.length !== 1 ? 's' : ''}</span>
      </div>
    </div>
  );
}
