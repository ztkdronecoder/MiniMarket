'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Header } from '@/components/Header';
import { getCreators, type CreatorStats } from '@/lib/marketApi';
import { getLabels } from '@/lib/agentApi';
import { shortenAddress } from '@/lib/utils';

export function CreatorsPageContent() {
  const searchParams = useSearchParams();
  const labelFilter = searchParams.get('label') ?? undefined;

  const [creators, setCreators] = useState<CreatorStats[]>([]);
  const [labels, setLabels] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    Promise.all([
      getCreators(30, 0, labelFilter),
      getLabels(),
    ]).then(([c, l]) => {
      if (!cancelled) {
        setCreators(c);
        setLabels(l);
      }
    }).catch((e) => {
      if (!cancelled) console.error('Failed to fetch creators:', e);
    }).finally(() => {
      if (!cancelled) setLoading(false);
    });
    return () => { cancelled = true; };
  }, [labelFilter]);

  return (
    <main className="min-h-screen">
      <Header />

      <div className="container mx-auto px-4 py-8">
        <div className="mb-8">
          <Link href="/" className="btn-ghost inline-flex items-center gap-2 text-sm mb-6">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
            Back to Markets
          </Link>

          <h1 className="text-3xl font-bold mb-2">Top Creators</h1>
          <p className="text-chainlink-text-muted">Market creators ranked by realized PnL from penalties</p>
        </div>

        <div className="flex flex-wrap items-center gap-3 mb-6">
          <span className="text-xs text-chainlink-text-muted">Filter by label:</span>
          <div className="flex flex-wrap gap-2">
            <Link
              href="/creators"
              className={`px-3 py-1.5 rounded-lg text-sm border transition-colors ${
                !labelFilter
                  ? 'bg-chainlink-accent/20 border-chainlink-accent/40 text-chainlink-accent'
                  : 'bg-chainlink-surface border-chainlink-border/50 text-chainlink-text-muted hover:border-chainlink-border'
              }`}
            >
              All
            </Link>
            {labels.map((l) => (
              <Link
                key={l}
                href={`/creators?label=${encodeURIComponent(l)}`}
                className={`px-3 py-1.5 rounded-lg text-sm border transition-colors ${
                  labelFilter === l
                    ? 'bg-chainlink-accent/20 border-chainlink-accent/40 text-chainlink-accent'
                    : 'bg-chainlink-surface border-chainlink-border/50 text-chainlink-text-muted hover:border-chainlink-border'
                }`}
              >
                {l}
              </Link>
            ))}
          </div>
        </div>

        <div className="card-glow">
          {loading ? (
            <div className="text-center py-12">
              <p className="text-chainlink-text-muted">Loading...</p>
            </div>
          ) : creators.length === 0 ? (
            <div className="text-center py-12">
              <p className="text-chainlink-text-muted">No creators found</p>
            </div>
          ) : (
            <div className="space-y-2">
              {creators.map((creator, index) => {
                const isUnknown = creator.creator === "0x0000000000000000000000000000000000000000";
                const content = (
                  <div className="flex items-center gap-4 p-4 rounded-xl hover:bg-chainlink-surface transition-colors border border-transparent hover:border-chainlink-border/50">
                    <div className={`w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold flex-shrink-0 ${
                      index === 0 ? 'bg-yellow-500/20 text-yellow-400 border border-yellow-500/30' :
                      index === 1 ? 'bg-gray-400/20 text-gray-300 border border-gray-400/30' :
                      index === 2 ? 'bg-orange-500/20 text-orange-400 border border-orange-500/30' :
                      'bg-chainlink-surface text-chainlink-text-muted'
                    }`}>
                      {index + 1}
                    </div>

                    <div className="flex-grow min-w-0">
                      <div className="font-mono text-sm">
                        {isUnknown ? "Unknown (pre-index)" : shortenAddress(creator.creator)}
                      </div>
                      <div className="flex items-center gap-4 text-xs text-chainlink-text-muted mt-1">
                        <span>{creator.totalMarkets} markets</span>
                        <span>Avg premium: {(Number(creator.totalPremium) / 1e6 / Math.max(creator.totalMarkets, 1)).toFixed(6)} USDC</span>
                      </div>
                    </div>

                    <div className="flex items-center gap-6 text-right flex-shrink-0">
                      <div>
                        <div className="text-lg font-bold font-mono"
                          style={{ color: Number(creator.totalPnL) >= 0 ? '#34D399' : '#F87171' }}>
                          {(Number(creator.totalPnL) / 1e6).toFixed(6)} USDC
                        </div>
                        <div className="text-xs text-chainlink-text-muted">Realized PnL</div>
                      </div>
                    </div>
                  </div>
                );
                return isUnknown ? (
                  <div key={creator.creator} className="opacity-75">
                    {content}
                  </div>
                ) : (
                  <Link key={creator.creator} href={`/agent/${creator.creator}`}>
                    {content}
                  </Link>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </main>
  );
}
