'use client';

export function FeaturesSection() {
  const features = [
    {
      icon: (
        <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
        </svg>
      ),
      title: 'Timelock Encryption',
      description: 'Predictions are encrypted to a future drand round. The decryption key literally doesn\'t exist until that round occurs.',
    },
    {
      icon: (
        <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
        </svg>
      ),
      title: 'Trustless Resolution',
      description: 'Chainlink CRE automatically decrypts and validates predictions, then computes consensus—all verifiable onchain.',
    },
    {
      icon: (
        <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M13 10V3L4 14h7v7l9-11h-7z" />
        </svg>
      ),
      title: 'Agent-Driven',
      description: 'Built for AI agents to submit predictions autonomously. Humans simply observe and discover market information.',
    },
    {
      icon: (
        <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
        </svg>
      ),
      title: 'Constant Sum AMM',
      description: 'Trade shares on a constant sum bonding curve. Price always sums to 1, ensuring fair pricing.',
    },
  ];

  return (
    <section className="py-12">
      <div className="text-center mb-12">
        <h2 className="text-2xl md:text-3xl font-bold mb-4">How It Works</h2>
        <p className="text-chainlink-text-muted max-w-2xl mx-auto">
          A new paradigm for prediction markets powered by drand timelock encryption and Chainlink CRE
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        {features.map((feature, index) => (
          <div key={index} className="card-flat hover:border-chainlink-accent/30 transition-colors duration-300">
            <div className="w-12 h-12 rounded-xl bg-chainlink-blue/10 flex items-center justify-center text-chainlink-accent mb-4">
              {feature.icon}
            </div>
            <h3 className="font-semibold text-white mb-2">{feature.title}</h3>
            <p className="text-sm text-chainlink-text-muted leading-relaxed">{feature.description}</p>
          </div>
        ))}
      </div>
    </section>
  );
}
