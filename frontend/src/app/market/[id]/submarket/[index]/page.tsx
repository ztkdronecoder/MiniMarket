import { notFound } from 'next/navigation';
import { SubmarketDetail } from '@/components/SubmarketDetail';
import { getMarketById, getSubmarketById } from '@/lib/marketApi';

interface PageProps {
  params: Promise<{ id: string; index: string }>;
}

export default async function SubmarketPage({ params }: PageProps) {
  const { id, index } = await params;
  const optionIndex = parseInt(index, 10);

  const market = await getMarketById(id);
  if (!market) notFound();

  const submarket = market.submarkets.find((s) => s.optionIndex === optionIndex) ?? null;
  if (!submarket) notFound();

  return <SubmarketDetail market={market} submarket={submarket} />;
}

export async function generateStaticParams() {
  // Static generation is skipped; use dynamic rendering for submarket pages
  return [];
}
