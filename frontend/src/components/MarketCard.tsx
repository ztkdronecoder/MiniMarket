'use client';

import Link from 'next/link';
import type { Market } from '@/lib/types';
import { formatDistanceToNow } from '@/lib/utils';
import { SubmarketChip } from './SubmarketCard';

interface MarketCardProps {
  market: Market;
}

function InfoMarketCard({ market }: MarketCardProps) {
  return (
    <Link href={`/market/${market.id}`} className="block group">
      <div className="card-infomarket h-full flex flex-col transition-all duration-300">
        {/* Header */}
        <div className="flex items-start justify-between mb-4">
          <div className="badge-infomarket gap-1.5">
            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
            </svg>
            InfoMarket
          </div>
          <div className="text-xs font-mono px-2 py-0.5 rounded"
            style={{ background: 'rgba(255,255,255,0.04)', color: 'var(--text-muted)' }}>
            #{market.id}
          </div>
        </div>

        {/* Question */}
        <h3 className="text-sm font-semibold mb-5 line-clamp-2 flex-grow leading-relaxed transition-colors"
          style={{ color: 'rgba(255,255,255,0.85)' }}>
          {market.question}
        </h3>

        {/* Encrypted indicator */}
        <div className="flex items-center justify-center gap-2 py-3 rounded-xl mb-4"
          style={{
            background: 'rgba(124,58,237,0.08)',
            border: '1px solid rgba(124,58,237,0.15)',
          }}>
          <svg className="w-4 h-4 animate-pulse" style={{ color: '#B78BFF' }} fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
          </svg>
          <span className="text-xs font-medium" style={{ color: '#B78BFF' }}>Predictions encrypted</span>
        </div>

        {/* Stats grid */}
        <div className="grid grid-cols-2 gap-2 text-xs mb-4">
          <div className="rounded-lg p-2.5" style={{ background: 'rgba(255,255,255,0.03)' }}>
            <div className="mb-1" style={{ color: 'var(--text-muted)' }}>Participants</div>
            <div className="font-mono font-semibold text-white">
              {market.participants}<span style={{ color: 'var(--text-muted)' }}> / 5</span>
            </div>
          </div>
          <div className="rounded-lg p-2.5" style={{ background: 'rgba(255,255,255,0.03)' }}>
            <div className="mb-1" style={{ color: 'var(--text-muted)' }}>Ticket</div>
            <div className="font-mono font-semibold text-white">{market.ticketCost}</div>
          </div>
        </div>

        {/* Submarket chips — show if multi-option */}
        {market.submarkets.length > 1 && (
          <div className="flex flex-wrap gap-1.5 mb-3">
            {market.submarkets.map((sm) => (
              <SubmarketChip key={sm.id} submarket={sm} />
            ))}
          </div>
        )}

        {/* Drand countdown */}
        <div className="pt-3 border-t flex items-center justify-between text-xs"
          style={{ borderColor: 'rgba(124,58,237,0.12)' }}>
          <div className="flex items-center gap-1.5" style={{ color: 'var(--text-muted)' }}>
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            Decrypts in
          </div>
          <span className="font-mono font-medium" style={{ color: '#B78BFF' }}>
            {formatDistanceToNow(market.decryptAt)}
          </span>
        </div>
      </div>
    </Link>
  );
}

function PredictionMarketCard({ market }: MarketCardProps) {
  const yesPercent = market.priceYes * 100;
  const noPercent = 100 - yesPercent;

  return (
    <Link href={`/market/${market.id}`} className="block group">
      <div className="card-predmarket h-full flex flex-col transition-all duration-300">
        {/* Header */}
        <div className="flex items-start justify-between mb-4">
          <div className="badge-trading gap-1.5">
            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
            </svg>
            Prediction Market
          </div>
          <div className="text-xs font-mono px-2 py-0.5 rounded"
            style={{ background: 'rgba(255,255,255,0.04)', color: 'var(--text-muted)' }}>
            #{market.id}
          </div>
        </div>

        {/* Question */}
        <h3 className="text-sm font-semibold mb-4 line-clamp-2 flex-grow leading-relaxed"
          style={{ color: 'rgba(255,255,255,0.85)' }}>
          {market.question}
        </h3>

        {/* YES/NO prices */}
        <div className="mb-3">
          <div className="flex justify-between text-xs mb-2">
            <span className="font-semibold" style={{ color: '#34D399' }}>YES {yesPercent.toFixed(1)}%</span>
            <span className="font-semibold" style={{ color: '#F87171' }}>{noPercent.toFixed(1)}% NO</span>
          </div>
          <div className="progress-bar" style={{ height: '6px' }}>
            <div className="progress-fill-yes" style={{ width: `${yesPercent}%` }} />
          </div>
        </div>

        {/* Submarket chips — show if multi-option */}
        {market.submarkets.length > 1 && (
          <div className="flex flex-wrap gap-1.5 mb-3">
            {market.submarkets.map((sm) => (
              <SubmarketChip key={sm.id} submarket={sm} />
            ))}
          </div>
        )}

        {/* Stats */}
        <div className="grid grid-cols-2 gap-2 text-xs mb-4">
          <div className="rounded-lg p-2.5" style={{ background: 'rgba(255,255,255,0.03)' }}>
            <div className="mb-1" style={{ color: 'var(--text-muted)' }}>Total Pool</div>
            <div className="font-mono font-semibold text-white">{market.totalStaked}</div>
          </div>
          <div className="rounded-lg p-2.5" style={{ background: 'rgba(255,255,255,0.03)' }}>
            <div className="mb-1" style={{ color: 'var(--text-muted)' }}>Participants</div>
            <div className="font-mono font-semibold text-white">{market.participants}</div>
          </div>
        </div>

        {/* Consensus (single-option markets) */}
        {market.submarkets.length <= 1 && market.consensusOutcome && (
          <div className="pt-3 border-t flex items-center justify-between text-xs"
            style={{ borderColor: 'rgba(16,185,129,0.12)' }}>
            <span style={{ color: 'var(--text-muted)' }}>Agent Consensus</span>
            <span className="font-bold"
              style={{ color: market.consensusOutcome === 'YES' ? '#34D399' : '#F87171' }}>
              {market.consensusOutcome}
            </span>
          </div>
        )}
      </div>
    </Link>
  );
}

function ResolvedCard({ market }: MarketCardProps) {
  return (
    <Link href={`/market/${market.id}`} className="block group">
      <div className="card-glow h-full flex flex-col opacity-80 hover:opacity-100 transition-all duration-300">
        <div className="flex items-start justify-between mb-4">
          <div className="badge-resolved gap-1.5">
            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
            Resolved
          </div>
          <div className="text-xs font-mono px-2 py-0.5 rounded"
            style={{ background: 'rgba(255,255,255,0.04)', color: 'var(--text-muted)' }}>
            #{market.id}
          </div>
        </div>

        <h3 className="text-sm font-semibold mb-4 line-clamp-2 flex-grow leading-relaxed"
          style={{ color: 'rgba(255,255,255,0.7)' }}>
          {market.question}
        </h3>

        <div className="grid grid-cols-2 gap-2 text-xs mb-4">
          <div className="rounded-lg p-2.5" style={{ background: 'rgba(255,255,255,0.03)' }}>
            <div className="mb-1" style={{ color: 'var(--text-muted)' }}>Total Pool</div>
            <div className="font-mono font-semibold text-white">{market.totalStaked}</div>
          </div>
          <div className="rounded-lg p-2.5" style={{ background: 'rgba(255,255,255,0.03)' }}>
            <div className="mb-1" style={{ color: 'var(--text-muted)' }}>Participants</div>
            <div className="font-mono font-semibold text-white">{market.participants}</div>
          </div>
        </div>

        {/* Submarket chips — show if multi-option */}
        {market.submarkets.length > 1 && (
          <div className="flex flex-wrap gap-1.5 mb-3">
            {market.submarkets.map((sm) => (
              <SubmarketChip key={sm.id} submarket={sm} />
            ))}
          </div>
        )}

        {market.submarkets.length <= 1 && market.resolvedOutcome && (
          <div className="pt-3 border-t flex items-center justify-between text-xs"
            style={{ borderColor: 'rgba(255,255,255,0.06)' }}>
            <span style={{ color: 'var(--text-muted)' }}>Final Outcome</span>
            <span className="font-bold px-2.5 py-0.5 rounded-full text-xs"
              style={{
                background: market.resolvedOutcome === 'YES' ? 'rgba(16,185,129,0.15)' : 'rgba(239,68,68,0.15)',
                color: market.resolvedOutcome === 'YES' ? '#34D399' : '#F87171',
              }}>
              {market.resolvedOutcome}
            </span>
          </div>
        )}
      </div>
    </Link>
  );
}

export function MarketCard({ market }: MarketCardProps) {
  if (market.phase === 'INFO_COLLECTION') return <InfoMarketCard market={market} />;
  if (market.phase === 'TRADING') return <PredictionMarketCard market={market} />;
  return <ResolvedCard market={market} />;
}
