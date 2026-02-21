'use client';

import { MarketCard } from './MarketCard';
import { mockMarkets } from '@/lib/mockData';

export function MarketList() {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
      {mockMarkets.map((market) => (
        <MarketCard key={market.id} market={market} />
      ))}
    </div>
  );
}
