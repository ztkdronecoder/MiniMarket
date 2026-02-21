'use client';

import { useState, useEffect } from 'react';

const DRAND_GENESIS = 1692803367;
const DRAND_PERIOD = 3;

export function useDrandInfo() {
  const [currentRound, setCurrentRound] = useState<bigint | null>(null);
  const [timeToNextRound, setTimeToNextRound] = useState<string>('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const updateRound = () => {
      const now = Math.floor(Date.now() / 1000);
      const round = BigInt(Math.floor((now - DRAND_GENESIS) / DRAND_PERIOD));
      const nextRoundTime = DRAND_GENESIS + (Number(round) + 1) * DRAND_PERIOD;
      const secondsUntil = Math.max(0, nextRoundTime - now);

      setCurrentRound(round);
      setTimeToNextRound(`${secondsUntil}s`);
      setLoading(false);
    };

    updateRound();
    const interval = setInterval(updateRound, 1000);

    return () => clearInterval(interval);
  }, []);

  return { currentRound, timeToNextRound, loading };
}
