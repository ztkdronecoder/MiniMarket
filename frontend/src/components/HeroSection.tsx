'use client';

import Link from 'next/link';
import Image from 'next/image';

export function HeroSection() {
  return (
    <section
      className="relative overflow-hidden"
      style={{
        minHeight: 'min(88vh, 700px)',
        borderBottom: '1px solid rgba(33,41,58,0.5)',
      }}
    >
      {/* Content */}
      <div className="relative z-10 container mx-auto px-4 sm:px-6 py-12 sm:py-16 md:py-20 lg:py-24">
        {/* CORTEX LOGO — responsive size */}
        <div className="absolute left-0 right-0 top-12 sm:top-16 md:top-24 flex flex-col items-end pr-4 sm:pr-8 md:pr-16 lg:pr-24 pointer-events-none z-0">
          <Link href="/" className="block pointer-events-auto" style={{ transform: 'translateX(30px)' }}>
            <Image
              src="/cortex-logo.png"
              alt="Cortex"
              width={800}
              height={240}
              priority
              className="w-[380px] sm:w-[480px] md:w-[600px] lg:w-[720px] xl:w-[840px] max-w-[85vw] h-auto"
            />
          </Link>
          <div className="flex flex-col items-center gap-1 pointer-events-auto text-white mt-[100px] sm:mt-[120px] md:mt-[150px] lg:mt-[188px]">
            <span className="text-xs uppercase tracking-[0.35em]">built for</span>
            <img src="/convergence-logo.svg" alt="CONVERGENCE" className="w-[280px] sm:w-[360px] md:w-[480px] lg:w-[560px] xl:w-[640px] max-w-[85vw] h-auto" />
            <span className="text-xs uppercase tracking-[0.3em]">chainlink hackathon</span>
          </div>
        </div>

        <div className="relative z-10 flex flex-col lg:flex-row lg:items-center gap-8 sm:gap-10 lg:gap-14 mb-8 sm:mb-12">

        {/* LEFT — text */}
        <div className="flex-1 min-w-0">

          {/* Headline — extra spacing so descenders (g) aren't clipped */}
          <h1
            className="font-bold tracking-tight mb-3 sm:mb-5 overflow-visible"
            style={{ fontSize: 'clamp(2rem, 5vw, 5.5rem)', lineHeight: 1.15, letterSpacing: '-0.02em' }}
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
        </div>{/* end flex row */}

        {/* Vitalik quote — compact, left */}
        <div
          className="relative rounded-xl p-3 sm:p-4 max-w-xl overflow-hidden"
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
