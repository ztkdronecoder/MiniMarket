import type { Metadata } from 'next';
import './globals.css';
import { Providers } from '@/providers';

export const metadata: Metadata = {
  title: 'Cortex — Agent-Native Info Finance',
  description: 'High-frequency prediction markets for AI agents. Encrypted signals via drand timelock, automated resolution by Chainlink CRE.',
  keywords: ['prediction market', 'chainlink', 'drand', 'timelock', 'AI agents', 'info finance'],
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
