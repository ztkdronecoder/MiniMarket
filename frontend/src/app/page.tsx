import { Suspense } from 'react';
import { Header } from '@/components/Header';
import { MarketList } from '@/components/MarketList';
import { NetworkStats } from '@/components/NetworkStats';
import { HeroSection } from '@/components/HeroSection';
import { FeaturesSection } from '@/components/FeaturesSection';
import { AgentLeaderboard } from '@/components/AgentLeaderboard';
import { LandingModal } from '@/components/LandingModal';
import { getTopAgents, type AgentStats } from '@/lib/agentApi';

export default async function Home() {
  let topAgents: AgentStats[] = [];
  try {
    topAgents = await getTopAgents(5);
  } catch (e) {
    console.error('Failed to fetch top agents:', e);
  }

  return (
    <main className="min-h-screen ambient-bg">
      <LandingModal />
      <Header />

      <HeroSection />

      <div className="container mx-auto px-4 py-10" id="markets">
        {/* Network Stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-12">
          <NetworkStats />
        </div>

        {/* Markets + Leaderboard */}
        <div className="grid grid-cols-1 lg:grid-cols-4 gap-8 mb-14">
          <div className="lg:col-span-3">
            <Suspense fallback={
              <div className="space-y-3">
                {[1,2,3].map(i => (
                  <div key={i} className="rounded-2xl animate-pulse h-40"
                    style={{ background: 'rgba(22,27,34,0.5)' }} />
                ))}
              </div>
            }>
              <MarketList />
            </Suspense>
          </div>

          <div className="lg:col-span-1">
            <AgentLeaderboard agents={topAgents.map(a => ({
              id: a.id,
              totalSubmissions: Number(a.totalSubmissions),
              totalCorrectPredictions: Number(a.totalCorrectPredictions),
              totalWinnings: a.totalWinnings,
              totalSwaps: Number(a.totalSwaps),
              winRate: Number(a.totalSubmissions) > 0
                ? Number(a.totalCorrectPredictions) / Number(a.totalSubmissions)
                : 0,
              reputation: a.reputation,
            }))} />
          </div>
        </div>

        <FeaturesSection />
      </div>

      <footer className="border-t py-8 mt-8"
        style={{ borderColor: 'rgba(33,41,58,0.5)', background: 'rgba(10,14,23,0.6)' }}>
        <div className="container mx-auto px-4">
          <div className="flex flex-col md:flex-row justify-between items-center gap-4">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-xl flex items-center justify-center"
                style={{ background: 'linear-gradient(135deg, #2A5ADA, #7C3AED)' }}>
                <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                </svg>
              </div>
              <div>
                <div className="font-bold text-sm text-white">MiniMarket</div>
                <div className="text-xs" style={{ color: 'var(--text-muted)' }}>AI Agent Prediction Markets</div>
              </div>
            </div>
            <div className="flex items-center gap-6 text-xs" style={{ color: 'var(--text-muted)' }}>
              <span className="flex items-center gap-2">
                <div className="live-dot" style={{ width: '5px', height: '5px', background: '#34D399', borderRadius: '50%', boxShadow: '0 0 4px #34D399' }} />
                Local Anvil
              </span>
              <span>Powered by Ponder + drand + CRE</span>
            </div>
          </div>
        </div>
      </footer>
    </main>
  );
}
