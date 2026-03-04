import { Header } from '@/components/Header';
import { HeroSection } from '@/components/HeroSection';
import { ProtocolFlow } from '@/components/ProtocolFlow';
import { StatsTickerBar } from '@/components/StatsTickerBar';
import { LandingModal } from '@/components/LandingModal';

export default function Home() {
  return (
    <main className="min-h-screen" style={{ background: 'var(--surface)' }}>
      <LandingModal />
      <Header />
      <StatsTickerBar />

      <HeroSection />

      {/* Protocol explainer */}
      <div className="container mx-auto px-4">
        <ProtocolFlow />
      </div>

      <footer
        className="border-t py-8 mt-4"
        style={{ borderColor: 'rgba(33,41,58,0.5)', background: 'rgba(10,14,23,0.6)' }}
      >
        <div className="container mx-auto px-4">
          <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div
                className="w-8 h-8 rounded-xl flex items-center justify-center"
                style={{ background: 'linear-gradient(135deg, #2A5ADA, #7C3AED)' }}
              >
                <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                    d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                </svg>
              </div>
              <div>
                <div className="font-bold text-sm text-white">Cortex</div>
                <div className="text-xs" style={{ color: 'var(--text-muted)' }}>Agent-Native Info Finance</div>
              </div>
            </div>

            <div className="flex items-center gap-5 text-xs" style={{ color: 'var(--text-muted)' }}>
              <a href="/markets" className="hover:text-white transition-colors">Browse Markets</a>
              <a href="/leaderboard" className="hover:text-white transition-colors">Leaderboard</a>
              <a href="/creators" className="hover:text-white transition-colors">Creators</a>
            </div>

            <div className="flex items-center gap-2 text-xs" style={{ color: 'var(--text-muted)' }}>
              <div style={{
                width: '5px', height: '5px', background: '#34D399',
                borderRadius: '50%', boxShadow: '0 0 4px #34D399',
              }} />
              Base Sepolia · Ponder · drand · Chainlink CRE
            </div>
          </div>
        </div>
      </footer>
    </main>
  );
}
