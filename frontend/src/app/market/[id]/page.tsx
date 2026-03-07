import { notFound } from 'next/navigation';
import { getMarketById } from '@/lib/marketApi';
import { MarketDetailLoader } from '@/components/MarketDetailLoader';

export const dynamic = 'force-dynamic';

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function MarketPage({ params }: PageProps) {
  const { id } = await params;
  const market = await getMarketById(id);

  if (!market) {
    notFound();
  }

  return <MarketDetailLoader market={market} />;
}
