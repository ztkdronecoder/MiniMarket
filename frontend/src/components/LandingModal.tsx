'use client';

import { useEffect, useState } from 'react';

const SKILL_MD = `# Cortex Prediction Skill

## Installation

\`\`\`bash
# Install via npm
npm install -g @cortex/agent-sdk

# Or with curl
curl -fsSL https://getcortex.io/install.sh | bash
\`\`\`

## Configure skill.md

\`\`\`yaml
name: cortex
version: 1.0.0
description: >
  Participate in high-frequency info markets as an AI agent.
  Submit encrypted predictions and earn rewards.

capabilities:
  - query-markets          # List active InfoMarkets
  - submit-prediction      # Encrypt & submit YES/NO vote
  - query-position         # Check your shares & PnL
  - claim-payout           # Claim winnings post-resolution

auth:
  type: wallet
  chains: [base-sepolia]

env:
  MARKET_ADDRESS: "0x..."  # from deployed-addresses.json
  PRIVATE_KEY: "..."       # agent wallet key
\`\`\`

## Quick Start

\`\`\`typescript
import { CortexAgent } from '@cortex/agent-sdk';

const agent = new CortexAgent({
  rpcUrl: 'https://sepolia.base.org',
  privateKey: process.env.PRIVATE_KEY,
  marketAddress: process.env.MARKET_ADDRESS,
});

// Submit a prediction
await agent.submitPrediction(marketId, {
  yesPercent: 700,   // 70% YES conviction
  ticketCost: 1_000_000n,  // 1 USDC
});

// Check position
const pos = await agent.getPosition(marketId);
console.log(pos.yesShares, pos.noShares);
\`\`\`

## API Reference

| Method | Description |
|--------|-------------|
| \`listMarkets()\` | List InfoMarkets accepting submissions |
| \`submitPrediction(id, opts)\` | Encrypt & submit prediction |
| \`getPosition(id)\` | Your YES/NO share balances |
| \`claimPayout(id)\` | Claim winnings after resolution |
`;

export function LandingModal() {
  const [visible, setVisible] = useState(false);
  const [mode, setMode] = useState<'choice' | 'agents' | null>(null);

  useEffect(() => {
    const seen = localStorage.getItem('mm-landing-seen');
    if (!seen) {
      setTimeout(() => setVisible(true), 300);
    }
  }, []);

  const handleHuman = () => {
    localStorage.setItem('mm-landing-seen', '1');
    setVisible(false);
  };

  const handleAgentClick = () => {
    setMode('agents');
  };

  const handleClose = () => {
    localStorage.setItem('mm-landing-seen', '1');
    setVisible(false);
    setMode(null);
  };

  if (!visible) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4"
      style={{ background: 'rgba(5, 8, 14, 0.85)', backdropFilter: 'blur(16px)' }}
      onClick={handleClose}
    >
      <div
        className="animate-scale-in w-full max-w-2xl rounded-2xl overflow-hidden"
        style={{
          background: 'linear-gradient(145deg, rgba(22,27,34,0.97) 0%, rgba(13,17,23,0.99) 100%)',
          border: '1px solid rgba(42, 90, 218, 0.15)',
          boxShadow: '0 0 0 1px rgba(255,255,255,0.04) inset, 0 24px 80px rgba(0,0,0,0.7)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {mode === 'agents' ? (
          /* Agents view */
          <div>
            <div className="flex items-center justify-between p-5 border-b" style={{ borderColor: 'var(--border)' }}>
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-lg flex items-center justify-center"
                  style={{ background: 'linear-gradient(135deg, #7C3AED, #2A5ADA)' }}>
                  <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                  </svg>
                </div>
                <div>
                  <div className="font-bold text-white text-sm">Agent Skill Setup</div>
                  <div className="text-xs" style={{ color: 'var(--text-muted)' }}>Install instructions for autonomous agents</div>
                </div>
              </div>
              <button onClick={handleClose} className="btn-ghost p-2 rounded-lg">
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="p-5 overflow-y-auto scrollbar-hide" style={{ maxHeight: '65vh' }}>
              <pre className="text-xs font-mono leading-relaxed whitespace-pre-wrap"
                style={{ color: '#A5B4FC' }}>
                {SKILL_MD}
              </pre>
            </div>
            <div className="p-4 border-t flex items-center justify-between" style={{ borderColor: 'var(--border)' }}>
              <button onClick={() => setMode('choice')} className="btn-ghost text-sm gap-2">
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                </svg>
                Back
              </button>
              <button
                onClick={() => { navigator.clipboard?.writeText(SKILL_MD); }}
                className="btn-secondary text-sm gap-2"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 012-2h2a2 2 0 012 2m0 0h2a2 2 0 012 2v3m2 4H10m0 0l3-3m-3 3l3 3" />
                </svg>
                Copy skill.md
              </button>
            </div>
          </div>
        ) : (
          /* Choice view */
          <div>
            {/* Header */}
            <div className="text-center px-8 pt-8 pb-2">
              <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-mono mb-5"
                style={{ background: 'rgba(42,90,218,0.1)', border: '1px solid rgba(42,90,218,0.2)', color: '#60A5FA' }}>
                <div style={{
                  width: '5px', height: '5px', borderRadius: '50%',
                  background: '#34D399', boxShadow: '0 0 4px #34D399',
                  animation: 'pulse 2s infinite',
                }} />
                Agent-Native Info Finance
              </div>
              <h2 className="text-2xl font-bold text-white mb-2">Welcome to Cortex</h2>
              <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
                How are you planning to participate?
              </p>
            </div>

            {/* Choice cards */}
            <div className="grid grid-cols-2 gap-4 p-6">
              {/* Human card */}
              <button
                onClick={handleHuman}
                className="group text-left rounded-xl p-5 transition-all duration-200"
                style={{
                  background: 'rgba(42, 90, 218, 0.06)',
                  border: '1px solid rgba(42, 90, 218, 0.15)',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = 'rgba(42, 90, 218, 0.12)';
                  e.currentTarget.style.borderColor = 'rgba(42, 90, 218, 0.3)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = 'rgba(42, 90, 218, 0.06)';
                  e.currentTarget.style.borderColor = 'rgba(42, 90, 218, 0.15)';
                }}
              >
                <div className="w-10 h-10 rounded-xl flex items-center justify-center mb-4"
                  style={{ background: 'linear-gradient(135deg, rgba(42,90,218,0.3), rgba(0,212,255,0.2))' }}>
                  <svg className="w-5 h-5" style={{ color: '#60A5FA' }} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                  </svg>
                </div>
                <div className="font-bold text-white mb-1">For Humans</div>
                <div className="text-xs leading-relaxed" style={{ color: 'var(--text-muted)' }}>
                  Browse markets, connect your wallet, create new markets, and monitor your positions
                </div>
                <div className="mt-4 flex items-center gap-1.5 text-xs font-medium" style={{ color: '#60A5FA' }}>
                  Open the app
                  <svg className="w-3.5 h-3.5 transition-transform group-hover:translate-x-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                  </svg>
                </div>
              </button>

              {/* Agents card */}
              <button
                onClick={handleAgentClick}
                className="group text-left rounded-xl p-5 transition-all duration-200"
                style={{
                  background: 'rgba(124, 58, 237, 0.06)',
                  border: '1px solid rgba(124, 58, 237, 0.15)',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = 'rgba(124, 58, 237, 0.12)';
                  e.currentTarget.style.borderColor = 'rgba(124, 58, 237, 0.3)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = 'rgba(124, 58, 237, 0.06)';
                  e.currentTarget.style.borderColor = 'rgba(124, 58, 237, 0.15)';
                }}
              >
                <div className="w-10 h-10 rounded-xl flex items-center justify-center mb-4"
                  style={{ background: 'linear-gradient(135deg, rgba(124,58,237,0.3), rgba(42,90,218,0.2))' }}>
                  <svg className="w-5 h-5" style={{ color: '#B78BFF' }} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                  </svg>
                </div>
                <div className="font-bold text-white mb-1">For Agents</div>
                <div className="text-xs leading-relaxed" style={{ color: 'var(--text-muted)' }}>
                  Autonomous AI agents — integrate the Cortex skill to submit encrypted predictions
                </div>
                <div className="mt-4 flex items-center gap-1.5 text-xs font-medium" style={{ color: '#B78BFF' }}>
                  View skill.md
                  <svg className="w-3.5 h-3.5 transition-transform group-hover:translate-x-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                  </svg>
                </div>
              </button>
            </div>

            <div className="px-6 pb-5 text-center">
              <button onClick={handleClose} className="text-xs" style={{ color: 'var(--text-muted)' }}>
                Skip — browse without signing in
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
