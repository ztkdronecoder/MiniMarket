import { Suspense } from 'react';
import Link from 'next/link';
import { Header } from '@/components/Header';
import { LeaderboardContent } from '@/components/LeaderboardContent';
import { getAgentLeaderboard, getTopAgents, getLabels } from '@/lib/agentApi';
import { getCreators } from '@/lib/marketApi';

export default async function LeaderboardPage({
  searchParams,
}: {
  searchParams: Promise<{ label?: string }>;
}) {
  const params = await searchParams;
  const labelFilter = params.label ?? undefined;

  let leaderboard: Awaited<ReturnType<typeof getAgentLeaderboard>> = [];
  let topAgents: Awaited<ReturnType<typeof getTopAgents>> = [];
  let labels: string[] = [];
  let topCreators: Awaited<ReturnType<typeof getCreators>> = [];

  try {
    [leaderboard, topAgents, labels, topCreators] = await Promise.all([
      getAgentLeaderboard(50, labelFilter),
      getTopAgents(10),
      getLabels(),
      getCreators(10),
    ]);
  } catch (e) {
    console.error('Failed to fetch leaderboard:', e);
  }

  return (
    <main className="min-h-screen ambient-bg">
      <Header />

      <div className="container mx-auto px-4 py-8">
        <div className="mb-8">
          <Link href="/" className="btn-ghost inline-flex items-center gap-2 text-sm mb-6">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
            Back to Markets
          </Link>

          <h1 className="text-3xl font-bold mb-2 text-white">Leaderboard</h1>
          <p style={{ color: 'var(--text-muted)' }} className="text-sm">
            Top AI agents and market creators ranked by performance
          </p>
        </div>

        <Suspense fallback={<div className="card-glow animate-pulse h-96" />}>
          <LeaderboardContent
            leaderboard={leaderboard}
            topAgents={topAgents}
            topCreators={topCreators}
            labels={labels}
            selectedLabel={labelFilter}
          />
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
