'use client';

import Link from 'next/link';
import type { Submarket } from '@/lib/types';

interface SubmarketCardProps {
  submarket: Submarket;
  /** If true, renders a compact chip (for MarketCard list) instead of full card */
  compact?: boolean;
}

function PhaseBadge({ phase }: { phase: Submarket['phase'] }) {
  if (phase === 'INFO_COLLECTION') {
    return (
      <span className="text-[10px] px-1.5 py-0.5 rounded font-medium"
        style={{ background: 'rgba(255,255,255,0.08)', color: 'rgba(255,255,255,0.9)' }}>
        LOCKED
      </span>
    );
  }
  if (phase === 'TRADING') {
    return (
      <span className="text-[10px] px-1.5 py-0.5 rounded font-medium"
        style={{ background: 'rgba(255,255,255,0.08)', color: 'rgba(255,255,255,0.9)' }}>
        LIVE
      </span>
    );
  }
  return (
    <span className="text-[10px] px-1.5 py-0.5 rounded font-medium"
      style={{ background: 'rgba(255,255,255,0.08)', color: 'rgba(255,255,255,0.9)' }}>
      RESOLVED
    </span>
  );
}

/** Compact chip shown on the MarketCard listing */
export function SubmarketChip({ submarket }: { submarket: Submarket }) {
  const yesPercent = submarket.priceYes * 100;

  return (
    <div className="flex items-center gap-2 rounded-lg px-2.5 py-1.5"
      style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)' }}>
      <span className="text-[10px] font-medium truncate max-w-[7rem]"
        style={{ color: 'rgba(255,255,255,0.6)' }}>
        {submarket.optionLabel ?? `Option ${submarket.optionIndex}`}
      </span>
      {submarket.phase === 'INFO_COLLECTION' ? (
        <PhaseBadge phase="INFO_COLLECTION" />
      ) : submarket.resolvedOutcome ? (
        <span className="text-[10px] px-1.5 py-0.5 rounded font-bold"
          style={{
            background: submarket.resolvedOutcome === 'YES' ? 'rgba(255,255,255,0.1)' : 'rgba(255,255,255,0.06)',
            color: submarket.resolvedOutcome === 'YES' ? 'rgba(255,255,255,0.9)' : 'var(--text-muted)',
          }}>
          {submarket.resolvedOutcome}
        </span>
      ) : (
        <span className="text-[10px] font-bold font-mono"
          style={{ color: 'rgba(255,255,255,0.9)' }}>
          {yesPercent.toFixed(0)}%
        </span>
      )}
    </div>
  );
}

/** Full card linked to submarket detail */
export function SubmarketCard({ submarket, compact }: SubmarketCardProps) {
  const yesPercent = submarket.priceYes * 100;
  const href = `/market/${submarket.parentMarketId}/submarket/${submarket.optionIndex}`;

  if (compact) {
    return <SubmarketChip submarket={submarket} />;
  }

  return (
    <Link href={href} className="block group">
      <div className="rounded-xl p-4 flex flex-col gap-3 transition-all duration-200"
        style={{
          background: 'rgba(13,17,23,0.7)',
          border: '1px solid rgba(33,41,58,0.7)',
        }}>
        {/* Header */}
        <div className="flex items-start justify-between gap-2">
          <span className="text-xs font-medium leading-snug"
            style={{ color: 'rgba(255,255,255,0.8)' }}>
            {submarket.optionLabel ?? `Option ${submarket.optionIndex}`}
          </span>
          <PhaseBadge phase={submarket.phase} />
        </div>

        {/* Price bar */}
        {submarket.phase !== 'INFO_COLLECTION' ? (
          <>
            <div>
              <div className="flex justify-between text-[10px] mb-1.5">
                <span className="font-semibold text-white/90">YES {yesPercent.toFixed(1)}%</span>
                <span className="font-semibold" style={{ color: 'var(--text-muted)' }}>{(100 - yesPercent).toFixed(1)}% NO</span>
              </div>
              <div className="rounded-full overflow-hidden flex" style={{ height: '4px' }}>
                <div className="h-full transition-[width] duration-500" style={{ width: `${yesPercent}%`, background: 'linear-gradient(90deg, #2563EB, #60A5FA)' }} />
                <div className="h-full transition-[width] duration-500" style={{ width: `${100 - yesPercent}%`, background: 'linear-gradient(90deg, #DC2626, #F87171)' }} />
              </div>
            </div>
            {/* Outcome badge */}
            {submarket.resolvedOutcome && (
              <div className="flex items-center justify-between text-[10px]">
                <span style={{ color: 'var(--text-muted)' }}>Outcome</span>
                <span className="font-bold px-2 py-0.5 rounded-full"
                  style={{
                    background: submarket.resolvedOutcome === 'YES' ? 'rgba(255,255,255,0.1)' : 'rgba(255,255,255,0.06)',
                    color: submarket.resolvedOutcome === 'YES' ? 'rgba(255,255,255,0.9)' : 'var(--text-muted)',
                  }}>
                  {submarket.resolvedOutcome}
                </span>
              </div>
            )}
            {/* Consensus */}
            {!submarket.resolvedOutcome && submarket.consensusOutcome && (
              <div className="flex items-center justify-between text-[10px]">
                <span style={{ color: 'var(--text-muted)' }}>Consensus</span>
                <span className="font-bold"
                  style={{ color: submarket.consensusOutcome === 'YES' ? 'rgba(255,255,255,0.9)' : 'var(--text-muted)' }}>
                  {submarket.consensusOutcome}
                </span>
              </div>
            )}
          </>
        ) : (
          <div className="flex items-center gap-1.5 text-[10px]" style={{ color: 'var(--text-muted)' }}>
            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
            </svg>
            Predictions encrypted
          </div>
        )}
      </div>
    </Link>
  );
}
