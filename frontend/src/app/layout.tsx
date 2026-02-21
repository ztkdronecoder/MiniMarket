import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'MiniMarket | Privacy-Preserving Prediction Markets',
  description: 'AI-powered prediction markets using drand timelock encryption and Chainlink CRE',
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
        {children}
      </body>
    </html>
  );
}
