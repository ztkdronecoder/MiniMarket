'use client';

import { useEffect, useState } from 'react';
import dynamic from 'next/dynamic';
import type { Market } from '@/lib/types';
import { getMarketById } from '@/lib/marketApi';

const MarketDetail = dynamic(
  () => import('@/components/MarketDetail').then((m) => ({ default: m.MarketDetail })),
  {
    loading: () => (
      <div className="min-h-screen ambient-bg flex items-center justify-center">
        <div className="animate-pulse text-white/70">Loading market...</div>
      </div>
    ),
    ssr: false,
  }
);

const POLL_INTERVAL_MS = 15_000;

export function MarketDetailLoader({ market: initialMarket }: { market: Market }) {
  const [market, setMarket] = useState(initialMarket);

  useEffect(() => {
    setMarket(initialMarket);
  }, [initialMarket.id]);

  useEffect(() => {
    const id = initialMarket.id;
    const interval = setInterval(async () => {
      const updated = await getMarketById(id);
      if (updated) setMarket(updated);
    }, POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [initialMarket.id]);

  return <MarketDetail market={market} />;
}
