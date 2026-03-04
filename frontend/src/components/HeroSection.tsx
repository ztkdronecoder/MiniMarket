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
        {/* CORTEX LOGO — 2x size, shifted right, with Convergence under it */}
        <div className="absolute left-0 right-0 top-24 md:top-32 flex flex-col items-end pr-8 md:pr-16 lg:pr-24 pointer-events-none z-0">
          <Link href="/" className="block pointer-events-auto" style={{ transform: 'translateX(60px)' }}>
            <Image
              src="/cortex-logo.png"
              alt="Cortex"
              width={800}
              height={240}
              priority
              className="w-[560px] md:w-[720px] lg:w-[840px] max-w-[90vw] h-auto"
            />
          </Link>
          <div className="flex flex-col items-center gap-1 pointer-events-auto text-white mt-[140px] md:mt-[188px]">
            <span className="text-xs uppercase tracking-[0.35em]">built for</span>
            <img src="/convergence-logo.svg" alt="CONVERGENCE" className="w-[420px] md:w-[560px] lg:w-[640px] max-w-[90vw] h-auto" />
            <span className="text-xs uppercase tracking-[0.3em]">chainlink hackathon</span>
          </div>
        </div>

        <div className="relative z-10 flex flex-col lg:flex-row lg:items-center gap-14 mb-14">

        {/* LEFT — text */}
        <div className="flex-1 min-w-0">

          {/* Headline — extra spacing so descenders (g) aren't clipped */}
          <h1
            className="font-bold tracking-tight mb-5 overflow-visible"
            style={{ fontSize: 'clamp(2.8rem, 6vw, 5.5rem)', lineHeight: 1.15, letterSpacing: '-0.02em' }}
          >
            <span className="text-gradient-animated block pb-0.5">Agent-Native</span>
            <span className="text-white block">Info Finance</span>
          </h1>

          {/* Subtitle */}
          <p
            className="text-base md:text-lg leading-relaxed mb-8"
            style={{ color: 'var(--text-muted)', maxWidth: '34rem' }}
          >
            High-frequency prediction markets for AI agents.
            Encrypted signals via{' '}
            <span className="text-white/90">drand timelock</span>
            {' '}— automated reveal &amp; resolution by{' '}
            <span className="text-white/90">Chainlink CRE</span>.
          </p>

        </div>

        {/* RIGHT — Connect Wallet when not connected */}
        {!isConnected && (
          <div className="flex-shrink-0">
            <button
              onClick={connect}
              className="py-3 px-6 rounded-xl text-sm transition-colors"
              style={{
                color: 'var(--text-muted)',
                border: '1px solid rgba(255,255,255,0.06)',
              }}
              onMouseEnter={(e) => ((e.currentTarget as HTMLElement).style.borderColor = 'rgba(255,255,255,0.12)')}
              onMouseLeave={(e) => ((e.currentTarget as HTMLElement).style.borderColor = 'rgba(255,255,255,0.06)')}
            >
              Connect Wallet
            </button>
          </div>
        )}
        </div>{/* end flex row */}

        {/* Vitalik quote — compact, left */}
        <div
          className="relative rounded-xl p-4 max-w-xl overflow-hidden"
          style={{
            background: 'rgba(13,17,23,0.75)',
            border: '1px solid rgba(255,255,255,0.12)',
          }}
        >
          <div
            className="absolute left-0 top-0 bottom-0 w-[3px] rounded-l-xl"
            style={{ background: 'linear-gradient(180deg, rgba(255,255,255,0.4), rgba(255,255,255,0.15))' }}
          />
          <div
            className="absolute inset-0 pointer-events-none rounded-xl"
            style={{
              background:
                'radial-gradient(ellipse 40% 100% at 0% 50%, rgba(255,255,255,0.02) 0%, transparent 70%)',
            }}
          />
          <div className="relative pl-4">
            <p
              className="text-xs leading-relaxed mb-3 italic"
              style={{ color: 'rgba(201,209,217,0.85)' }}
            >
              &ldquo;One technology that I expect will turbocharge info finance in the next decade is AI (whether LLMs or some future technology). This is because many of the most interesting applications of info finance are on &ldquo;micro&rdquo; questions: millions of mini-markets for decisions that individually have relatively low consequence. In practice, markets with low volume often do not work effectively: it does not make sense for a sophisticated participant to spend the time to make a detailed analysis just for the sake of a few hundred dollars of profit, and many have even argued that without subsidies such markets won&rsquo;t work at all because on all but the most large and sensational questions, there are not enough naive traders for sophisticated traders to take profit from. AI changes that equation completely, and means that we could potentially get reasonably high-quality info elicited even on markets with $10 of volume. Even if subsidies are required, the size of the subsidy per question becomes extremely affordable.&rdquo;
            </p>
            <div className="flex items-center gap-2">
              <div
                className="w-5 h-5 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0"
                style={{ background: 'rgba(255,255,255,0.1)', color: 'rgba(255,255,255,0.9)' }}
              >
                V
              </div>
              <div>
                <div className="text-xs font-semibold text-white">Vitalik Buterin</div>
                <div className="text-[10px]" style={{ color: 'var(--text-muted)' }}>
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
