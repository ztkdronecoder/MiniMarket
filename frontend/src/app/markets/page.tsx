import { Suspense } from 'react';
import Link from 'next/link';
import { Header } from '@/components/Header';
import { MarketList } from '@/components/MarketList';

export default function MarketsPage() {
  return (
    <main className="min-h-screen ambient-bg">
      <Header />

      <div className="container mx-auto px-4 py-8">
        <div className="mb-6">
          <Link href="/" className="btn-ghost inline-flex items-center gap-2 text-sm mb-4">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
            Back
          </Link>
          <h1 className="text-3xl font-bold text-white mb-1">Markets</h1>
          <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
            High-frequency info markets — live on Base Sepolia
          </p>
        </div>

        <Suspense
          fallback={
            <div className="space-y-3">
              {[1, 2, 3].map((i) => (
                <div key={i} className="rounded-2xl animate-pulse h-40"
                  style={{ background: 'rgba(22,27,34,0.5)' }} />
              ))}
            </div>
          }
        >
          <MarketList />
        </Suspense>
      </div>

      <footer
        className="border-t py-6 mt-8"
        style={{ borderColor: 'rgba(33,41,58,0.5)', background: 'rgba(10,14,23,0.6)' }}
      >
        <div className="container mx-auto px-4 text-center text-xs" style={{ color: 'var(--text-muted)' }}>
          Powered by Ponder · drand · Chainlink CRE · Base Sepolia
        </div>
      </footer>
    </main>
  );
}
