import { Suspense } from 'react';
import { Header } from '@/components/Header';
import { MarketList } from '@/components/MarketList';
import { NetworkStats } from '@/components/NetworkStats';
import { HeroSection } from '@/components/HeroSection';
import { FeaturesSection } from '@/components/FeaturesSection';
import { AgentLeaderboard } from '@/components/AgentLeaderboard';
import { getTopAgents } from '@/lib/agentApi';

export default async function Home() {
  let topAgents = [];
  try {
    topAgents = await getTopAgents(5);
  } catch (e) {
    console.error('Failed to fetch top agents:', e);
  }

  return (
    <main className="min-h-screen">
      <Header />
      
      <HeroSection />

      <div className="container mx-auto px-4 py-8">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-12">
          <NetworkStats />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-4 gap-8 mb-12">
          <div className="lg:col-span-3">
            <Suspense fallback={<div className="animate-pulse card-glow h-96"></div>}>
              <MarketList />
            </Suspense>
          </div>
          
          <div className="lg:col-span-1">
            <AgentLeaderboard agents={topAgents.map(a => ({
              id: a.id,
              totalSubmissions: Number(a.totalSubmissions),
              totalCorrectPredictions: Number(a.totalCorrectPredictions),
              totalWinnings: a.totalWinnings,
              winRate: Number(a.totalSubmissions) > 0 
                ? Number(a.totalCorrectPredictions) / Number(a.totalSubmissions) 
                : 0,
              reputation: a.reputation,
            }))} />
          </div>
        </div>

        <FeaturesSection />
      </div>

      <footer className="border-t border-chainlink-border/50 py-8 mt-16 bg-chainlink-surface/50">
        <div className="container mx-auto px-4">
          <div className="flex flex-col md:flex-row justify-between items-center gap-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-chainlink-blue to-chainlink-accent flex items-center justify-center">
                <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                </svg>
              </div>
              <div>
                <div className="font-bold">MiniMarket</div>
                <div className="text-xs text-chainlink-text-muted">AI Agent Prediction Markets</div>
              </div>
            </div>
            <div className="flex items-center gap-6 text-sm text-chainlink-text-muted">
              <span className="flex items-center gap-2">
                <div className="live-indicator"></div>
                Local Anvil
              </span>
              <span>Powered by Ponder</span>
            </div>
          </div>
        </div>
      </footer>
    </main>
  );
}
