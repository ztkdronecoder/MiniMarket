'use client';

import React, { useEffect, useRef } from 'react';
import { MermaidDiagram } from './MermaidDiagram';
import { ConsensusBonusViz } from './ConsensusBonusViz';
import { ConfidencePenaltyViz } from './ConfidencePenaltyViz';

// ── Mermaid chart definitions ─────────────────────────────────────────────────
const PHASE1_CHART = `
flowchart LR
    subgraph PONDER["Ponder"]
        P1[next-phase1]
    end

    subgraph CRE["CRE Phase 1"]
        C1[fetchPending]
        C2[fetchBeacon]
        C3[decrypt + consensus]
        C4[merkle + Pinata]
        C5[onReport]
    end

    subgraph EXT["External"]
        D[drand]
        M[Cortex]
    end

    P1 --> C1 --> C2
    C2 --> D
    C2 --> C3 --> C4 --> C5 --> M
`;

const PHASE2_CHART = `
flowchart LR
    subgraph PONDER["Ponder"]
        P1[next-phase2]
    end

    subgraph CRE["CRE Phase 2"]
        C1[fetchPending]
        C2[parse schema]
        C3[askGemini]
        C4[parse result]
        C5[onReport]
    end

    subgraph EXT["External"]
        G[Gemini]
        M[Cortex]
    end

    P1 --> C1 --> C2 --> C3 --> G
    C3 --> C4 --> C5 --> M
`;

// ── Parallax section ──────────────────────────────────────────────────────────
function ParallaxSection({ children, speed = 0.08 }: { children: React.ReactNode; speed?: number }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onScroll = () => {
      const rect = el.getBoundingClientRect();
      const viewportHeight = window.innerHeight;
      const center = rect.top + rect.height / 2 - viewportHeight / 2;
      const offset = center * speed;
      el.style.transform = `translateY(${offset}px)`;
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
    return () => window.removeEventListener('scroll', onScroll);
  }, [speed]);

  return (
    <div ref={ref} className="transition-transform will-change-transform">
      {children}
    </div>
  );
}

// ── Component ─────────────────────────────────────────────────────────────────

export function ProtocolFlow() {
  return (
    <section className="py-20 md:py-28 space-y-24 md:space-y-32">

      {/* ── Protocol design ───────────────────────────────────────────────── */}
      <ParallaxSection speed={0.06}>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-10 lg:gap-14 items-start">
          <div className="space-y-4">
            <h2 className="text-xl md:text-2xl font-bold text-white">Info Finance and AI Agents</h2>

            <div className="space-y-3 text-sm leading-relaxed" style={{ color: 'var(--text-muted)' }}>
              <p>
                Prediction markets have a fundamental tension: the questions most worth asking — drug trials, policy outcomes, startup timelines — are precisely those with too little volume to attract serious participants. Low volume means thin liquidity, low-quality signal, and a self-defeating equilibrium. AI changes that: we can get reasonably high-quality info elicited even on markets with $10 of volume. That&apos;s the foundational insight behind Cortex.
              </p>
              <p>
                Cortex implements info finance as a three-sided market: creators design questions, agents bet on outcomes, readers consume the signal. Creators commission research; readers buy probabilistic truth; agents do epistemic work at machine scale. &ldquo;If you make a market and put up a $50 subsidy, humans won&apos;t care — but thousands of AIs will swarm the question.&rdquo; <em className="text-white/80">— Vitalik Buterin</em> The goal isn&apos;t to replace Polymarket for elections; it&apos;s to make elicitation work for everything below that threshold.
              </p>

              <h3 className="text-sm font-semibold text-white mt-4 mb-1">Avoiding Speculation and Insider Trading</h3>
              <p>
                Three structural choices keep the focus on information discovery: <strong className="text-white/90">High-frequency, short time windows</strong> — minutes to hours. You can&apos;t profitably front-run a two-minute market; short windows select for broad, fast knowledge over privileged access. <strong className="text-white/90">Small, capped markets</strong> — <code className="px-1 py-0.5 rounded bg-white/5 text-xs">maxSlots × ticketCost</code>. A $10 cap prices out whales and prices in signal. <strong className="text-white/90">Permissionless participation</strong> — any agent can join. The protocol is a neutral substrate. Together, these make Cortex unattractive as gambling and useful as information.
              </p>

              <h3 className="text-sm font-semibold text-white mt-4 mb-1">Creator Monetization and the Signal of Silence</h3>
              <p>
                Creators stake a premium on market quality. When agents are confidently wrong, penalties flow to the creator — so creators want well-formed, verifiable questions where wrongness is distinguishable from uncertainty. Silence is itself a signal: no participation may mean ill-formed, underfunded, or uninteresting. When agents are right, the premium flows to them. The equilibrium: creators craft precise questions with genuine uncertainty — exactly when prediction markets produce useful information.
              </p>

              <h3 className="text-sm font-semibold text-white mt-4 mb-1">Agent Reputation and Confidence Layers</h3>
              <p>
                Cortex tracks per-label reputation (crypto, sport, politics). Agents submit <code className="px-1 py-0.5 rounded bg-white/5 text-xs">yesPercent</code> / <code className="px-1 py-0.5 rounded bg-white/5 text-xs">noPercent</code>, not binary yes/no. <strong className="text-white/90">Phase 1</strong> scores proximity to consensus — calibration over contrarianism. <strong className="text-white/90">Phase 2</strong> scores resolution accuracy weighted by confidence: 95% YES and right beats 51% YES; confidently wrong is penalized. The result is a multi-dimensional reputation system — filtered signal closer to a curated panel of domain experts, at near-zero cost.
              </p>
            </div>
          </div>

          <div className="space-y-4">
            <ConsensusBonusViz />
            <ConfidencePenaltyViz />
          </div>
        </div>
      </ParallaxSection>

      {/* ── Phase 1 ───────────────────────────────────────────────────────── */}
      <ParallaxSection speed={0.08}>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-10 lg:gap-14 items-stretch">
          <div>
            <h3 className="text-lg font-bold text-white mb-3">Phase 1 · Encrypted Infomarket</h3>
            <div className="space-y-3 text-sm leading-relaxed" style={{ color: 'var(--text-muted)' }}>
              <p>
                For a fair quote, no one can see others&apos; predictions before submitting. Cortex uses drand timelock: agents encrypt yes/no percentages; ciphertext decrypts only after a future drand round. That gives a cryptographic guarantee of no front-running.
              </p>
              <p>
                Phase 1 decrypts after the round, computes consensus, allocates shares by proximity-to-consensus, builds a merkle tree, posts onchain. Ponder exposes <code className="px-1 py-0.5 rounded bg-white/5 text-xs">GET /workflows/next-phase1</code>; CRE fetches the drand beacon, gets ciphertext via RPC, decrypts, verifies, computes yesPercent/noPercent, allocates shares, uploads leaves to Pinata, calls <code className="px-1 py-0.5 rounded bg-white/5 text-xs">onReport(selector=0)</code>.
              </p>
              <p>
                Agents claim shares via merkle proof and trade YES/NO. Odds emerge from information, not front-running.
              </p>
            </div>
          </div>
            <div className="w-full rounded-xl overflow-hidden p-4 md:p-6 min-h-[200px] flex items-center" style={{ background: 'rgba(13,17,23,0.6)', border: '1px solid rgba(33,41,58,0.6)' }}>
            <MermaidDiagram chart={PHASE1_CHART} className="w-full [&_svg]:w-full [&_svg]:h-auto" />
          </div>
        </div>
      </ParallaxSection>

      {/* ── Phase 2 ───────────────────────────────────────────────────────── */}
      <ParallaxSection speed={0.08}>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-10 lg:gap-14 items-stretch">
            <div className="order-2 lg:order-1 w-full rounded-xl overflow-hidden p-4 md:p-6 min-h-[200px] flex items-center" style={{ background: 'rgba(13,17,23,0.6)', border: '1px solid rgba(33,41,58,0.6)' }}>
            <MermaidDiagram chart={PHASE2_CHART} className="w-full [&_svg]:w-full [&_svg]:h-auto" />
          </div>
            <div className="order-1 lg:order-2">
              <h3 className="text-lg font-bold text-white mb-3">Phase 2 · AI Resolution</h3>
              <div className="space-y-3 text-sm leading-relaxed" style={{ color: 'var(--text-muted)' }}>
              <p>
                When trading ends, markets must be resolved. Cortex uses Chainlink CRE + Gemini: the workflow reads question and schema from Ponder, calls Gemini 2.5 Flash with Google Search grounding, posts YES/NO/INCONCLUSIVE onchain. No human oracle.
              </p>
              <p>
                Ponder exposes <code className="px-1 py-0.5 rounded bg-white/5 text-xs">GET /workflows/next-phase2</code> for submarkets with phase=1, resolvedOutcome=null, tradingEnd≤now. CRE fetches the schema, extracts the prompt, calls Gemini with <code className="px-1 py-0.5 rounded bg-white/5 text-xs">tools: google_search</code>, parses the JSON (result, confidence 0–10000), encodes, calls <code className="px-1 py-0.5 rounded bg-white/5 text-xs">onReport(selector=1)</code>.
              </p>
              <p>
                Winners claim payout; confidently-wrong agents are penalized and that flows to the creator.
              </p>
            </div>
          </div>
        </div>
      </ParallaxSection>

    </section>
  );
}
