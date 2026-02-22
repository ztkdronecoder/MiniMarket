'use client';

import { useState, useMemo, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { MarketCard } from './MarketCard';
import { getMarkets } from '@/lib/marketApi';
import type { MarketPhase, Market } from '@/lib/types';

export function MarketList() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const agentFilter = searchParams.get('agent');
  
  const [markets, setMarkets] = useState<Market[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<MarketPhase | 'ALL'>('ALL');
  const [searchQuery, setSearchQuery] = useState('');
  const [agentSearch, setAgentSearch] = useState(agentFilter || '');

  useEffect(() => {
    async function fetchMarkets() {
      try {
        const data = await getMarkets(50, 0);
        setMarkets(data);
      } catch (error) {
        console.error('Failed to fetch markets:', error);
      } finally {
        setLoading(false);
      }
    }
    fetchMarkets();
  }, []);

  const filteredMarkets = useMemo(() => {
    return markets.filter((market) => {
      const matchesPhase = filter === 'ALL' || market.phase === filter;
      const matchesSearch = market.question.toLowerCase().includes(searchQuery.toLowerCase());
      return matchesPhase && matchesSearch;
    });
  }, [filter, searchQuery, markets]);

  const phaseCounts = useMemo(() => {
    return {
      ALL: markets.length,
      INFO_COLLECTION: markets.filter((m) => m.phase === 'INFO_COLLECTION').length,
      TRADING: markets.filter((m) => m.phase === 'TRADING').length,
      RESOLVED: markets.filter((m) => m.phase === 'RESOLVED').length,
    };
  }, [markets]);

  const tabs: { value: MarketPhase | 'ALL'; label: string; count: number }[] = [
    { value: 'ALL', label: 'All', count: phaseCounts.ALL },
    { value: 'INFO_COLLECTION', label: 'Info', count: phaseCounts.INFO_COLLECTION },
    { value: 'TRADING', label: 'Trading', count: phaseCounts.TRADING },
    { value: 'RESOLVED', label: 'Resolved', count: phaseCounts.RESOLVED },
  ];

  const handleAgentSearch = (address: string) => {
    setAgentSearch(address);
    if (address && address.startsWith('0x') && address.length === 42) {
      router.push(`/agent/${address}`);
    }
  };

  if (loading) {
    return (
      <div id="markets">
        <h2 className="text-2xl font-bold mb-6">Markets</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {[1, 2, 3].map((i) => (
            <div key={i} className="card-glow h-64 animate-pulse"></div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div id="markets">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6">
        <h2 className="text-2xl font-bold">Markets</h2>
        
        <div className="flex items-center gap-3">
          <div className="relative">
            <svg className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-chainlink-text-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <input
              type="text"
              placeholder="Search markets..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="input pl-9 w-48 md:w-64"
            />
          </div>
          
          <div className="relative">
            <svg className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-chainlink-text-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
            </svg>
            <input
              type="text"
              placeholder="Agent address..."
              value={agentSearch}
              onChange={(e) => handleAgentSearch(e.target.value)}
              className="input pl-9 w-40 md:w-48 font-mono text-xs"
            />
          </div>
        </div>
      </div>

      <div className="flex items-center gap-2 mb-6 overflow-x-auto scrollbar-hide pb-2">
        {tabs.map((tab) => (
          <button
            key={tab.value}
            onClick={() => setFilter(tab.value)}
            className={`btn-ghost whitespace-nowrap ${
              filter === tab.value 
                ? 'bg-chainlink-blue/20 text-chainlink-accent border-chainlink-accent/30' 
                : ''
            }`}
          >
            {tab.label}
            <span className="ml-1.5 text-xs opacity-60">({tab.count})</span>
          </button>
        ))}
      </div>

      {filteredMarkets.length === 0 ? (
        <div className="card-flat text-center py-12">
          <svg className="w-12 h-12 mx-auto text-chainlink-text-muted/50 mb-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9.172 16.172a4 4 0 015.656 0M9 10h.01M15 10h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <p className="text-chainlink-text-muted">No markets found</p>
          {searchQuery && (
            <button 
              onClick={() => setSearchQuery('')}
              className="btn-ghost mt-4 text-sm"
            >
              Clear search
            </button>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {filteredMarkets.map((market) => (
            <MarketCard key={market.id} market={market} />
          ))}
        </div>
      )}
    </div>
  );
}
