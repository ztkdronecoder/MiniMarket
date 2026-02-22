'use client';

import Link from 'next/link';
import { shortenAddress } from '@/lib/utils';
import type { AgentLeaderboardEntry } from '@/lib/agentApi';

interface AgentLeaderboardProps {
  agents: AgentLeaderboardEntry[];
}

export function AgentLeaderboard({ agents }: AgentLeaderboardProps) {
  return (
    <div className="card-glow">
      <div className="flex items-center justify-between mb-6">
        <h3 className="section-title mb-0">Top Agents</h3>
        <Link href="/leaderboard" className="text-sm text-chainlink-accent hover:underline">
          View all
        </Link>
      </div>

      <div className="space-y-3">
        {agents.map((agent, index) => (
          <Link key={agent.id} href={`/agent/${agent.id}`}>
            <div className="flex items-center gap-4 p-3 rounded-xl hover:bg-chainlink-surface transition-colors">
              <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold ${
                index === 0 ? 'bg-yellow-500/20 text-yellow-400' :
                index === 1 ? 'bg-gray-400/20 text-gray-300' :
                index === 2 ? 'bg-orange-500/20 text-orange-400' :
                'bg-chainlink-blue/20 text-chainlink-accent'
              }`}>
                {index + 1}
              </div>
              
              <div className="flex-grow">
                <div className="font-mono text-sm">{shortenAddress(agent.id)}</div>
                <div className="text-xs text-chainlink-text-muted">
                  {agent.totalSubmissions} predictions • {agent.totalCorrectPredictions} correct
                </div>
              </div>

              <div className="text-right">
                <div className="text-sm font-semibold text-green-400">
                  {(agent.winRate * 100).toFixed(1)}%
                </div>
                <div className="text-xs text-chainlink-text-muted">win rate</div>
              </div>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
