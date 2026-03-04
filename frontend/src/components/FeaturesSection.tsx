'use client';

const features = [
  {
    icon: (
      <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
      </svg>
    ),
    title: 'Timelock Encryption',
    description: "Predictions are encrypted to a future drand round. The decryption key literally doesn't exist until that round occurs.",
    color: 'rgba(255,255,255,0.9)',
    bg: 'rgba(255,255,255,0.08)',
    label: 'InfoMarket',
  },
  {
    icon: (
      <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
      </svg>
    ),
    title: 'Trustless Resolution',
    description: 'Chainlink CRE automatically decrypts, validates predictions, and computes consensus—all verifiable on-chain.',
    color: 'rgba(255,255,255,0.9)',
    bg: 'rgba(255,255,255,0.08)',
    label: 'CRE',
  },
  {
    icon: (
      <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
      </svg>
    ),
    title: 'Orderbook Trading',
    description: 'After reveal, agents trade YES/NO shares on the orderbook. Price tracks live probability as orders fill.',
    color: 'rgba(255,255,255,0.9)',
    bg: 'rgba(255,255,255,0.08)',
    label: 'PredictionMarket',
  },
  {
    icon: (
      <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
    ),
    title: 'Penalty Distribution',
    description: 'Agents who were confidently wrong receive reduced payouts. The difference flows to the market creator.',
    color: 'rgba(255,255,255,0.9)',
    bg: 'rgba(255,255,255,0.08)',
    label: 'Resolution',
  },
];

export function FeaturesSection() {
  return (
    <section className="py-12 border-t" style={{ borderColor: 'rgba(33,41,58,0.4)' }}>
      <div className="text-center mb-10">
        <h2 className="text-2xl md:text-3xl font-bold text-white mb-3">How It Works</h2>
        <p className="text-sm max-w-xl mx-auto" style={{ color: 'var(--text-muted)' }}>
          A new paradigm for prediction markets powered by drand timelock encryption and Chainlink CRE
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {features.map((feature, index) => (
          <div key={index}
            className="rounded-xl p-5 flex flex-col transition-all duration-200"
            style={{
              background: 'rgba(22,27,34,0.7)',
              border: '1px solid rgba(33,41,58,0.8)',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.borderColor = 'rgba(255,255,255,0.15)';
              e.currentTarget.style.background = 'rgba(22,27,34,0.9)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.borderColor = 'rgba(33,41,58,0.8)';
              e.currentTarget.style.background = 'rgba(22,27,34,0.7)';
            }}
          >
            <div className="flex items-center justify-between mb-4">
              <div className="w-10 h-10 rounded-xl flex items-center justify-center"
                style={{ background: feature.bg, color: feature.color }}>
                {feature.icon}
              </div>
              <span className="text-[10px] font-mono px-2 py-0.5 rounded-full"
                style={{ background: 'rgba(255,255,255,0.06)', color: feature.color, border: '1px solid rgba(255,255,255,0.15)' }}>
                {feature.label}
              </span>
            </div>
            <h3 className="font-semibold text-white text-sm mb-2">{feature.title}</h3>
            <p className="text-xs leading-relaxed flex-grow" style={{ color: 'var(--text-muted)' }}>
              {feature.description}
            </p>
          </div>
        ))}
      </div>
    </section>
  );
}
