'use client';

import React, { useMemo, useState } from 'react';

// Phase 2: wrongConfidence = bet on losing side; penalty if > 60%; safe zone 40-60%. Creator earns from penalties when outcome is NO and you're outside 40-60 on wrong side.
export function ConfidencePenaltyViz() {
  const [yourPrediction, setYourPrediction] = useState(70);
  const [outcome, setOutcome] = useState<'YES' | 'NO'>('NO');

  const wrongConfidence = outcome === 'NO' ? yourPrediction * 10 : (100 - yourPrediction) * 10;
  // Safe zone 40-60%: no penalty. Penalty only when >60% on losing side. Scales quadratically.
  const linearPart = wrongConfidence <= 600 ? 0 : Math.min(1, (wrongConfidence - 600) / 400);
  const penaltyFactor = linearPart * linearPart;
  const payoutPercent = (1 - penaltyFactor) * 100;
  const creatorEarns = outcome === 'NO' && yourPrediction > 60 ? penaltyFactor * 100 : outcome === 'YES' && yourPrediction < 40 ? penaltyFactor * 100 : 0;

  const curvePoints = useMemo(() => {
    const pts: { x: number; y: number }[] = [];
    for (let x = 0; x <= 100; x += 2) {
      const wc = outcome === 'NO' ? x * 10 : (100 - x) * 10;
      const lp = wc <= 600 ? 0 : Math.min(1, (wc - 600) / 400);
      const pf = lp * lp;
      pts.push({ x, y: 1 - pf });
    }
    return pts;
  }, [outcome]);

  const svgW = 200;
  const svgH = 100;
  const pad = 20;

  return (
    <div className="rounded-lg p-4" style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.12)' }}>
      <div className="text-[10px] font-bold uppercase tracking-widest mb-3 text-white/90">
        Phase 2 · Confidence Penalty
      </div>
      <p className="text-xs mb-3" style={{ color: 'var(--text-muted)' }}>
        Penalty scales quadratically: 70% wrong pays some; 80% wrong pays disproportionately more. Safe zone: 40–60%.
      </p>

      <div className="space-y-3">
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
        <div className="relative" style={{ height: svgH + pad * 2 }}>
          <svg width="100%" height={svgH + pad * 2} viewBox={`0 0 ${svgW + pad * 2} ${svgH + pad * 2}`} preserveAspectRatio="xMidYMid meet">
            <defs>
              <linearGradient id="phase2Grad" x1="0" y1="1" x2="0" y2="0">
                <stop offset="0" stopColor="rgba(255,255,255,0.15)" />
                <stop offset="1" stopColor="rgba(255,255,255,0)" />
              </linearGradient>
            </defs>
            <line x1={pad} y1={svgH + pad} x2={svgW + pad} y2={svgH + pad} stroke="rgba(255,255,255,0.2)" strokeWidth="1" />
            <line x1={pad} y1={pad} x2={pad} y2={svgH + pad} stroke="rgba(255,255,255,0.2)" strokeWidth="1" />
            <rect x={pad + 0.4 * svgW} y={pad} width={0.2 * svgW} height={svgH} fill="rgba(255,255,255,0.08)" stroke="rgba(255,255,255,0.25)" strokeWidth="1" strokeDasharray="2 2" />
            <path
              d={`M ${pad} ${pad + svgH} L ${curvePoints.map((p) => `${pad + (p.x / 100) * svgW} ${pad + svgH - p.y * svgH}`).join(' L ')} L ${svgW + pad} ${pad + svgH} Z`}
              fill="url(#phase2Grad)"
              stroke="rgba(255,255,255,0.5)"
              strokeWidth="1.5"
            />
            <line
              x1={pad + (yourPrediction / 100) * svgW}
              y1={pad}
              x2={pad + (yourPrediction / 100) * svgW}
              y2={svgH + pad}
              stroke="rgba(255,255,255,0.4)"
              strokeWidth="1"
              strokeDasharray="4 2"
            />
            <circle
              cx={pad + (yourPrediction / 100) * svgW}
              cy={pad + svgH - (1 - penaltyFactor) * svgH}
              r="5"
              fill="rgba(255,255,255,0.9)"
              stroke="rgba(255,255,255,0.3)"
              strokeWidth="2"
            />
          </svg>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 text-xs" style={{ color: 'var(--text-muted)' }}>
          <div className="flex items-center gap-3">
            <span>Outcome:</span>
            <div className="flex gap-1.5">
              <button
                type="button"
                onClick={() => setOutcome('YES')}
                className="py-1 px-2.5 text-xs font-medium rounded transition-colors"
                style={{
                  background: outcome === 'YES' ? 'rgba(255,255,255,0.12)' : 'rgba(255,255,255,0.04)',
                  color: outcome === 'YES' ? 'rgba(255,255,255,0.95)' : 'var(--text-muted)',
                  border: '1px solid rgba(255,255,255,0.15)',
                }}
              >
                YES
              </button>
              <button
                type="button"
                onClick={() => setOutcome('NO')}
                className="py-1 px-2.5 text-xs font-medium rounded transition-colors"
                style={{
                  background: outcome === 'NO' ? 'rgba(255,255,255,0.12)' : 'rgba(255,255,255,0.04)',
                  color: outcome === 'NO' ? 'rgba(255,255,255,0.95)' : 'var(--text-muted)',
                  border: '1px solid rgba(255,255,255,0.15)',
                }}
              >
                NO
              </button>
            </div>
            {creatorEarns > 0 && (
              <span className="text-white/90">Creator earns {creatorEarns.toFixed(0)}% from your penalty</span>
            )}
          </div>
          <div className="flex items-center gap-3">
            <span>Payout: {payoutPercent.toFixed(0)}%{penaltyFactor > 0 && ` · Penalty: ${(penaltyFactor * 100).toFixed(0)}%`}</span>
            <span className="text-[10px] opacity-70">Safe zone: 40–60%</span>
          </div>
        </div>
      </div>
    </div>
  );
}
