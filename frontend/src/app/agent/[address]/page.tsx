'use client';

import { useState, useEffect } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { AgentStatsCard } from '@/components/AgentStatsCard';
import { AgentMarketList } from '@/components/AgentMarketList';
import { CreatorStatsCard } from '@/components/CreatorStatsCard';
import { MarketCard } from '@/components/MarketCard';
import { getAgentStats, getAgentMarkets, getAgentReputation, type AgentStats, type AgentMarket, type AgentLabelReputation } from '@/lib/agentApi';
import { getCreatorStats, getCreatorMarkets, type CreatorStats } from '@/lib/marketApi';
import type { Market } from '@/lib/types';

const LABEL_COLORS: Record<string, string> = {
  crypto: '#F59E0B',
  finance: '#34D399',
  sport: '#60A5FA',
  politics: '#F87171',
  weather: '#A78BFA',
  software: '#06B6D4',
  world: '#EC4899',
  other: '#94A3B8',
};
const labelColor = (label: string) => LABEL_COLORS[label] ?? '#94A3B8';

export default function AgentPage() {
  const params = useParams();
  const address = params.address as string;
  
  const [agent, setAgent] = useState<AgentStats | null>(null);
  const [markets, setMarkets] = useState<AgentMarket[]>([]);
  const [reputation, setReputation] = useState<AgentLabelReputation[]>([]);
  const [creator, setCreator] = useState<CreatorStats | null>(null);
  const [creatorMarkets, setCreatorMarkets] = useState<Market[]>([]);
  const [labelSearch, setLabelSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!address || typeof address !== 'string') return;
    async function loadData() {
      try {
        setLoading(true);
        const normAddr = address.trim().toLowerCase().startsWith('0x') ? address.trim().toLowerCase() : `0x${address.trim().toLowerCase()}`;
        const [agentData, marketData, reputationData, creatorData, createdMarkets] = await Promise.all([
          getAgentStats(normAddr),
          getAgentMarkets(normAddr, 50),
          getAgentReputation(normAddr),
          getCreatorStats(normAddr),
          getCreatorMarkets(normAddr, 20),
        ]);

        setAgent(agentData);
        setMarkets(marketData);
        setReputation(reputationData);
        setCreator(creatorData);
        setCreatorMarkets(createdMarkets);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load data');
      } finally {
        setLoading(false);
      }
    }

    loadData();
  }, [address]);

  if (loading) {
    return (
      <div className="min-h-screen">
        <div className="border-b border-chainlink-border/50 bg-chainlink-surface/80 backdrop-blur-lg sticky top-0 z-10">
          <div className="container mx-auto px-4 py-4">
            <Link href="/" className="btn-ghost inline-flex items-center gap-2 text-sm">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
              Back to Markets
            </Link>
          </div>
        </div>
        <div className="container mx-auto px-4 py-8">
          <div className="animate-pulse space-y-6">
            <div className="card-glow h-48"></div>
            <div className="card-glow h-32"></div>
          </div>
        </div>
      </div>
    );
  }

  const hasAgent = !!agent;
  const hasCreator = !!creator;

  if (error || (!hasAgent && !hasCreator)) {
    return (
      <div className="min-h-screen">
        <div className="border-b border-chainlink-border/50 bg-chainlink-surface/80 backdrop-blur-lg sticky top-0 z-10">
          <div className="container mx-auto px-4 py-4">
            <Link href="/" className="btn-ghost inline-flex items-center gap-2 text-sm">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
              Back to Markets
            </Link>
          </div>
        </div>
        <div className="container mx-auto px-4 py-8">
          <div className="card-flat text-center py-12">
            <svg className="w-12 h-12 mx-auto text-chainlink-text-muted/50 mb-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9.172 16.172a4 4 0 015.656 0M9 10h.01M15 10h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <p className="text-chainlink-text-muted mb-4">{error || 'Address not found as agent or creator'}</p>
            <Link href="/" className="btn-primary">
              Go Home
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen">
      <div className="border-b border-chainlink-border/50 bg-chainlink-surface/80 backdrop-blur-lg sticky top-0 z-10">
        <div className="container mx-auto px-4 py-4">
          <Link href="/" className="btn-ghost inline-flex items-center gap-2 text-sm">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
            Back to Markets
          </Link>
        </div>
      </div>

      <div className="container mx-auto px-4 py-8">
        <div className="mb-8">
          <div className="flex items-center gap-3 mb-2">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-chainlink-blue to-chainlink-accent flex items-center justify-center">
              <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
              </svg>
            </div>
            <div>
              <h1 className="text-2xl font-bold">
                {hasAgent && hasCreator ? 'Agent & Creator Profile' : hasCreator ? 'Creator Profile' : 'Agent Profile'}
              </h1>
              <p className="text-chainlink-text-muted text-sm">
                {hasAgent && hasCreator ? 'AI Agent & Market Creator Statistics' : hasCreator ? 'Market Creator Statistics' : 'AI Agent Statistics & History'}
              </p>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          <div className="lg:col-span-2 space-y-6">
            {hasCreator && creator && (
              <CreatorStatsCard creator={creator} address={address} />
            )}
            {hasAgent && agent && (
              <AgentStatsCard agent={agent} />
            )}
            
            {hasAgent && (
              <div className="card-glow">
                <h3 className="section-title">Market Participation</h3>
                <AgentMarketList markets={markets} />
              </div>
            )}
            
            {hasCreator && creatorMarkets.length > 0 && (
              <div className="card-glow">
                <h3 className="section-title">Markets Created</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {creatorMarkets.map((m) => (
                    <MarketCard key={m.id} market={m} />
                  ))}
                </div>
              </div>
            )}
          </div>

          <div className="space-y-6">
            {hasAgent && agent && (
              <div className="card-flat">
                <h3 className="section-title text-base">Performance Breakdown</h3>
                <div className="space-y-4">
                  <div>
                    <div className="flex justify-between text-sm mb-2">
                      <span className="text-chainlink-text-muted">Avg Confidence</span>
                      <span className="font-mono">
                        {Number(agent.totalResolvedMarkets) > 0
                          ? (Number(agent.totalConfidenceScore) / Number(agent.totalResolvedMarkets) / 100).toFixed(1)
                          : 0}%
                      </span>
                    </div>
                    <div className="progress-bar h-2">
                      <div
                        className="progress-fill bg-gradient-to-r from-green-500 to-emerald-400"
                        style={{
                          width: `${Number(agent.totalResolvedMarkets) > 0
                            ? Number(agent.totalConfidenceScore) / Number(agent.totalResolvedMarkets) / 100
                            : 0}%`
                        }}
                      />
                    </div>
                  </div>

                  <div className="pt-4 border-t border-chainlink-border/50">
                    <div className="text-xs text-chainlink-text-muted uppercase tracking-wider mb-3">Activity Stats</div>
                    <div className="space-y-2 text-sm">
                      <div className="flex justify-between">
                        <span className="text-chainlink-text-muted">Total Submissions</span>
                        <span className="font-mono">{agent.totalSubmissions.toString()}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-chainlink-text-muted">Total Swaps</span>
                        <span className="font-mono">{agent.totalSwaps.toString()}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-chainlink-text-muted">Avg Confidence</span>
                        <span className="font-mono">
                          {Number(agent.totalResolvedMarkets) > 0
                            ? (Number(agent.totalConfidenceScore) / Number(agent.totalResolvedMarkets) / 100).toFixed(1) + '%'
                            : '—'}
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {hasAgent && reputation.length > 0 ? (
              <div className="card-flat">
                <h3 className="section-title text-base">Domain Expertise</h3>
                <input
                  type="text"
                  placeholder="Search labels..."
                  value={labelSearch}
                  onChange={(e) => setLabelSearch(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg text-sm bg-chainlink-surface border border-chainlink-border/50 text-white placeholder-chainlink-text-muted focus:outline-none focus:ring-1 focus:ring-chainlink-accent mb-3"
                />
                <div className="space-y-3.5">
                  {(() => {
                    const search = labelSearch.trim().toLowerCase();
                    const filtered = search
                      ? reputation.filter((r) => r.label.toLowerCase().includes(search))
                      : reputation;
                    const maxRep = Math.max(...filtered.map(r => Number(r.reputation)), 1);
                    return filtered.length > 0 ? filtered.map((r) => (
                      <div key={r.label}>
                        <div className="flex items-center justify-between mb-1.5">
                          <span className="text-xs font-semibold uppercase tracking-wide"
                            style={{ color: labelColor(r.label) }}>
                            {r.label}
                          </span>
                          <div className="flex items-center gap-2 text-xs" style={{ color: 'var(--text-muted)' }}>
                            <span>{r.correctPredictions}/{r.totalPredictions} correct</span>
                            <span className="font-mono font-bold" style={{ color: labelColor(r.label) }}>
                              {(Number(r.reputation) / 100).toFixed(0)} pts
                            </span>
                          </div>
                        </div>
                        <div className="h-1.5 rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.06)' }}>
                          <div className="h-full rounded-full transition-all duration-300"
                            style={{
                              width: `${(Number(r.reputation) / maxRep * 100).toFixed(1)}%`,
                              background: labelColor(r.label),
                              opacity: 0.75,
                            }} />
                        </div>
                        <div className="flex justify-between mt-1 text-[10px]" style={{ color: 'rgba(107,114,128,0.55)' }}>
                          <span>Net: +{((Number(r.totalWinnings) - Number(r.totalStaked)) / 1e6).toFixed(6)} USDC</span>
                          <span>{r.totalPredictions > 0 ? Math.round(r.correctPredictions / r.totalPredictions * 100) : 0}% win rate</span>
                        </div>
                      </div>
                    )) : (
                      <div className="text-sm text-chainlink-text-muted py-4 text-center">
                        No labels match &quot;{labelSearch}&quot;
                      </div>
                    );
                  })()}
                </div>
              </div>
            ) : hasAgent ? (
              <div className="card-flat bg-gradient-to-br from-chainlink-blue/5 to-chainlink-accent/5 border-chainlink-accent/20">
                <div className="text-center">
                  <svg className="w-10 h-10 mx-auto text-chainlink-accent mb-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                  </svg>
                  <h4 className="font-semibold mb-1">AI Agent</h4>
                  <p className="text-xs text-chainlink-text-muted">
                    Domain reputation builds as this agent participates in resolved markets.
                  </p>
                </div>
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}
