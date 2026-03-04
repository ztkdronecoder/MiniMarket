'use client';

import React from 'react';

// ── Vertical flow diagram ────────────────────────────────────────────────────
// Nodes are full-width; connectors are a fixed 44px tall → consistent arrow lengths

interface FlowStep {
  node: string;
  action?: string; // label on the connector to the next node
}

function VerticalFlow({ steps, color }: { steps: FlowStep[]; color: string }) {
  return (
    <div className="w-full">
      {steps.map((step, i) => (
        <React.Fragment key={i}>
          {/* Node */}
          <div
            className="w-full flex items-center justify-center px-3 rounded-lg text-xs font-semibold text-center"
            style={{
              height: '38px',
              background: `${color}12`,
              border: `1px solid ${color}28`,
              color: 'rgba(255,255,255,0.82)',
            }}
          >
            {step.node}
          </div>

          {/* Connector — always exactly 44px tall */}
          {step.action && (
            <div
              className="flex flex-col items-center"
              style={{ height: '44px' }}
            >
              <div className="w-px flex-1" style={{ background: `${color}30` }} />
              <span
                className="text-[9px] font-mono leading-none px-1.5 py-0.5 rounded my-0.5 whitespace-nowrap"
                style={{ color: `${color}90`, background: `${color}0a` }}
              >
                {step.action}
              </span>
              <div className="w-px flex-1" style={{ background: `${color}30` }} />
            </div>
          )}
        </React.Fragment>
      ))}
    </div>
  );
}

// ── Phase data ────────────────────────────────────────────────────────────────

const PHASES = [
  {
    id: '0',
    name: 'Phase 0',
    label: 'INFO_COLLECTION',
    title: 'Info Collection',
    color: '#9F67FF',
    bg: 'rgba(124,58,237,0.07)',
    border: 'rgba(124,58,237,0.2)',
    detail: '2–60 min window',
    actors: ['Creator', 'AI Agents'],
    steps: [
      'Creator designs market — question + resolution schema stored on-chain',
      'Agents encrypt predictions (yesPercent / noPercent) via drand timelock',
      'All submissions are blind — zero front-running possible',
      'USDC ticket cost locks each agent\'s stake on-chain',
    ],
    flow: [
      { node: 'Creator / AI Agents',  action: 'createMarket() · submitEncrypted()' },
      { node: 'Cortex.sol',            action: 'MarketCreated · EncryptedSubmission events' },
      { node: 'Ponder Indexer',       action: '/workflows/next-phase1' },
      { node: 'CRE Phase 1' },
    ] as FlowStep[],
  },
  {
    id: '1',
    name: 'Phase 1',
    label: 'TRADING',
    title: 'Trading',
    color: '#60A5FA',
    bg: 'rgba(42,90,218,0.07)',
    border: 'rgba(42,90,218,0.2)',
    detail: 'Fair odds discovery',
    actors: ['CRE Workflow', 'drand', 'Agents'],
    steps: [
      'CRE Phase 1 decrypts all submissions via the drand beacon',
      'Consensus yesPercent computed across all agent signals',
      'Shares allocated by proximity-to-consensus scoring',
      'Agents trade YES/NO shares on AMM — live odds emerge',
    ],
    flow: [
      { node: 'CRE Phase 1',        action: 'fetchBeacon' },
      { node: 'drand Network',       action: 'decrypt · compute consensus · merkle' },
      { node: 'CRE Phase 1',        action: 'onReport(selector = 0)' },
      { node: 'Cortex.sol',           action: 'Phase1Resolved event' },
      { node: 'Ponder Indexer' },
    ] as FlowStep[],
  },
  {
    id: '2',
    name: 'Phase 2',
    label: 'RESOLVED',
    title: 'Resolution',
    color: '#34D399',
    bg: 'rgba(16,185,129,0.07)',
    border: 'rgba(16,185,129,0.2)',
    detail: 'AI-automated',
    actors: ['CRE Workflow', 'Gemini AI'],
    steps: [
      'CRE Phase 2 triggers at tradingEnd — fully autonomous',
      'Gemini 2.5 Flash + Google Search resolves YES / NO',
      'Outcome posted on-chain via Chainlink CRE report',
      'Winners paid; confidently-wrong agents face penalty',
    ],
    flow: [
      { node: 'CRE Phase 2',    action: 'schema + question + grounding' },
      { node: 'Gemini AI',      action: 'YES / NO answer' },
      { node: 'CRE Phase 2',   action: 'onReport(selector = 1)' },
      { node: 'Cortex.sol',     action: 'Phase2Resolved event' },
      { node: 'Ponder Indexer' },
    ] as FlowStep[],
  },
] as const;

// ── Component ─────────────────────────────────────────────────────────────────

export function ProtocolFlow() {
  return (
    <section className="py-20">

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="text-center mb-12">
        <span
          className="inline-flex items-center gap-2 px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-widest mb-5"
          style={{
            background: 'rgba(42,90,218,0.08)',
            border: '1px solid rgba(42,90,218,0.2)',
            color: '#60A5FA',
          }}
        >
          Protocol Architecture
        </span>
        <h2 className="text-3xl md:text-4xl font-bold text-white mb-4">
          Two-Phase Market Design
        </h2>
        <p className="text-base max-w-md mx-auto" style={{ color: 'var(--text-muted)' }}>
          Encrypted info collection → fair price discovery → AI resolution
        </p>
      </div>

      {/* ── Phase Overview Cards ────────────────────────────────────────────── */}
      <div className="flex flex-col md:flex-row gap-px mb-3" style={{ background: 'rgba(33,41,58,0.5)', borderRadius: '16px', overflow: 'hidden' }}>
        {PHASES.map((phase) => (
          <div
            key={phase.id}
            className="flex-1 p-6"
            style={{ background: phase.bg }}
          >
            {/* Phase badge + detail */}
            <div className="flex items-center justify-between mb-5">
              <span
                className="text-[10px] font-bold px-2.5 py-1 rounded-lg uppercase tracking-widest"
                style={{
                  background: `${phase.color}16`,
                  color: phase.color,
                  border: `1px solid ${phase.color}28`,
                }}
              >
                {phase.name}
              </span>
              <span className="text-[10px]" style={{ color: 'var(--text-muted)' }}>
                {phase.detail}
              </span>
            </div>

            {/* Title */}
            <h3 className="text-lg font-bold mb-0.5" style={{ color: phase.color }}>
              {phase.title}
            </h3>
            <div
              className="text-[9px] font-mono uppercase tracking-widest mb-4"
              style={{ color: `${phase.color}55` }}
            >
              {phase.label}
            </div>

            {/* Actors */}
            <div className="flex flex-wrap gap-1.5 mb-5">
              {phase.actors.map((a) => (
                <span
                  key={a}
                  className="text-[10px] px-2 py-0.5 rounded-full"
                  style={{
                    background: 'rgba(255,255,255,0.05)',
                    border: '1px solid rgba(255,255,255,0.08)',
                    color: 'var(--text-muted)',
                  }}
                >
                  {a}
                </span>
              ))}
            </div>

            {/* Step list */}
            <ul className="space-y-2.5">
              {phase.steps.map((step, si) => (
                <li key={si} className="flex items-start gap-2 text-xs" style={{ color: 'var(--text-muted)' }}>
                  <span
                    className="w-4 h-4 rounded flex items-center justify-center text-[9px] font-bold flex-shrink-0 mt-0.5"
                    style={{ background: `${phase.color}16`, color: phase.color }}
                  >
                    {si + 1}
                  </span>
                  {step}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>

      {/* ── Per-Phase Data Flow Diagrams ────────────────────────────────────── */}
      <div
        className="rounded-2xl overflow-hidden"
        style={{ border: '1px solid rgba(33,41,58,0.7)', background: 'rgba(13,17,23,0.6)' }}
      >
        {/* Header */}
        <div
          className="px-6 py-3 flex items-center gap-2"
          style={{ borderBottom: '1px solid rgba(33,41,58,0.7)', background: 'rgba(13,17,23,0.4)' }}
        >
          <span className="text-[10px] font-bold uppercase tracking-widest" style={{ color: 'var(--text-muted)' }}>
            System Data Flow
          </span>
          <span className="text-[10px]" style={{ color: 'rgba(255,255,255,0.1)' }}>—</span>
          <span className="text-[10px]" style={{ color: 'var(--text-muted)' }}>
            per-phase interaction between actors, on-chain contracts, and off-chain services
          </span>
        </div>

        {/* Three columns */}
        <div className="flex flex-col md:flex-row">
          {PHASES.map((phase, i) => (
            <div
              key={phase.id}
              className={`flex-1 p-6 ${i > 0 ? 'border-t md:border-t-0 md:border-l' : ''}`}
              style={{ borderColor: 'rgba(33,41,58,0.7)' }}
            >
              <div className="flex items-center gap-2 mb-5">
                <span
                  className="w-2 h-2 rounded-full flex-shrink-0"
                  style={{ background: phase.color, boxShadow: `0 0 6px ${phase.color}80` }}
                />
                <span className="text-xs font-semibold" style={{ color: phase.color }}>
                  {phase.name} · {phase.title}
                </span>
              </div>
              <VerticalFlow steps={phase.flow as FlowStep[]} color={phase.color} />
            </div>
          ))}
        </div>
      </div>

      {/* ── Incentive note ─────────────────────────────────────────────────── */}
      <div
        className="mt-4 rounded-xl px-5 py-4 flex flex-col sm:flex-row gap-4 items-start sm:items-center"
        style={{
          background: 'rgba(42,90,218,0.04)',
          border: '1px solid rgba(42,90,218,0.13)',
        }}
      >
        <div
          className="w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0"
          style={{ background: 'rgba(42,90,218,0.14)' }}
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" style={{ color: '#60A5FA' }}>
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
              d="M13 10V3L4 14h7v7l9-11h-7z" />
          </svg>
        </div>
        <p className="text-xs leading-relaxed" style={{ color: 'var(--text-muted)' }}>
          <span className="font-semibold" style={{ color: '#60A5FA' }}>Incentive design: </span>
          share allocation rewards agents closest to consensus (proximity-to-consensus scoring).
          Agents who are{' '}
          <span style={{ color: '#B78BFF' }}>confidently wrong</span>{' '}
          receive a proportional payout penalty that flows to the market creator.
        </p>
      </div>
    </section>
  );
}
