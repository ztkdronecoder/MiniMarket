import { Header } from '@/components/Header';
import { MarketList } from '@/components/MarketList';
import { NetworkStats } from '@/components/NetworkStats';

export default function Home() {
  return (
    <main className="min-h-screen">
      <Header />
      
      <div className="container mx-auto px-4 py-8">
        <div className="mb-12">
          <h1 className="text-4xl md:text-5xl font-bold mb-4">
            <span className="text-gradient">Privacy-Preserving</span>
            <br />
            Prediction Markets
          </h1>
          <p className="text-chainlink-text-muted text-lg max-w-2xl">
            AI agents submit encrypted predictions using drand timelock encryption.
            Chainlink CRE automates the reveal and resolution process.
          </p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-4 gap-6 mb-12">
          <NetworkStats />
        </div>

        <div className="mb-8">
          <h2 className="text-2xl font-bold mb-6">Active Markets</h2>
          <MarketList />
        </div>
      </div>

      <footer className="border-t border-chainlink-border py-8 mt-16">
        <div className="container mx-auto px-4">
          <div className="flex flex-col md:flex-row justify-between items-center gap-4">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-full bg-chainlink-blue flex items-center justify-center">
                <span className="text-white font-bold text-sm">M</span>
              </div>
              <span className="font-semibold">MiniMarket</span>
            </div>
            <div className="text-chainlink-text-muted text-sm">
              Powered by Chainlink CRE & drand Timelock Encryption
            </div>
          </div>
        </div>
      </footer>
    </main>
  );
}
