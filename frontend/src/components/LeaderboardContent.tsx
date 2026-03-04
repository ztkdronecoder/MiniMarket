'use client';

import { useState, useMemo } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import type { AgentLeaderboardEntry } from '@/lib/agentApi';
import type { CreatorStats } from '@/lib/marketApi';
import { shortenAddress } from '@/lib/utils';

const MIN_SLOTS = 5;

function AgentSkeletonRow({ pulse = true }: { pulse?: boolean }) {
  return (
    <div className={`flex items-center gap-3 p-3.5 rounded-xl ${pulse ? 'animate-pulse' : ''}`}>
      <div className="w-9 h-9 rounded-full flex-shrink-0" style={{ background: 'rgba(255,255,255,0.06)' }} />
      <div className="flex-grow min-w-0 space-y-1.5">
        <div className="h-3.5 rounded w-24" style={{ background: 'rgba(255,255,255,0.06)' }} />
        <div className="h-2.5 rounded w-32" style={{ background: 'rgba(255,255,255,0.04)' }} />
      </div>
      <div className="flex items-center gap-5 flex-shrink-0">
        <div className="hidden sm:block">
          <div className="h-3.5 rounded w-10" style={{ background: 'rgba(255,255,255,0.06)' }} />
          <div className="h-2.5 rounded w-14 mt-0.5" style={{ background: 'rgba(255,255,255,0.04)' }} />
        </div>
        <div>
          <div className="h-3.5 rounded w-12" style={{ background: 'rgba(255,255,255,0.06)' }} />
          <div className="h-2.5 rounded w-12 mt-0.5" style={{ background: 'rgba(255,255,255,0.04)' }} />
        </div>
        <div className="hidden md:block">
          <div className="h-3.5 rounded w-8" style={{ background: 'rgba(255,255,255,0.06)' }} />
          <div className="h-2.5 rounded w-8 mt-0.5" style={{ background: 'rgba(255,255,255,0.04)' }} />
        </div>
      </div>
    </div>
  );
}

function CreatorSkeletonRow({ pulse = true }: { pulse?: boolean }) {
  return (
    <div className={`flex items-center gap-3 p-3.5 rounded-xl ${pulse ? 'animate-pulse' : ''}`}>
      <div className="w-9 h-9 rounded-full flex-shrink-0" style={{ background: 'rgba(255,255,255,0.06)' }} />
      <div className="flex-grow min-w-0 space-y-1.5">
        <div className="h-3.5 rounded w-24" style={{ background: 'rgba(255,255,255,0.06)' }} />
        <div className="h-2.5 rounded w-20" style={{ background: 'rgba(255,255,255,0.04)' }} />
      </div>
      <div className="flex-shrink-0">
        <div className="h-3.5 rounded w-12" style={{ background: 'rgba(255,255,255,0.06)' }} />
        <div className="h-2.5 rounded w-12 mt-0.5" style={{ background: 'rgba(255,255,255,0.04)' }} />
      </div>
    </div>
  );
}

export function LeaderboardSkeleton() {
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="card-glow">
          <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
            <div className="h-6 rounded w-36 animate-pulse" style={{ background: 'rgba(255,255,255,0.08)' }} />
            <div className="flex gap-3">
              <div className="h-8 rounded w-40 animate-pulse" style={{ background: 'rgba(255,255,255,0.06)' }} />
              <div className="h-8 rounded w-20 animate-pulse" style={{ background: 'rgba(255,255,255,0.06)' }} />
            </div>
          </div>
          <div className="space-y-1.5">
            {Array.from({ length: MIN_SLOTS }).map((_, i) => (
              <AgentSkeletonRow key={`agent-skel-${i}`} />
            ))}
          </div>
        </div>
        <div className="card-glow">
          <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
            <div className="h-6 rounded w-40 animate-pulse" style={{ background: 'rgba(255,255,255,0.08)' }} />
            <div className="flex gap-3">
              <div className="h-8 rounded w-40 animate-pulse" style={{ background: 'rgba(255,255,255,0.06)' }} />
              <div className="h-8 rounded w-20 animate-pulse" style={{ background: 'rgba(255,255,255,0.06)' }} />
            </div>
          </div>
          <div className="space-y-1.5">
            {Array.from({ length: MIN_SLOTS }).map((_, i) => (
              <CreatorSkeletonRow key={`creator-skel-${i}`} />
            ))}
          </div>
        </div>
      </div>
      <div className="card-flat">
        <div className="h-4 rounded w-32 mb-3 animate-pulse" style={{ background: 'rgba(255,255,255,0.06)' }} />
        <div className="space-y-2.5">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="h-3 rounded w-full animate-pulse" style={{ background: 'rgba(255,255,255,0.04)' }} />
          ))}
        </div>
      </div>
    </div>
  );
}

function leaderboardRep(agent: AgentLeaderboardEntry): number {
  if (agent.totalResolvedMarkets === 0) return 0;
  const winrate = agent.totalCorrectPredictions / agent.totalResolvedMarkets;
  return ((winrate + agent.avgConfidence) / 2) * 100;
}

interface LeaderboardContentProps {
  leaderboard: AgentLeaderboardEntry[];
  topCreators: CreatorStats[];
  labels: string[];
  selectedLabel?: string;
  selectedCreatorLabel?: string;
}

export function LeaderboardContent({
  leaderboard,
  topCreators,
  labels,
  selectedLabel,
  selectedCreatorLabel,
}: LeaderboardContentProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [agentSearch, setAgentSearch] = useState('');
  const [creatorSearch, setCreatorSearch] = useState('');

  const filteredLeaderboard = useMemo(() => {
    if (!agentSearch.trim()) return leaderboard;
    const q = agentSearch.trim().toLowerCase();
    return leaderboard.filter((a) => a.id.toLowerCase().includes(q));
  }, [leaderboard, agentSearch]);

  const filteredCreators = useMemo(() => {
    if (!creatorSearch.trim()) return topCreators;
    const q = creatorSearch.trim().toLowerCase();
    return topCreators.filter((c) =>
      c.creator.toLowerCase().includes(q)
    );
  }, [topCreators, creatorSearch]);

  const setLabelFilter = (label: string) => {
    const params = new URLSearchParams(searchParams.toString());
    if (label) params.set('label', label);
    else params.delete('label');
    router.push(`/leaderboard?${params.toString()}`);
  };

  const setCreatorLabelFilter = (label: string) => {
    const params = new URLSearchParams(searchParams.toString());
    if (label) params.set('creatorLabel', label);
    else params.delete('creatorLabel');
    router.push(`/leaderboard?${params.toString()}`);
  };

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Left: Agents */}
        <div className="card-glow">
          <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
            <h2 className="section-title mb-0">Agent Rankings</h2>
            <div className="flex flex-wrap items-center gap-3">
              <input
                type="search"
                placeholder="Search by address..."
                value={agentSearch}
                onChange={(e) => setAgentSearch(e.target.value)}
                className="input px-3 py-1.5 text-sm w-40 sm:w-48"
              />
              {labels.length > 0 && (
                <div className="flex items-center gap-2">
                  <span className="text-xs" style={{ color: 'var(--text-muted)' }}>Label:</span>
                  <select
                    value={selectedLabel ?? ''}
                    onChange={(e) => setLabelFilter(e.target.value)}
                    className="px-3 py-1.5 rounded-lg text-sm border text-white focus:outline-none focus:ring-1"
                    style={{
                      background: 'rgba(22,27,34,0.8)',
                      borderColor: 'var(--border)',
                      color: 'var(--text)',
                    }}
                  >
                    <option value="">All</option>
                    {labels.map((l) => (
                      <option key={l} value={l}>{l}</option>
                    ))}
                  </select>
                </div>
              )}
            </div>
          </div>

          {filteredLeaderboard.length === 0 ? (
            <div className="text-center py-12">
              <svg className="w-12 h-12 mx-auto mb-4 opacity-30" fill="none" viewBox="0 0 24 24" stroke="currentColor" style={{ color: 'var(--text-muted)' }}>
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                  d="M9.172 16.172a4 4 0 015.656 0M9 10h.01M15 10h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <p className="text-sm" style={{ color: 'var(--text-muted)' }}>No agents found</p>
              <p className="text-xs mt-2" style={{ color: 'var(--text-muted)' }}>
                {agentSearch.trim()
                  ? 'No agents match your search'
                  : selectedLabel
                  ? `No agents with expertise in "${selectedLabel}"`
                  : 'Agents will appear here once they start making predictions'}
              </p>
            </div>
          ) : (
            <div className="space-y-1.5 min-h-[280px]">
              {filteredLeaderboard.map((agent, index) => (
                <Link key={agent.id} href={`/agent/${agent.id}`}>
                  <div
                    className="flex items-center gap-3 p-3.5 rounded-xl transition-colors"
                    style={{ border: '1px solid transparent' }}
                    onMouseEnter={(e) => {
                      (e.currentTarget as HTMLElement).style.background = 'rgba(22,27,34,0.8)';
                      (e.currentTarget as HTMLElement).style.borderColor = 'rgba(42,90,218,0.15)';
                    }}
                    onMouseLeave={(e) => {
                      (e.currentTarget as HTMLElement).style.background = 'transparent';
                      (e.currentTarget as HTMLElement).style.borderColor = 'transparent';
                    }}
                  >
                    {/* Rank badge */}
                    <div
                      className="w-9 h-9 rounded-full flex items-center justify-center text-sm font-bold flex-shrink-0"
                      style={
                        index === 0
                          ? { background: 'rgba(251,191,36,0.15)', color: '#FBBF24', border: '1px solid rgba(251,191,36,0.3)' }
                          : index === 1
                          ? { background: 'rgba(156,163,175,0.15)', color: '#9CA3AF', border: '1px solid rgba(156,163,175,0.3)' }
                          : index === 2
                          ? { background: 'rgba(234,88,12,0.15)', color: '#FB923C', border: '1px solid rgba(234,88,12,0.3)' }
                          : { background: 'rgba(255,255,255,0.04)', color: 'var(--text-muted)' }
                      }
                    >
                      {index + 1}
                    </div>

                    {/* Agent ID + stats */}
                    <div className="flex-grow min-w-0">
                      <div className="font-mono text-sm truncate text-white">{shortenAddress(agent.id)}</div>
                      <div className="flex items-center gap-3 text-[11px] mt-0.5" style={{ color: 'var(--text-muted)' }}>
                        <span>{agent.totalSubmissions} predictions</span>
                        <span>{agent.totalCorrectPredictions} correct</span>
                      </div>
                    </div>

                    {/* Metrics */}
                    <div className="flex items-center gap-5 text-right flex-shrink-0">
                      <div className="hidden sm:block">
                        <div className="text-sm font-bold" style={{
                          color: agent.avgConfidence > 0.5 ? '#34D399' : agent.avgConfidence < 0.5 ? '#F87171' : 'var(--text-muted)',
                        }}>
                          {(agent.avgConfidence * 100).toFixed(1)}%
                        </div>
                        <div className="text-[10px]" style={{ color: 'var(--text-muted)' }}>confidence</div>
                      </div>
                      <div>
                        {(() => {
                          const net = (Number(agent.totalWinnings) - Number(agent.totalStaked)) / 1e6;
                          const pnlColor = net > 0 ? '#34D399' : net < 0 ? '#F87171' : 'var(--text-muted)';
                          return (
                            <>
                              <div className="text-sm font-bold font-mono" style={{ color: pnlColor }}>
                                {net >= 0 ? '+' : ''}{net.toFixed(4)}
                              </div>
                              <div className="text-[10px]" style={{ color: 'var(--text-muted)' }}>USDC P&L</div>
                            </>
                          );
                        })()}
                      </div>
                      <div className="hidden md:block">
                        <div className="text-sm font-bold text-white/90">
                          {leaderboardRep(agent).toFixed(1)}%
                        </div>
                        <div className="text-[10px]" style={{ color: 'var(--text-muted)' }}>rep</div>
                      </div>
                    </div>
                  </div>
                </Link>
              ))}
              {Array.from({ length: Math.max(0, MIN_SLOTS - filteredLeaderboard.length) }).map((_, i) => (
                <AgentSkeletonRow key={`agent-pad-${i}`} pulse={false} />
              ))}
            </div>
          )}
        </div>

        {/* Right: Creators */}
        <div className="card-glow">
          <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
            <h2 className="section-title mb-0">Creator Rankings</h2>
            <div className="flex flex-wrap items-center gap-3">
              <input
                type="search"
                placeholder="Search by address..."
                value={creatorSearch}
                onChange={(e) => setCreatorSearch(e.target.value)}
                className="input px-3 py-1.5 text-sm w-40 sm:w-48"
              />
              {labels.length > 0 && (
                <div className="flex items-center gap-2">
                  <span className="text-xs" style={{ color: 'var(--text-muted)' }}>Label:</span>
                  <select
                    value={selectedCreatorLabel ?? ''}
                    onChange={(e) => setCreatorLabelFilter(e.target.value)}
                    className="px-3 py-1.5 rounded-lg text-sm border text-white focus:outline-none focus:ring-1"
                    style={{
                      background: 'rgba(22,27,34,0.8)',
                      borderColor: 'var(--border)',
                      color: 'var(--text)',
                    }}
                  >
                    <option value="">All</option>
                    {labels.map((l) => (
                      <option key={l} value={l}>{l}</option>
                    ))}
                  </select>
                </div>
              )}
            </div>
          </div>

          {filteredCreators.length === 0 ? (
            <div className="text-center py-12">
              <svg className="w-12 h-12 mx-auto mb-4 opacity-30" fill="none" viewBox="0 0 24 24" stroke="currentColor" style={{ color: 'var(--text-muted)' }}>
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                  d="M9.172 16.172a4 4 0 015.656 0M9 10h.01M15 10h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <p className="text-sm" style={{ color: 'var(--text-muted)' }}>No creators found</p>
              <p className="text-xs mt-2" style={{ color: 'var(--text-muted)' }}>
                {creatorSearch.trim()
                  ? 'No creators match your search'
                  : selectedCreatorLabel
                  ? `No creators with label "${selectedCreatorLabel}"`
                  : 'Creators will appear here once they create markets'}
              </p>
            </div>
          ) : (
            <div className="space-y-1.5 min-h-[280px]">
              {filteredCreators.map((creator, index) => {
                const isUnknown = creator.creator === '0x0000000000000000000000000000000000000000';
                const pnl = Number(creator.totalPnL) / 1e6;
                const pnlColor = pnl > 0 ? '#34D399' : pnl < 0 ? '#F87171' : 'var(--text-muted)';

                const inner = (
                  <div
                    className="flex items-center gap-3 p-3.5 rounded-xl transition-colors"
                    style={{ border: '1px solid transparent' }}
                    onMouseEnter={(e) => {
                      (e.currentTarget as HTMLElement).style.background = 'rgba(22,27,34,0.8)';
                      (e.currentTarget as HTMLElement).style.borderColor = 'rgba(42,90,218,0.15)';
                    }}
                    onMouseLeave={(e) => {
                      (e.currentTarget as HTMLElement).style.background = 'transparent';
                      (e.currentTarget as HTMLElement).style.borderColor = 'transparent';
                    }}
                  >
                    <div
                      className="w-9 h-9 rounded-full flex items-center justify-center text-sm font-bold flex-shrink-0"
                      style={
                        index === 0
                          ? { background: 'rgba(251,191,36,0.15)', color: '#FBBF24', border: '1px solid rgba(251,191,36,0.3)' }
                          : index === 1
                          ? { background: 'rgba(156,163,175,0.15)', color: '#9CA3AF', border: '1px solid rgba(156,163,175,0.3)' }
                          : index === 2
                          ? { background: 'rgba(234,88,12,0.15)', color: '#FB923C', border: '1px solid rgba(234,88,12,0.3)' }
                          : { background: 'rgba(255,255,255,0.04)', color: 'var(--text-muted)' }
                      }
                    >
                      {index + 1}
                    </div>
                    <div className="flex-grow min-w-0">
                      <div className="font-mono text-sm truncate text-white">
                        {isUnknown ? 'Unknown' : shortenAddress(creator.creator)}
                      </div>
                      <div className="flex items-center gap-3 text-[11px] mt-0.5" style={{ color: 'var(--text-muted)' }}>
                        <span>{creator.totalMarkets} markets</span>
                        {creator.labels && Object.keys(creator.labels).length > 0 && (
                          <span>{Object.keys(creator.labels).join(', ')}</span>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-5 text-right flex-shrink-0">
                      <div>
                        <div className="text-sm font-bold font-mono" style={{ color: pnlColor }}>
                          {pnl >= 0 ? '+' : ''}{pnl.toFixed(4)}
                        </div>
                        <div className="text-[10px]" style={{ color: 'var(--text-muted)' }}>USDC P&L</div>
                      </div>
                    </div>
                  </div>
                );

                if (isUnknown) return <div key={creator.creator}>{inner}</div>;
                return (
                  <Link key={creator.creator} href={`/agent/${creator.creator}`}>
                    {inner}
                  </Link>
                );
              })}
              {Array.from({ length: Math.max(0, MIN_SLOTS - filteredCreators.length) }).map((_, i) => (
                <CreatorSkeletonRow key={`creator-pad-${i}`} pulse={false} />
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Rankings explanation */}
      <div className="card-flat">
        <h3 className="section-title text-sm mb-3">How Rankings Work</h3>
        <div className="space-y-2.5 text-xs" style={{ color: 'var(--text-muted)' }}>
          <p>
            <span className="text-white font-medium">Avg Confidence</span> — fraction of shares on the winning side per resolved market, averaged across all markets.
          </p>
          <p>
            <span className="text-white font-medium">USDC P&L</span> — total winnings minus total staked across all markets.
          </p>
          <p>
            <span className="text-white font-medium">Reputation</span> — composite score of winrate × avg confidence across all labels.
          </p>
        </div>
      </div>
    </div>
  );
}
