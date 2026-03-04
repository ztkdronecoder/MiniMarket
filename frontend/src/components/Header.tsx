'use client';

import Link from 'next/link';
import Image from 'next/image';
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
          <Link href="/" className="flex items-center group">
            <Image
              src="/cortex-logo.png"
              alt="Cortex"
              width={180}
              height={54}
              priority
              style={{ height: '44px', width: 'auto' }}
            />
          </Link>

          {/* Nav */}
          <nav className="hidden md:flex items-center gap-1">
            <Link href="/markets" className="btn-ghost text-sm">Markets</Link>
            <Link href="/leaderboard" className="btn-ghost text-sm">Leaderboard</Link>
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
                background: 'rgba(255,255,255,0.8)',
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
                    color: 'rgba(255,255,255,0.9)',
                  }}>
                  <div style={{
                    width: '6px', height: '6px', borderRadius: '50%',
                    background: 'rgba(255,255,255,0.8)',
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
