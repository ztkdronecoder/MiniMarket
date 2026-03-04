'use client';

import Link from 'next/link';
import { useWallet } from '@/hooks/useWallet';

export function Header() {
  const { isConnected, shortAddress, connect, disconnect } = useWallet();

  return (
    <header className="sticky top-0 z-50 border-b" style={{
      background: 'rgba(10, 14, 23, 0.85)',
      borderColor: 'rgba(33, 41, 58, 0.8)',
      backdropFilter: 'blur(20px)',
    }}>
      <div className="container mx-auto px-4">
        <div className="flex items-center justify-between h-16">
          {/* Logo */}
          <Link href="/" className="flex items-center gap-3 group">
            <div className="relative">
              <div className="w-9 h-9 rounded-xl flex items-center justify-center"
                style={{ background: 'linear-gradient(135deg, #2A5ADA 0%, #7C3AED 100%)' }}>
                <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                </svg>
              </div>
            </div>
            <div>
              <div className="font-bold text-base text-white tracking-tight">MiniMarket</div>
              <div className="text-[10px] font-mono" style={{ color: 'var(--text-muted)' }}>AI Prediction Markets</div>
            </div>
          </Link>

          {/* Nav */}
          <nav className="hidden md:flex items-center gap-1">
            <Link href="/markets" className="btn-ghost text-sm">Markets</Link>
            <Link href="/leaderboard" className="btn-ghost text-sm">Leaderboard</Link>
            <Link href="/creators" className="btn-ghost text-sm">Creators</Link>
            {isConnected && (
              <Link href="/dashboard" className="btn-ghost text-sm">Dashboard</Link>
            )}
          </nav>

          {/* Right side */}
          <div className="flex items-center gap-3">
            <div className="hidden sm:flex items-center gap-2 text-xs" style={{ color: 'var(--text-muted)' }}>
              <div className="live-dot w-1.5 h-1.5" style={{
                width: '6px', height: '6px',
                borderRadius: '50%',
                background: '#34D399',
                boxShadow: '0 0 6px rgba(52, 211, 153, 0.8)'
              }} />
              <span>Base Sepolia</span>
            </div>

            {isConnected ? (
              <div className="flex items-center gap-2">
                <Link href="/dashboard"
                  className="hidden sm:inline-flex items-center gap-2 text-xs font-mono px-3 py-1.5 rounded-lg"
                  style={{
                    background: 'rgba(42, 90, 218, 0.1)',
                    border: '1px solid rgba(42, 90, 218, 0.2)',
                    color: '#60A5FA',
                  }}>
                  <div style={{
                    width: '6px', height: '6px', borderRadius: '50%',
                    background: '#34D399',
                    boxShadow: '0 0 4px rgba(52, 211, 153, 0.8)'
                  }} />
                  {shortAddress}
                </Link>
                <button
                  onClick={() => disconnect()}
                  className="btn-ghost text-xs"
                  style={{ color: 'var(--text-muted)' }}
                >
                  Disconnect
                </button>
              </div>
            ) : (
              <button onClick={connect} className="btn-primary text-sm gap-2 py-2 px-4">
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 9V7a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2m2 4h10a2 2 0 002-2v-6a2 2 0 00-2-2H9a2 2 0 00-2 2v6a2 2 0 002 2zm7-5a2 2 0 11-4 0 2 2 0 014 0z" />
                </svg>
                Connect Wallet
              </button>
            )}
          </div>
        </div>
      </div>
    </header>
  );
}
