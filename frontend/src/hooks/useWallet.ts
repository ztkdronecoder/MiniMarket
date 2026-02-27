'use client';

import { useAppKitAccount, useAppKit, useDisconnect } from '@reown/appkit/react';

export function useWallet() {
  const { address, isConnected, status } = useAppKitAccount();
  const { open } = useAppKit();
  const { disconnect } = useDisconnect();

  return {
    address: address as `0x${string}` | undefined,
    isConnected,
    status,
    connect: () => open(),
    disconnect,
    shortAddress: address ? `${address.slice(0, 6)}…${address.slice(-4)}` : null,
  };
}
