import { notFound } from 'next/navigation';
import { MarketDetail } from '@/components/MarketDetail';
import { mockMarkets } from '@/lib/mockData';

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function MarketPage({ params }: PageProps) {
  const { id } = await params;
  const market = mockMarkets.find((m) => m.id === id);

  if (!market) {
    notFound();
  }

  return <MarketDetail market={market} />;
}

export async function generateStaticParams() {
  return mockMarkets.map((market) => ({
    id: market.id,
  }));
}
