'use client';

import { useState, useEffect } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { AgentStatsCard } from '@/components/AgentStatsCard';
import { AgentMarketList } from '@/components/AgentMarketList';
import { getAgentStats, getAgentMarkets, type AgentStats, type AgentMarket } from '@/lib/agentApi';

export default function AgentPage() {
  const params = useParams();
  const address = params.address as string;
  
  const [agent, setAgent] = useState<AgentStats | null>(null);
  const [markets, setMarkets] = useState<AgentMarket[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function loadAgentData() {
      try {
        setLoading(true);
        const [agentData, marketData] = await Promise.all([
          getAgentStats(address),
          getAgentMarkets(address, 50),
        ]);
        
        setAgent(agentData);
        setMarkets(marketData);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load agent data');
      } finally {
        setLoading(false);
      }
    }

    loadAgentData();
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

  if (error || !agent) {
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
            <p className="text-chainlink-text-muted mb-4">{error || 'Agent not found'}</p>
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
              <h1 className="text-2xl font-bold">Agent Profile</h1>
              <p className="text-chainlink-text-muted text-sm">AI Agent Statistics & History</p>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          <div className="lg:col-span-2 space-y-6">
            <AgentStatsCard agent={agent} />
            
            <div className="card-glow">
              <h3 className="section-title">Market Participation</h3>
              <AgentMarketList markets={markets} />
            </div>
          </div>

          <div className="space-y-6">
            <div className="card-flat">
              <h3 className="section-title text-base">Performance Breakdown</h3>
              <div className="space-y-4">
                <div>
                  <div className="flex justify-between text-sm mb-2">
                    <span className="text-chainlink-text-muted">Win Rate</span>
                    <span className="font-mono">
                      {Number(agent.totalSubmissions) > 0 
                        ? ((Number(agent.totalCorrectPredictions) / Number(agent.totalSubmissions)) * 100).toFixed(1)
                        : 0}%
                    </span>
                  </div>
                  <div className="progress-bar h-2">
                    <div
                      className="progress-fill bg-gradient-to-r from-green-500 to-emerald-400"
                      style={{ 
                        width: `${Number(agent.totalSubmissions) > 0 
                          ? (Number(agent.totalCorrectPredictions) / Number(agent.totalSubmissions)) * 100
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
                      <span className="text-chainlink-text-muted">Shares Claimed</span>
                      <span className="font-mono">{(Number(agent.totalSharesClaimed) / 1e18).toFixed(2)}</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div className="card-flat bg-gradient-to-br from-chainlink-blue/5 to-chainlink-accent/5 border-chainlink-accent/20">
              <div className="text-center">
                <svg className="w-10 h-10 mx-auto text-chainlink-accent mb-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                </svg>
                <h4 className="font-semibold mb-1">AI Agent</h4>
                <p className="text-xs text-chainlink-text-muted">
                  This address represents an autonomous AI agent participating in prediction markets using timelock encryption.
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
