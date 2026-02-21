export const DRAND_QUICKNET = {
  chainHash: '0xdbd506d6ef76e5f386f41c651dcb808c5bcbd75471cc4eafa3ccac746459b582',
  genesis: 1692803367,
  period: 3,
  httpClient: 'https://api.drand.sh',
  gatewayUrl: 'https://drand.cloudflare.com',
} as const;

export const DRAND_NETWORKS = {
  quicknet: DRAND_QUICKNET,
  mainnet: {
    chainHash: '0x52db9ba70e0cc0f6eaf7803dd07447a1f5477735fd3f661792ba94600c84e971',
    genesis: 1595431050,
    period: 30,
    httpClient: 'https://api.drand.sh',
    gatewayUrl: 'https://api.drand.sh',
  },
} as const;

export type NetworkInfo = typeof DRAND_QUICKNET;

export function currentRound(network: NetworkInfo = DRAND_QUICKNET): bigint {
  const now = Math.floor(Date.now() / 1000);
  return BigInt(Math.floor((now - network.genesis) / network.period));
}

export function roundToTime(round: bigint, network: NetworkInfo = DRAND_QUICKNET): Date {
  const timestamp = network.genesis + Number(round) * network.period;
  return new Date(timestamp * 1000);
}

export function timeToRound(targetTime: Date, network: NetworkInfo = DRAND_QUICKNET): bigint {
  const timestamp = Math.floor(targetTime.getTime() / 1000);
  return BigInt(Math.floor((timestamp - network.genesis) / network.period));
}

export function roundFromOffset(offsetSeconds: number, network: NetworkInfo = DRAND_QUICKNET): bigint {
  return currentRound(network) + BigInt(Math.floor(offsetSeconds / network.period));
}

export function timeUntilRound(round: bigint, network: NetworkInfo = DRAND_QUICKNET): number {
  const targetTime = roundToTime(round, network);
  return Math.max(0, Math.floor((targetTime.getTime() - Date.now()) / 1000));
}

export function formatTimeRemaining(seconds: number): string {
  if (seconds <= 0) return 'Ready to decrypt';
  
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;

  if (hours > 0) {
    return `${hours}h ${minutes}m ${secs}s`;
  }
  if (minutes > 0) {
    return `${minutes}m ${secs}s`;
  }
  return `${secs}s`;
}
