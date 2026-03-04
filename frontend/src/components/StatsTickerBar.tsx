'use client';

import { useEffect, useState } from 'react';
import { getMarketCount, getSubmissionCount, getAgentCount } from '@/lib/marketApi';

interface TickerItem {
  label: string;
  value: string;
  accent?: string;
}

export function StatsTickerBar() {
  const [markets,     setMarkets]     = useState('—');
  const [submissions, setSubmissions] = useState('—');
  const [agents,      setAgents]      = useState('—');

  useEffect(() => {
    Promise.all([getMarketCount(), getSubmissionCount(), getAgentCount()])
      .then(([m, s, a]) => {
        setMarkets(m.toString());
        setSubmissions(s.toString());
        setAgents(a.toString());
      })
      .catch(() => {});
  }, []);

  const items: TickerItem[] = [
    { label: 'Markets',                value: markets,           accent: '#60A5FA' },
    { label: 'Encrypted Submissions',  value: submissions,       accent: '#B78BFF' },
    { label: 'Active Agents',          value: agents,            accent: '#34D399' },
    { label: 'Network',                value: 'Base Sepolia',    accent: '#34D399' },
    { label: 'Phase 1',                value: 'drand Timelock Reveal' },
    { label: 'Phase 2',                value: 'Chainlink CRE + Gemini AI' },
    { label: 'Markets',                value: 'High-Frequency · Short Timeframe' },
    { label: 'Submissions',            value: 'Blind · Zero Front-Running' },
    { label: 'Resolution',             value: 'AI-Automated · Trustless' },
  ];

  // Duplicate for seamless loop: animate from 0 → -50% of element width
  const doubled = [...items, ...items];

  return (
    <div
      className="overflow-hidden border-b select-none"
      style={{
        borderColor: 'rgba(33,41,58,0.7)',
        background: 'rgba(8,12,20,0.95)',
        height: '32px',
      }}
    >
      <div
        className="flex items-center h-full"
        style={{ width: 'max-content', animation: 'ticker 55s linear infinite' }}
      >
        {doubled.map((item, i) => (
          <span key={i} className="flex items-center h-full flex-shrink-0">
            <span className="flex items-center gap-2 px-5 text-[11px] whitespace-nowrap">
              <span style={{ color: 'var(--text-muted)' }}>{item.label}</span>
              <span
                className="font-semibold font-mono"
                style={{ color: item.accent ?? 'rgba(255,255,255,0.5)' }}
              >
                {item.value}
              </span>
            </span>
            <span
              className="flex-shrink-0 text-[9px]"
              style={{ color: 'rgba(255,255,255,0.07)', paddingRight: '4px' }}
            >
              ◆
            </span>
          </span>
        ))}
      </div>
    </div>
  );
}
