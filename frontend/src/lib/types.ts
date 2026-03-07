export type MarketPhase = 'INFO_COLLECTION' | 'TRADING' | 'RESOLVED';
export type Outcome = 'YES' | 'NO';

export interface Submarket {
  id: string;                // bytes32 as hex
  parentMarketId: string;
  optionIndex: number;
  optionLabel: string | null;
  phase: MarketPhase;
  priceYes: number;          // 0–1
  priceNo: number;
  reserveYes: bigint;
  reserveNo: bigint;
  totalYesShares: bigint;
  totalNoShares: bigint;
  validSubmissions: number;
  resolvedOutcome: Outcome | null;
  consensusOutcome: Outcome | null;
  totalPenaltyCollected: bigint;
  totalExpectedPenalty: bigint;
  totalClaimedYes?: bigint;
  totalClaimedNo?: bigint;
  creatorFallbackAmount?: bigint;
  creatorFallbackClaimed?: boolean;
  leavesURI: string | null;
  createdAt: Date;
}

export interface Market {
  id: string;
  question: string;
  schema: string | null;
  label: string | null;
  participants: number;
  totalStaked: string;
  createdAt: Date;
  decryptAt: Date;
  tradingEndsAt: Date;
  tradingDuration: number;
  ticketCost: string;
  /** Raw ticket cost (6 decimals) for USDC conversion: sharesAmount * ticketCostRaw / 1e12 = USDC */
  ticketCostRaw: string;
  drandTargetRound: bigint;
  creator: string | null;
  creatorPremium: string;
  optionCount: number;
  // Derived from first submarket (primary) for backward compat
  phase: MarketPhase;
  priceYes: number;
  priceNo: number;
  consensusOutcome: Outcome | null;
  resolvedOutcome: Outcome | null;
  creatorPayout: string;
  // Loaded separately via getSubmarkets()
  submarkets: Submarket[];
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
