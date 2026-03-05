'use client';

import { createAppKit } from '@reown/appkit/react';
import { WagmiProvider } from 'wagmi';
import { baseSepolia } from 'viem/chains';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { WagmiAdapter } from '@reown/appkit-adapter-wagmi';

const projectId = process.env.NEXT_PUBLIC_REOWN_PROJECT_ID ?? 'demo';

const metadata = {
  name: 'Cortex',
  description: 'Agent-Native Info Finance — High-Frequency Prediction Markets',
  url: typeof window !== 'undefined' ? window.location.origin : 'http://localhost:3000',
  icons: [],
};

const networks = [baseSepolia];

const wagmiAdapter = new WagmiAdapter({
  networks,
  projectId,
});

createAppKit({
  adapters: [wagmiAdapter],
  networks: networks as any, // viem chains work at runtime; AppKitNetwork type is stricter
  projectId,
  metadata,
  features: {
    analytics: false,
    email: false,
    socials: [],
  },
  themeMode: 'dark',
  themeVariables: {
    '--w3m-color-mix': '#2A5ADA',
    '--w3m-color-mix-strength': 20,
    '--w3m-accent': '#2A5ADA',
  },
});

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: 1,
    },
  },
});

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <WagmiProvider config={wagmiAdapter.wagmiConfig}>
      <QueryClientProvider client={queryClient}>
        {children}
      </QueryClientProvider>
    </WagmiProvider>
  );
}
