'use client';

import { useEffect, useState } from 'react';
import { getMarketCount, getSubmissionCount, getAgentCount } from '@/lib/marketApi';

export function NetworkStats() {
  const [marketCount, setMarketCount] = useState<number>(0);
  const [submissionCount, setSubmissionCount] = useState<number>(0);
  const [agentCount, setAgentCount] = useState<number>(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchStats() {
      try {
        const [markets, submissions, agents] = await Promise.all([
          getMarketCount(),
          getSubmissionCount(),
          getAgentCount(),
        ]);
        setMarketCount(markets);
        setSubmissionCount(submissions);
        setAgentCount(agents);
      } catch (error) {
        console.error('Failed to fetch stats:', error);
      } finally {
        setLoading(false);
      }
    }
    fetchStats();
  }, []);

  const stats = [
    {
      label: 'Markets',
      value: loading ? '...' : marketCount.toString(),
      sublabel: 'Total',
      icon: (
        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
        </svg>
      ),
      accent: true,
    },
    {
      label: 'Submissions',
      value: loading ? '...' : submissionCount.toString(),
      sublabel: 'Encrypted',
      icon: (
        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
        </svg>
      ),
      accent: false,
    },
    {
      label: 'Agents',
      value: loading ? '...' : agentCount.toString(),
      sublabel: 'Active',
      icon: (
        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
        </svg>
      ),
      accent: false,
    },
    {
      label: 'Network',
      value: 'Base',
      sublabel: 'Sepolia',
      icon: (
        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M5 12h14M5 12a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v4a2 2 0 01-2 2M5 12a2 2 0 00-2 2v4a2 2 0 002 2h14a2 2 0 002-2v-4a2 2 0 00-2-2" />
        </svg>
      ),
      accent: false,
    },
  ];

  return (
    <>
      {stats.map((stat) => (
        <div key={stat.label} className="card-flat hover:border-chainlink-accent/30 transition-colors duration-300">
          <div className="flex items-start justify-between mb-2">
            <span className="stat-label">{stat.label}</span>
            <div className={`${stat.accent ? 'text-chainlink-accent' : 'text-chainlink-text-muted'}`}>
              {stat.icon}
            </div>
          </div>
          <div className="flex items-baseline gap-1">
            <span className="stat-value text-xl">
              {stat.value}
            </span>
            {stat.sublabel && (
              <span className="text-xs text-chainlink-text-muted">{stat.sublabel}</span>
            )}
          </div>
        </div>
      ))}
    </>
  );
}
