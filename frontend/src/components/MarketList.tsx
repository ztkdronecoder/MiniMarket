'use client';

import { useState, useMemo, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { MarketCard } from './MarketCard';
import { getMarkets } from '@/lib/marketApi';
import type { MarketPhase, Market } from '@/lib/types';

const TAB_LABELS: Record<MarketPhase | 'ALL', string> = {
  ALL: 'All Markets',
  INFO_COLLECTION: 'InfoMarket',
  TRADING: 'Prediction Market',
  RESOLVED: 'Resolved',
};

const TAB_COLORS: Record<MarketPhase | 'ALL', { active: string; dot?: string }> = {
  ALL: { active: 'rgba(42,90,218,0.2)', dot: '#60A5FA' },
  INFO_COLLECTION: { active: 'rgba(124,58,237,0.15)', dot: '#B78BFF' },
  TRADING: { active: 'rgba(16,185,129,0.15)', dot: '#34D399' },
  RESOLVED: { active: 'rgba(107,114,128,0.12)', dot: '#9CA3AF' },
};

export function MarketList() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const agentFilter = searchParams.get('agent');

  const [markets, setMarkets] = useState<Market[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<MarketPhase | 'ALL'>('ALL');
  const [labelFilter, setLabelFilter] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [agentSearch, setAgentSearch] = useState(agentFilter || '');

  useEffect(() => {
    getMarkets(50, 0)
      .then(setMarkets)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  const availableLabels = useMemo(() => {
    const labels = markets.map((m) => m.label).filter((l): l is string => !!l);
    return [...new Set(labels)].sort();
  }, [markets]);

  const filteredMarkets = useMemo(() => {
    return markets.filter((m) => {
      const phaseOk = filter === 'ALL' || m.phase === filter;
      const labelOk = labelFilter === null || m.label === labelFilter;
      const searchOk = m.question.toLowerCase().includes(searchQuery.toLowerCase());
      return phaseOk && labelOk && searchOk;
    });
  }, [filter, labelFilter, searchQuery, markets]);

  const counts = useMemo(() => ({
    ALL: markets.length,
    INFO_COLLECTION: markets.filter((m) => m.phase === 'INFO_COLLECTION').length,
    TRADING: markets.filter((m) => m.phase === 'TRADING').length,
    RESOLVED: markets.filter((m) => m.phase === 'RESOLVED').length,
  }), [markets]);

  const handleAgentSearch = (address: string) => {
    setAgentSearch(address);
    if (address.startsWith('0x') && address.length === 42) {
      router.push(`/agent/${address}`);
    }
  };

  if (loading) {
    return (
      <div>
        <div className="flex items-center gap-3 mb-6">
          <h2 className="text-xl font-bold text-white">Markets</h2>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {[1, 2, 3].map((i) => (
            <div key={i} className="rounded-2xl animate-pulse h-52"
              style={{ background: 'rgba(22,27,34,0.5)' }} />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div>
      {/* Header row */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-5">
        <div className="flex items-center gap-3">
          <h2 className="text-xl font-bold text-white">Markets</h2>
          <span className="text-xs font-mono px-2 py-0.5 rounded-full"
            style={{ background: 'rgba(255,255,255,0.04)', color: 'var(--text-muted)' }}>
            {markets.length}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <div className="relative">
            <svg className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2" style={{ color: 'var(--text-muted)' }} fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <input
              type="text"
              placeholder="Search markets..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="input pl-8 py-2 text-sm"
              style={{ width: '180px' }}
            />
          </div>
          <div className="relative">
            <svg className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2" style={{ color: 'var(--text-muted)' }} fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
            </svg>
            <input
              type="text"
              placeholder="Agent address..."
              value={agentSearch}
              onChange={(e) => handleAgentSearch(e.target.value)}
              className="input pl-8 py-2 text-xs font-mono"
              style={{ width: '150px' }}
            />
          </div>
        </div>
      </div>

      {/* Filter tabs */}
      <div className="flex items-center gap-1 mb-5 overflow-x-auto scrollbar-hide pb-1"
        style={{
          padding: '3px',
          background: 'rgba(13,17,23,0.8)',
          border: '1px solid var(--border)',
          borderRadius: '10px',
          width: 'fit-content',
        }}>
        {(['ALL', 'INFO_COLLECTION', 'TRADING', 'RESOLVED'] as const).map((tab) => {
          const active = filter === tab;
          const col = TAB_COLORS[tab];
          return (
            <button key={tab} onClick={() => setFilter(tab)}
              className="flex items-center gap-1.5 whitespace-nowrap px-3 py-1.5 rounded-lg text-xs font-medium transition-all duration-150"
              style={active ? {
                background: col.active,
                color: col.dot,
                border: `1px solid ${col.dot}30`,
              } : {
                color: 'var(--text-muted)',
              }}>
              {col.dot && (
                <div className="w-1.5 h-1.5 rounded-full"
                  style={{ background: active ? col.dot : 'var(--text-muted)', opacity: active ? 1 : 0.4 }} />
              )}
              {TAB_LABELS[tab]}
              <span className="opacity-50">({counts[tab]})</span>
            </button>
          );
        })}
      </div>

      {/* Label filter chips (only shown when labels exist) */}
      {availableLabels.length > 0 && (
        <div className="flex items-center gap-1.5 mb-5 flex-wrap">
          <button
            onClick={() => setLabelFilter(null)}
            className="px-2.5 py-1 rounded-full text-xs font-medium transition-all duration-150"
            style={labelFilter === null
              ? { background: 'rgba(255,255,255,0.1)', color: '#fff' }
              : { background: 'transparent', color: 'var(--text-muted)', border: '1px solid var(--border)' }
            }>
            All categories
          </button>
          {availableLabels.map((lbl) => (
            <button
              key={lbl}
              onClick={() => setLabelFilter(lbl === labelFilter ? null : lbl)}
              className="px-2.5 py-1 rounded-full text-xs font-medium uppercase tracking-wide transition-all duration-150"
              style={labelFilter === lbl
                ? { background: 'rgba(96,165,250,0.2)', color: '#60A5FA', border: '1px solid rgba(96,165,250,0.4)' }
                : { background: 'transparent', color: 'var(--text-muted)', border: '1px solid var(--border)' }
              }>
              {lbl}
            </button>
          ))}
        </div>
      )}

      {/* Grid */}
      {filteredMarkets.length === 0 ? (
        <div className="rounded-2xl flex flex-col items-center justify-center py-16 text-center"
          style={{ background: 'rgba(22,27,34,0.4)', border: '1px solid var(--border)' }}>
          <svg className="w-10 h-10 mb-4" style={{ color: 'var(--text-muted)', opacity: 0.4 }} fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9.172 16.172a4 4 0 015.656 0M9 10h.01M15 10h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <p className="text-sm" style={{ color: 'var(--text-muted)' }}>No markets found</p>
          {searchQuery && (
            <button onClick={() => setSearchQuery('')} className="btn-ghost text-xs mt-3">
              Clear search
            </button>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredMarkets.map((market) => (
            <MarketCard key={market.id} market={market} />
          ))}
        </div>
      )}
    </div>
  );
}
