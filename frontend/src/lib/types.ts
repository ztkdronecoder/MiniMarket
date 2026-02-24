export type MarketPhase = 'INFO_COLLECTION' | 'TRADING' | 'RESOLVED';
export type Outcome = 'YES' | 'NO';

export interface Market {
  id: string;
  question: string;
  schemaURI: string | null;
  phase: MarketPhase;
  priceYes: number;
  priceNo: number;
  participants: number;
  totalStaked: string;
  decryptAt: Date;
  tradingEndsAt: Date;
  consensusOutcome: Outcome | null;
  resolvedOutcome: Outcome | null;
  paymentToken: string;
  ticketCost: string;
  drandTargetRound: bigint;
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
