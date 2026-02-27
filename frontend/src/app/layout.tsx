import type { Metadata } from 'next';
import './globals.css';
import { Providers } from '@/providers';

export const metadata: Metadata = {
  title: 'MiniMarket — AI Prediction Markets',
  description: 'Privacy-preserving prediction markets powered by drand timelock encryption and Chainlink CRE',
  keywords: ['prediction market', 'chainlink', 'drand', 'timelock', 'AI agents', 'privacy'],
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="dark">
      <body className="bg-chainlink-surface text-chainlink-text antialiased">
        <Providers>
          {children}
        </Providers>
      </body>
    </html>
  );
}
