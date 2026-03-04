'use client';

import { useMemo } from 'react';
import type { PriceHistoryPoint } from '@/lib/types';

interface PriceChartProps {
  data: PriceHistoryPoint[];
  height?: number;
}

export function PriceChart({ data, height = 200 }: PriceChartProps) {
  const chartData = useMemo(() => {
    if (data.length === 0) return null;

    const prices = data.map(d => d.priceYes);
    const minPrice = Math.min(...prices, 0.1);
    const maxPrice = Math.max(...prices, 0.9);
    const padding = (maxPrice - minPrice) * 0.1 || 0.1;
    const yMin = Math.max(0, minPrice - padding);
    const yMax = Math.min(1, maxPrice + padding);

    const width = 100;
    const xStep = width / Math.max(1, data.length - 1);

    const points = data.map((d, i) => {
      const x = i * xStep;
      const y = height - ((d.priceYes - yMin) / (yMax - yMin)) * height;
      return { x, y, ...d };
    });

    const pathD = points
      .map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`)
      .join(' ');

    const areaD = `${pathD} L ${points[points.length - 1].x} ${height} L 0 ${height} Z`;

    const gridLines = [0.25, 0.5, 0.75].map(ratio => ({
      y: height - ((ratio - yMin) / (yMax - yMin)) * height,
      label: `${((yMin + (yMax - yMin) * ratio) * 100).toFixed(0)}%`,
    }));

    return { points, pathD, areaD, gridLines, yMin, yMax };
  }, [data, height]);

  if (!chartData || data.length === 0) {
    return (
      <div className="bg-chainlink-surface rounded-xl p-4 h-48 flex items-center justify-center">
        <p className="text-chainlink-text-muted text-sm">No price history available</p>
      </div>
    );
  }

  const { points, pathD, areaD, gridLines } = chartData;

  return (
    <div className="bg-chainlink-surface rounded-xl p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-chainlink-text">Price History</h3>
        <div className="flex items-center gap-4 text-xs">
          <div className="flex items-center gap-1.5">
            <div className="w-3 h-0.5 bg-white/60 rounded" />
            <span className="text-chainlink-text-muted">YES</span>
          </div>
          <div className="flex items-center gap-1.5">
            <div className="w-3 h-0.5 bg-red-400 rounded" />
            <span className="text-chainlink-text-muted">NO</span>
          </div>
        </div>
      </div>

      <div className="relative" style={{ height }}>
        <svg
          viewBox={`0 0 100 ${height}`}
          preserveAspectRatio="none"
          className="w-full h-full"
        >
          <defs>
            <linearGradient id="yesGradient" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="rgb(74, 222, 128)" stopOpacity="0.3" />
              <stop offset="100%" stopColor="rgb(74, 222, 128)" stopOpacity="0" />
            </linearGradient>
          </defs>

          {gridLines.map((line, i) => (
            <g key={i}>
              <line
                x1="0"
                y1={line.y}
                x2="100"
                y2={line.y}
                stroke="currentColor"
                strokeOpacity="0.1"
                strokeDasharray="2,2"
              />
            </g>
          ))}

          <path d={areaD} fill="url(#yesGradient)" />
          <path
            d={pathD}
            fill="none"
            stroke="rgb(74, 222, 128)"
            strokeWidth="0.5"
            vectorEffect="non-scaling-stroke"
          />

          {points.slice(-1).map((p, i) => (
            <circle
              key={i}
              cx={p.x}
              cy={p.y}
              r="1"
              fill="rgb(74, 222, 128)"
              className="animate-pulse"
            />
          ))}
        </svg>

        <div className="absolute left-0 top-0 bottom-0 flex flex-col justify-between text-[10px] text-chainlink-text-muted pointer-events-none">
          {gridLines.map((line, i) => (
            <span key={i} style={{ position: 'absolute', top: `${(line.y / height) * 100}%`, transform: 'translateY(-50%)' }}>
              {line.label}
            </span>
          ))}
        </div>
      </div>

      <div className="flex justify-between mt-2 text-xs text-chainlink-text-muted">
        <span>{data.length > 0 ? new Date(data[0].timestamp * 1000).toLocaleDateString() : ''}</span>
        <span>{data.length > 0 ? new Date(data[data.length - 1].timestamp * 1000).toLocaleDateString() : ''}</span>
      </div>

      {points.length > 0 && (
        <div className="mt-3 pt-3 border-t border-chainlink-border/30">
          <div className="flex justify-between items-center">
            <div>
              <span className="text-xs text-chainlink-text-muted">Current YES Price: </span>
              <span className="text-sm font-semibold text-white/90">
                {(points[points.length - 1].priceYes * 100).toFixed(1)}%
              </span>
            </div>
            <div className="text-xs text-chainlink-text-muted">
              {points.length} data point{points.length !== 1 ? 's' : ''}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
