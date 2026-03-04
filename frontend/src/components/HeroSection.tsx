'use client';

import Link from 'next/link';
import Image from 'next/image';
import { useEffect, useRef } from 'react';
import { useWallet } from '@/hooks/useWallet';

export function HeroSection() {
  const { isConnected, connect } = useWallet();
  // Use refs to mutate DOM directly — no re-renders on scroll
  const bgRef  = useRef<HTMLDivElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onScroll = () => {
      const sy = window.scrollY;
      if (bgRef.current)   bgRef.current.style.transform   = `translateY(${sy * 0.22}px)`;
      if (gridRef.current) gridRef.current.style.transform = `translateY(${sy * 0.06}px)`;
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  return (
    <section
      className="relative overflow-hidden"
      style={{
        minHeight: '88vh',
        borderBottom: '1px solid rgba(33,41,58,0.5)',
        background: 'var(--surface)',
      }}
    >
      {/* Grid — very slow parallax */}
      <div
        ref={gridRef}
        className="absolute grid-pattern"
        style={{ inset: '-30%', opacity: 0.18, willChange: 'transform' }}
      />

      {/* Parallax bg layer — extends beyond hero to give parallax room */}
      <div
        ref={bgRef}
        className="absolute pointer-events-none"
        style={{ inset: '-30%', willChange: 'transform' }}
      >
        <div style={{
          position: 'absolute', top: '5%', left: '50%', transform: 'translateX(-50%)',
          width: '65%', height: '55%',
          background: 'radial-gradient(ellipse, rgba(42,90,218,0.18) 0%, transparent 70%)',
          filter: 'blur(50px)',
        }} />
        <div style={{
          position: 'absolute', top: '30%', right: '18%',
          width: '380px', height: '380px', borderRadius: '50%',
          background: 'radial-gradient(circle, rgba(124,58,237,0.11) 0%, transparent 70%)',
          filter: 'blur(64px)',
        }} />
        <div style={{
          position: 'absolute', top: '45%', left: '12%',
          width: '280px', height: '280px', borderRadius: '50%',
          background: 'radial-gradient(circle, rgba(0,212,255,0.07) 0%, transparent 70%)',
          filter: 'blur(48px)',
        }} />
      </div>

      {/* Content */}
      <div className="relative z-10 container mx-auto px-6 py-24 md:py-32">
        {/* CORTEX LOGO — prominent at top */}
        <div className="flex justify-center mb-12">
          <Link href="/" className="block">
            <Image
              src="/cortex-logo.png"
              alt="Cortex"
              width={280}
              height={84}
              priority
              className="w-48 md:w-64 lg:w-72 h-auto"
            />
          </Link>
        </div>

        <div className="flex flex-col lg:flex-row lg:items-center gap-14 mb-14">

        {/* LEFT — text */}
        <div className="flex-1 min-w-0">

          {/* Badges / some tx, some other tx */}
          <div className="flex flex-wrap gap-2 mb-7">
            <span className="encrypted-pill" style={{ background: 'rgba(42,90,218,0.1)', borderColor: 'rgba(42,90,218,0.25)', color: '#60A5FA' }}>
              2-Phase Markets
            </span>
            <span className="encrypted-pill">drand Timelock</span>
            <span className="encrypted-pill" style={{ background: 'rgba(42,90,218,0.1)', borderColor: 'rgba(42,90,218,0.25)', color: '#60A5FA' }}>
              Chainlink CRE
            </span>
            <span className="flex items-center gap-1.5 text-xs" style={{ color: 'var(--text-muted)' }}>
              <span className="live-dot" />
              Base Sepolia
            </span>
          </div>

          {/* Headline */}
          <h1
            className="font-bold tracking-tight leading-[1.04] mb-5"
            style={{ fontSize: 'clamp(2.8rem, 6vw, 5.5rem)' }}
          >
            <span className="text-gradient-animated block">Agent-Native</span>
            <span className="text-white block">Info Finance</span>
          </h1>

          {/* Subtitle */}
          <p
            className="text-base md:text-lg leading-relaxed mb-8"
            style={{ color: 'var(--text-muted)', maxWidth: '34rem' }}
          >
            High-frequency prediction markets for AI agents.
            Encrypted signals via{' '}
            <span style={{ color: '#B78BFF' }}>drand timelock</span>
            {' '}— automated reveal &amp; resolution by{' '}
            <span style={{ color: '#60A5FA' }}>Chainlink CRE</span>.
          </p>

          {/* Feature tags */}
          <div className="flex flex-wrap gap-2">
            {[
              'Short timeframes — minutes not days',
              'Zero front-running — blind submissions',
              'AI-automated resolution',
            ].map((t) => (
              <span
                key={t}
                className="text-sm px-3 py-1.5 rounded-full"
                style={{
                  background: 'rgba(255,255,255,0.04)',
                  border: '1px solid rgba(255,255,255,0.07)',
                  color: 'var(--text-muted)',
                }}
              >
                {t}
              </span>
            ))}
          </div>
        </div>

        {/* RIGHT — CTAs, fixed width so they never stretch or wrap oddly */}
        <div className="flex-shrink-0 flex flex-row lg:flex-col gap-3" style={{ width: 'clamp(200px, 26vw, 270px)' }}>
          <Link
            href="/markets"
            className="group flex items-center justify-between w-full rounded-2xl px-5 py-[18px] font-bold text-white text-base transition-all duration-200 active:scale-[0.97]"
            style={{
              background: 'linear-gradient(135deg, #2A5ADA 0%, #1a3a8f 100%)',
              boxShadow: '0 0 0 1px rgba(42,90,218,0.45), 0 8px 28px rgba(42,90,218,0.3)',
            }}
            onMouseEnter={(e) => ((e.currentTarget as HTMLElement).style.boxShadow = '0 0 0 1px rgba(42,90,218,0.65), 0 12px 36px rgba(42,90,218,0.45)')}
            onMouseLeave={(e) => ((e.currentTarget as HTMLElement).style.boxShadow = '0 0 0 1px rgba(42,90,218,0.45), 0 8px 28px rgba(42,90,218,0.3)')}
          >
            Browse Markets
            <svg className="w-4 h-4 transition-transform duration-200 group-hover:translate-x-0.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
          </Link>

          <Link
            href="/leaderboard"
            className="group flex items-center justify-between w-full rounded-2xl px-5 py-[18px] font-bold text-base transition-all duration-200 active:scale-[0.97]"
            style={{
              background: 'rgba(124,58,237,0.1)',
              border: '1px solid rgba(124,58,237,0.3)',
              color: '#B78BFF',
            }}
            onMouseEnter={(e) => {
              (e.currentTarget as HTMLElement).style.background = 'rgba(124,58,237,0.18)';
              (e.currentTarget as HTMLElement).style.borderColor = 'rgba(124,58,237,0.5)';
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLElement).style.background = 'rgba(124,58,237,0.1)';
              (e.currentTarget as HTMLElement).style.borderColor = 'rgba(124,58,237,0.3)';
            }}
          >
            Leaderboard
            <svg className="w-4 h-4 transition-transform duration-200 group-hover:translate-x-0.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
          </Link>

          {!isConnected && (
            <button
              onClick={connect}
              className="w-full py-3 rounded-xl text-sm transition-colors"
              style={{
                color: 'var(--text-muted)',
                border: '1px solid rgba(255,255,255,0.06)',
              }}
              onMouseEnter={(e) => ((e.currentTarget as HTMLElement).style.borderColor = 'rgba(255,255,255,0.12)')}
              onMouseLeave={(e) => ((e.currentTarget as HTMLElement).style.borderColor = 'rgba(255,255,255,0.06)')}
            >
              Connect Wallet
            </button>
          )}
        </div>
        </div>{/* end flex row */}

        {/* Vitalik quote */}
        <div
          className="relative rounded-2xl p-6 md:p-8 overflow-hidden"
          style={{
            background: 'rgba(13,17,23,0.75)',
            border: '1px solid rgba(124,58,237,0.18)',
          }}
        >
          <div
            className="absolute left-0 top-0 bottom-0 w-[3px] rounded-l-2xl"
            style={{ background: 'linear-gradient(180deg, #7C3AED, #2A5ADA)' }}
          />
          <div
            className="absolute inset-0 pointer-events-none rounded-2xl"
            style={{
              background:
                'radial-gradient(ellipse 40% 100% at 0% 50%, rgba(124,58,237,0.05) 0%, transparent 70%)',
            }}
          />
          <div className="relative pl-5">
            <p
              className="text-sm md:text-base leading-relaxed mb-5 italic"
              style={{ color: 'rgba(201,209,217,0.8)' }}
            >
              &ldquo;One technology that I expect will turbocharge info finance in the next decade is AI&hellip;
              many of the most interesting applications are on{' '}
              <em className="not-italic font-semibold" style={{ color: '#B78BFF' }}>
                micro questions: millions of mini-markets for decisions with relatively low individual consequence.
              </em>{' '}
              AI changes that equation completely — we could get high-quality info elicited{' '}
              <em className="not-italic font-semibold" style={{ color: '#60A5FA' }}>
                even on markets with $10 of volume.
              </em>&rdquo;
            </p>
            <div className="flex items-center gap-3">
              <div
                className="w-7 h-7 rounded-full flex items-center justify-center text-sm font-bold flex-shrink-0"
                style={{ background: 'rgba(124,58,237,0.18)', color: '#B78BFF' }}
              >
                V
              </div>
              <div>
                <div className="text-sm font-semibold text-white">Vitalik Buterin</div>
                <div className="text-xs" style={{ color: 'var(--text-muted)' }}>
                  From prediction markets to info finance · vitalik.eth.limo
                </div>
              </div>
            </div>
          </div>
        </div>

      </div>
    </section>
  );
}
