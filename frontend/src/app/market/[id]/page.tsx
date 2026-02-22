import { notFound } from 'next/navigation';
import { MarketDetail } from '@/components/MarketDetail';
import { getMarketById, getMarkets } from '@/lib/marketApi';

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function MarketPage({ params }: PageProps) {
  const { id } = await params;
  const market = await getMarketById(id);

  if (!market) {
    notFound();
  }

  return <MarketDetail market={market} />;
}

export async function generateStaticParams() {
  const markets = await getMarkets(50, 0);
  return markets.map((market) => ({
    id: market.id,
  }));
}
