import { notFound } from 'next/navigation';
import { MarketDetail } from '@/components/MarketDetail';
import { getMarketById } from '@/lib/marketApi';

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

  return <MarketDetail market={market} />;
}
