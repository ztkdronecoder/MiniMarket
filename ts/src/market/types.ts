export enum MarketPhase {
  INFO_COLLECTION = 0,
  TRADING = 1,
  RESOLVED = 2,
}

export enum Outcome {
  NONE = 0,
  YES = 1,
  NO = 2,
}

export interface MarketConfig {
  marketId: bigint;
  question: string;
  paymentToken: string;
  maxSlots: bigint;
  ticketCost: bigint;
  marketCap: bigint;
  drandTargetRound: bigint;
  drandChainHash: string;
  createdAt: bigint;
  tradingDuration: bigint;
}

export interface MarketState {
  phase: MarketPhase;
  merkleRoot: string;
  consensusOutcome: Outcome;
  reserveYes: bigint;
  reserveNo: bigint;
  totalClaimedYes: bigint;
  totalClaimedNo: bigint;
  resolvedOutcome: Outcome;
}

export interface EncryptedSubmission {
  agent: string;
  ciphertext: string;
  validationHash: string;
  targetRound: bigint;
}

export interface AgentState {
  yesShares: bigint;
  noShares: bigint;
  participatedInInfo: boolean;
  claimedInitialShares: boolean;
}

export interface MarketStats {
  marketId: bigint;
  question: string;
  phase: MarketPhase;
  totalParticipants: number;
  totalStaked: bigint;
  reserveYes: bigint;
  reserveNo: bigint;
  priceYes: number;
  priceNo: number;
  consensusOutcome: Outcome | null;
  resolvedOutcome: Outcome | null;
  drandTargetRound: bigint;
  timeUntilDecrypt: number;
  tradingEndsAt: Date;
  paymentToken: string;
  ticketCost: bigint;
}

export interface MarketListFilter {
  phase?: MarketPhase;
  paymentToken?: string;
  limit?: number;
  offset?: number;
}
