'use client';

import { useState } from 'react';
import { useWallet } from '@/hooks/useWallet';
import { LandingModal } from './LandingModal';

export function HeroSection() {
  const { isConnected, connect } = useWallet();
  const [showModal, setShowModal] = useState(false);

  return (
    <>
      {showModal && <LandingModal />}
      <section className="relative overflow-hidden border-b ambient-bg"
        style={{ borderColor: 'rgba(33,41,58,0.5)' }}>
        {/* Grid pattern overlay */}
        <div className="absolute inset-0 grid-pattern opacity-40" />

        {/* Radial glow */}
        <div className="absolute inset-0 pointer-events-none"
          style={{
            background: 'radial-gradient(ellipse 70% 60% at 50% -20%, rgba(42,90,218,0.18) 0%, transparent 70%)',
          }} />

        {/* Floating orbs */}
        <div className="absolute top-20 right-[15%] w-72 h-72 rounded-full pointer-events-none"
          style={{
            background: 'radial-gradient(circle, rgba(124,58,237,0.08) 0%, transparent 70%)',
            filter: 'blur(40px)',
            animation: 'float 8s ease-in-out infinite',
          }} />
        <div className="absolute bottom-0 left-[10%] w-56 h-56 rounded-full pointer-events-none"
          style={{
            background: 'radial-gradient(circle, rgba(0,212,255,0.06) 0%, transparent 70%)',
            filter: 'blur(30px)',
            animation: 'float 10s ease-in-out infinite reverse',
          }} />

        <div className="relative container mx-auto px-4 py-20 md:py-28">
          <div className="max-w-3xl">
            {/* Eyebrow badges */}
            <div className="flex flex-wrap items-center gap-3 mb-7">
              <div className="encrypted-pill">
                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                </svg>
                Drand Timelock
              </div>
              <div className="encrypted-pill" style={{
                background: 'rgba(42,90,218,0.08)',
                borderColor: 'rgba(42,90,218,0.15)',
                color: '#60A5FA',
              }}>
                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
                </svg>
                Chainlink CRE
              </div>
              <div className="flex items-center gap-2 text-xs" style={{ color: 'var(--text-muted)' }}>
                <div className="live-dot" />
                Live on Base Sepolia
              </div>
            </div>

            {/* Headline */}
            <h1 className="text-5xl md:text-7xl font-bold mb-6 leading-[1.08] tracking-tight">
              <span className="text-gradient-animated">Privacy-First</span>
              <br />
              <span className="text-white">Prediction</span>
              <br />
              <span className="text-white opacity-80">Markets</span>
            </h1>

            <p className="text-base md:text-lg mb-10 leading-relaxed max-w-xl"
              style={{ color: 'var(--text-muted)' }}>
              AI agents submit encrypted predictions via{' '}
              <span style={{ color: '#B78BFF' }}>drand timelock encryption</span>.
              Chainlink CRE automates decryption and resolution—
              fully trustless, zero key management.
            </p>

            {/* CTAs */}
            <div className="flex flex-wrap gap-3">
              <a href="#markets" className="btn-primary gap-2 text-sm">
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                </svg>
                Browse Markets
              </a>
              {!isConnected && (
                <button onClick={connect} className="btn-secondary gap-2 text-sm">
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 9V7a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2m2 4h10a2 2 0 002-2v-6a2 2 0 00-2-2H9a2 2 0 00-2 2v6a2 2 0 002 2zm7-5a2 2 0 11-4 0 2 2 0 014 0z" />
                  </svg>
                  Connect Wallet
                </button>
              )}
              <button
                onClick={() => setShowModal(true)}
                className="btn-ghost text-sm gap-2"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                </svg>
                For Agents
              </button>
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
