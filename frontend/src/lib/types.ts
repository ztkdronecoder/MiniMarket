export type MarketPhase = 'INFO_COLLECTION' | 'TRADING' | 'RESOLVED';
export type Outcome = 'YES' | 'NO';

export interface Market {
  id: string;
  question: string;
  schema: string | null;
  label: string | null;
  phase: MarketPhase;
  priceYes: number;
  priceNo: number;
  participants: number;
  totalStaked: string;
  createdAt: Date;
  decryptAt: Date;
  tradingEndsAt: Date;
  tradingDuration: number;
  consensusOutcome: Outcome | null;
  resolvedOutcome: Outcome | null;
  ticketCost: string;
  drandTargetRound: bigint;
  creator: string | null;
  creatorPremium: string;
  creatorPayout: string;
}

export interface MarketStats {
  totalParticipants: number;
  totalStaked: bigint;
  reserveYes: bigint;
  reserveNo: bigint;
  priceYes: number;
  priceNo: number;
}

export interface PriceHistoryPoint {
  timestamp: number;
  priceYes: number;
  priceNo: number;
  eventType: 'reveal' | 'swap';
}
