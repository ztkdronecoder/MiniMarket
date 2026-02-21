export function formatDistanceToNow(date: Date): string {
  const now = new Date();
  const diffInSeconds = Math.floor((date.getTime() - now.getTime()) / 1000);

  if (diffInSeconds <= 0) {
    return 'Now';
  }

  const minutes = Math.floor(diffInSeconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) {
    return `${days}d ${hours % 24}h`;
  }
  if (hours > 0) {
    return `${hours}h ${minutes % 60}m`;
  }
  return `${minutes}m`;
}

export function formatBigNumber(value: bigint, decimals: number = 18): string {
  const divisor = BigInt(10 ** decimals);
  const integerPart = value / divisor;
  const fractionalPart = value % divisor;
  
  const fractionalStr = fractionalPart.toString().padStart(decimals, '0').slice(0, 2);
  
  return `${integerPart}.${fractionalStr}`;
}

export function shortenAddress(address: string): string {
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

export function formatTimestamp(timestamp: bigint): Date {
  return new Date(Number(timestamp) * 1000);
}

export function calculateTimeRemaining(seconds: number): { hours: number; minutes: number; seconds: number } {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;
  
  return { hours, minutes, seconds: secs };
}
