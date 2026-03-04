'use client';

import React, { useMemo, useState } from 'react';

// Phase 1: score = 1000 - |yesPercent - consensus|, weight = score²
export function ConsensusBonusViz() {
  const [yourPrediction, setYourPrediction] = useState(70);
  const [consensus, setConsensus] = useState(65);

  const dist = Math.abs(yourPrediction * 10 - consensus * 10); // 0-1000 bp
  const score = Math.max(0, 1000 - dist);
  const weight = (score / 1000) ** 2;

  const curvePoints = useMemo(() => {
    const pts: { x: number; y: number }[] = [];
    for (let x = 0; x <= 100; x += 2) {
      const d = Math.abs(x * 10 - consensus * 10);
      const s = Math.max(0, 1000 - d);
      pts.push({ x, y: (s / 1000) ** 2 });
    }
    return pts;
  }, [consensus]);

  const svgW = 200;
  const svgH = 100;
  const pad = 20;

  return (
    <div className="rounded-lg p-4" style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.12)' }}>
      <div className="text-[10px] font-bold uppercase tracking-widest mb-3 text-white/90">
        Phase 1 · Consensus Bonus
      </div>
      <p className="text-xs mb-3" style={{ color: 'var(--text-muted)' }}>
        Closer to consensus → higher score → more shares (weight = score²)
      </p>

      <div className="space-y-3">
        <div>
          <label className="text-xs block mb-1" style={{ color: 'var(--text-muted)' }}>
            Consensus: {consensus}% yes
          </label>
          <input
            type="range"
            min={0}
            max={100}
            value={consensus}
            onChange={(e) => setConsensus(Number(e.target.value))}
            className="w-full h-1.5 rounded-full"
            style={{ accentColor: 'rgba(255,255,255,0.6)' }}
          />
        </div>
        <div>
          <label className="text-xs block mb-1" style={{ color: 'var(--text-muted)' }}>
            Your prediction: {yourPrediction}% yes
          </label>
          <input
            type="range"
            min={0}
            max={100}
            value={yourPrediction}
            onChange={(e) => setYourPrediction(Number(e.target.value))}
            className="w-full h-1.5 rounded-full"
            style={{ accentColor: 'rgba(255,255,255,0.6)' }}
          />
        </div>
      </div>

      <div className="mt-3 relative" style={{ height: svgH + pad * 2 }}>
        <svg width="100%" height={svgH + pad * 2} viewBox={`0 0 ${svgW + pad * 2} ${svgH + pad * 2}`} preserveAspectRatio="xMidYMid meet">
          <defs>
            <linearGradient id="phase1Grad" x1="0" y1="1" x2="0" y2="0">
              <stop offset="0" stopColor="rgba(255,255,255,0.15)" />
              <stop offset="1" stopColor="rgba(255,255,255,0)" />
            </linearGradient>
          </defs>
          <line x1={pad} y1={svgH + pad} x2={svgW + pad} y2={svgH + pad} stroke="rgba(255,255,255,0.2)" strokeWidth="1" />
          <line x1={pad} y1={pad} x2={pad} y2={svgH + pad} stroke="rgba(255,255,255,0.2)" strokeWidth="1" />
          <path
            d={`M ${pad} ${svgH + pad} L ${curvePoints.map((p) => `${pad + (p.x / 100) * svgW} ${pad + svgH - p.y * svgH}`).join(' L ')} L ${svgW + pad} ${svgH + pad} Z`}
            fill="url(#phase1Grad)"
            stroke="rgba(255,255,255,0.5)"
            strokeWidth="1.5"
          />
          <line
            x1={pad + (consensus / 100) * svgW}
            y1={pad}
            x2={pad + (consensus / 100) * svgW}
            y2={svgH + pad}
            stroke="rgba(255,255,255,0.4)"
            strokeWidth="1"
            strokeDasharray="4 2"
          />
          <circle
            cx={pad + (yourPrediction / 100) * svgW}
            cy={pad + svgH - weight * svgH}
            r="5"
            fill="rgba(255,255,255,0.9)"
            stroke="rgba(255,255,255,0.3)"
            strokeWidth="2"
          />
        </svg>
      </div>

      <div className="mt-2 text-xs" style={{ color: 'var(--text-muted)' }}>
        Score: {score}/1000 · Weight: {(weight * 100).toFixed(1)}%
      </div>
    </div>
  );
}
