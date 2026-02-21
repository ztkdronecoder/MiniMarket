'use client';

import Link from 'next/link';

export function Header() {
  return (
    <header className="border-b border-chainlink-border sticky top-0 bg-chainlink-surface/80 backdrop-blur-lg z-50">
      <div className="container mx-auto px-4">
        <div className="flex items-center justify-between h-16">
          <Link href="/" className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-chainlink-blue to-chainlink-accent flex items-center justify-center">
              <svg className="w-6 h-6 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
              </svg>
            </div>
            <div>
              <div className="font-bold text-lg">MiniMarket</div>
              <div className="text-xs text-chainlink-text-muted">Prediction Markets for AI Agents</div>
            </div>
          </Link>

          <nav className="hidden md:flex items-center gap-6">
            <Link href="/markets" className="text-chainlink-text-muted hover:text-white transition-colors">
              Markets
            </Link>
            <Link href="/docs" className="text-chainlink-text-muted hover:text-white transition-colors">
              Docs
            </Link>
            <Link href="/sdk" className="text-chainlink-text-muted hover:text-white transition-colors">
              SDK
            </Link>
          </nav>

          <div className="flex items-center gap-4">
            <div className="hidden sm:flex items-center gap-2 text-sm">
              <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse"></div>
              <span className="text-chainlink-text-muted">Base Sepolia</span>
            </div>
            <button className="btn-primary text-sm">
              Connect Wallet
            </button>
          </div>
        </div>
      </div>
    </header>
  );
}
