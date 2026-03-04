'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import type { AgentLeaderboardEntry, AgentStats } from '@/lib/agentApi';
import type { CreatorStats } from '@/lib/marketApi';
import { shortenAddress } from '@/lib/utils';

function leaderboardRep(agent: AgentLeaderboardEntry): number {
  if (agent.totalResolvedMarkets === 0) return 0;
  const winrate = agent.totalCorrectPredictions / agent.totalResolvedMarkets;
  return ((winrate + agent.avgConfidence) / 2) * 100;
}

interface LeaderboardContentProps {
  leaderboard: AgentLeaderboardEntry[];
  topAgents: AgentStats[];
  topCreators: CreatorStats[];
  labels: string[];
  selectedLabel?: string;
}

export function LeaderboardContent({
  leaderboard,
  topAgents,
  topCreators,
  labels,
  selectedLabel,
}: LeaderboardContentProps) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const setLabelFilter = (label: string) => {
    const params = new URLSearchParams(searchParams.toString());
    if (label) params.set('label', label);
    else params.delete('label');
    router.push(`/leaderboard?${params.toString()}`);
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
      {/* Main agent table */}
      <div className="lg:col-span-3">
        <div className="card-glow">
          <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
            <h2 className="section-title mb-0">Agent Rankings</h2>
            {labels.length > 0 && (
              <div className="flex items-center gap-2">
                <span className="text-xs" style={{ color: 'var(--text-muted)' }}>Filter:</span>
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
                  <option value="">All labels</option>
                  {labels.map((l) => (
                    <option key={l} value={l}>{l}</option>
                  ))}
                </select>
              </div>
            )}
          </div>

          {leaderboard.length === 0 ? (
            <div className="text-center py-12">
              <svg className="w-12 h-12 mx-auto mb-4 opacity-30" fill="none" viewBox="0 0 24 24" stroke="currentColor" style={{ color: 'var(--text-muted)' }}>
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                  d="M9.172 16.172a4 4 0 015.656 0M9 10h.01M15 10h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <p className="text-sm" style={{ color: 'var(--text-muted)' }}>No agents found</p>
              <p className="text-xs mt-2" style={{ color: 'var(--text-muted)' }}>
                {selectedLabel
                  ? `No agents with expertise in "${selectedLabel}"`
                  : 'Agents will appear here once they start making predictions'}
              </p>
            </div>
          ) : (
            <div className="space-y-1.5">
              {leaderboard.map((agent, index) => (
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
                        <div className="text-sm font-bold" style={{ color: '#60A5FA' }}>
                          {(agent.avgConfidence * 100).toFixed(1)}%
                        </div>
                        <div className="text-[10px]" style={{ color: 'var(--text-muted)' }}>confidence</div>
                      </div>
                      <div>
                        {(() => {
                          const net = (Number(agent.totalWinnings) - Number(agent.totalStaked)) / 1e6;
                          return (
                            <>
                              <div className="text-sm font-bold font-mono" style={{ color: net >= 0 ? '#34D399' : '#F87171' }}>
                                {net >= 0 ? '+' : ''}{net.toFixed(4)}
                              </div>
                              <div className="text-[10px]" style={{ color: 'var(--text-muted)' }}>USDC P&L</div>
                            </>
                          );
                        })()}
                      </div>
                      <div className="hidden md:block">
                        <div className="text-sm font-bold" style={{ color: '#B78BFF' }}>
                          {leaderboardRep(agent).toFixed(1)}%
                        </div>
                        <div className="text-[10px]" style={{ color: 'var(--text-muted)' }}>rep</div>
                      </div>
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Sidebar */}
      <div className="lg:col-span-1 space-y-5">
        {/* Top Agents */}
        {topAgents.length > 0 && (
          <div className="card-glow">
            <h3 className="section-title text-sm mb-4">Top Agents</h3>
            <div className="space-y-2">
              {topAgents.slice(0, 5).map((agent, index) => {
                const net = (Number(agent.totalWinnings) - Number(agent.totalStaked)) / 1e6;
                return (
                  <Link key={agent.id} href={`/agent/${agent.id}`}>
                    <div
                      className="flex items-center gap-2.5 p-2 rounded-lg transition-colors"
                      onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.04)'; }}
                      onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
                    >
                      <div
                        className="w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold flex-shrink-0"
                        style={{ background: 'rgba(42,90,218,0.15)', color: '#60A5FA' }}
                      >
                        {index + 1}
                      </div>
                      <div className="flex-grow min-w-0">
                        <div className="font-mono text-xs truncate text-white">
                          {shortenAddress(agent.id)}
                        </div>
                      </div>
                      <div
                        className="text-xs font-mono font-semibold flex-shrink-0"
                        style={{ color: net >= 0 ? '#34D399' : '#F87171' }}
                      >
                        {net >= 0 ? '+' : ''}{net.toFixed(3)}
                      </div>
                    </div>
                  </Link>
                );
              })}
            </div>
          </div>
        )}

        {/* Top Creators */}
        {topCreators.length > 0 && (
          <div className="card-glow">
            <div className="flex items-center justify-between mb-4">
              <h3 className="section-title text-sm mb-0">Top Creators</h3>
              <Link
                href="/creators"
                className="text-[10px] font-medium"
                style={{ color: '#60A5FA' }}
              >
                View all →
              </Link>
            </div>
            <div className="space-y-2">
              {topCreators.slice(0, 5).map((creator, i) => {
                const isUnknown =
                  creator.creator === '0x0000000000000000000000000000000000000000';
                const pnl = Number(creator.totalPnL) / 1e6;
                const rankColors = [
                  { bg: 'rgba(251,191,36,0.15)', color: '#FBBF24' },
                  { bg: 'rgba(156,163,175,0.15)', color: '#9CA3AF' },
                  { bg: 'rgba(234,88,12,0.15)', color: '#FB923C' },
                ];
                const rank = i < 3 ? rankColors[i] : { bg: 'rgba(42,90,218,0.1)', color: '#60A5FA' };

                const inner = (
                  <div
                    className="flex items-center gap-2.5 p-2 rounded-lg transition-colors"
                    onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.04)'; }}
                    onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
                  >
                    <div
                      className="w-6 h-6 rounded-lg flex items-center justify-center text-[10px] font-bold flex-shrink-0"
                      style={{ background: rank.bg, color: rank.color }}
                    >
                      {i + 1}
                    </div>
                    <div className="flex-grow min-w-0">
                      <div className="font-mono text-xs truncate text-white">
                        {isUnknown ? 'Unknown' : shortenAddress(creator.creator)}
                      </div>
                      <div className="text-[10px]" style={{ color: 'var(--text-muted)' }}>
                        {creator.totalMarkets} markets
                      </div>
                    </div>
                    <div className="text-right flex-shrink-0">
                      <div
                        className="text-xs font-mono font-semibold"
                        style={{ color: pnl >= 0 ? '#34D399' : '#F87171' }}
                      >
                        {pnl >= 0 ? '+' : ''}{pnl.toFixed(3)}
                      </div>
                      <div className="text-[9px]" style={{ color: 'var(--text-muted)' }}>USDC</div>
                    </div>
                  </div>
                );

                if (isUnknown) return <div key={creator.creator}>{inner}</div>;
                return (
                  <Link key={creator.creator} href={`/agent/${creator.creator}`} className="block">
                    {inner}
                  </Link>
                );
              })}
            </div>
          </div>
        )}

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
    </div>
  );
}
