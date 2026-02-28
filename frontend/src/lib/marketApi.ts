import type { Market, MarketPhase, PriceHistoryPoint } from './types';

const PONDER_ENDPOINT = process.env.NEXT_PUBLIC_PONDER_ENDPOINT || 'http://localhost:42069';

interface PonderMarket {
  id: string;
  question: string;
  schema: string | null;
  label: string | null;
  phase: number;
  totalParticipants: string;
  marketCap: string;
  ticketCost: string;
  drandTargetRound: string;
  merkleRoot: string | null;
  consensusOutcome: number | null;
  resolvedOutcome: number | null;
  reserveYes: string | null;
  reserveNo: string | null;
  validSubmissions: string | null;
  createdAt: string;
  tradingDuration: string;
  creator: string | null;
  creatorOffer: string | null;
  totalPenaltyCollected: string | null;
}

const restGet = async <T>(path: string): Promise<T> => {
  const response = await fetch(`${PONDER_ENDPOINT}${path}`);
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
  }
  return response.json();
};

function phaseFromNumber(phase: number): MarketPhase {
  switch (phase) {
    case 0: return 'INFO_COLLECTION';
    case 1: return 'TRADING';
    case 2: return 'RESOLVED';
    default: return 'INFO_COLLECTION';
  }
}

function outcomeFromNumber(outcome: number | null): 'YES' | 'NO' | null {
  if (outcome === null) return null;
  return outcome === 1 ? 'YES' : 'NO';
}

function calculatePrice(reserveYes: bigint, reserveNo: bigint): { priceYes: number; priceNo: number } {
  const total = reserveYes + reserveNo;
  if (Number(total) === 0) return { priceYes: 0.5, priceNo: 0.5 };
  const priceYes = Number(reserveYes) / Number(total);
  return { priceYes, priceNo: 1 - priceYes };
}

function formatUsdc(value: string | bigint): string {
  const usdc = Number(value) / 1e6;
  return `${usdc.toFixed(2)} USDC`;
}

function mapPonderMarket(m: PonderMarket): Market {
  const { priceYes, priceNo } = calculatePrice(
    BigInt(m.reserveYes || 0),
    BigInt(m.reserveNo || 0)
  );
  return {
    id: m.id,
    question: m.question,
    schema: m.schema,
    label: m.label ?? null,
    phase: phaseFromNumber(m.phase),
    priceYes,
    priceNo,
    participants: Number(m.totalParticipants),
    totalStaked: formatUsdc(m.marketCap),
    createdAt: new Date(Number(m.createdAt) * 1000),
    // drand quicknet: genesis 1692803367, period 3s
    decryptAt: new Date((1692803367 + Number(m.drandTargetRound) * 3) * 1000),
    tradingDuration: Number(m.tradingDuration),
    tradingEndsAt: new Date((Number(m.createdAt) + Number(m.tradingDuration)) * 1000),
    consensusOutcome: outcomeFromNumber(m.consensusOutcome),
    resolvedOutcome: outcomeFromNumber(m.resolvedOutcome),
    ticketCost: formatUsdc(m.ticketCost),
    drandTargetRound: BigInt(m.drandTargetRound),
    creator: m.creator ?? null,
    creatorPremium: formatUsdc(m.creatorOffer ?? '0'),
    creatorPayout: formatUsdc(m.totalPenaltyCollected ?? '0'),
  };
}

export async function getMarkets(limit = 20, offset = 0, label?: string): Promise<Market[]> {
  try {
    const labelParam = label ? `&label=${encodeURIComponent(label)}` : '';
    const markets = await restGet<PonderMarket[]>(`/markets?limit=${limit}&offset=${offset}${labelParam}`);
    // Sort newest first
    markets.sort((a, b) => Number(BigInt(b.id) - BigInt(a.id)));
    return markets.map(mapPonderMarket);
  } catch (error) {
    console.error('Failed to fetch markets:', error);
    return [];
  }
}

export async function getMarketById(id: string): Promise<Market | null> {
  try {
    const m = await restGet<PonderMarket>(`/markets/${id}`);
    return mapPonderMarket(m);
  } catch (error) {
    console.error('Failed to fetch market:', error);
    return null;
  }
}

export async function getMarketCount(): Promise<number> {
  try {
    const markets = await restGet<PonderMarket[]>(`/markets?limit=1000`);
    return markets.length;
  } catch {
    return 0;
  }
}

export async function getSubmissionCount(): Promise<number> {
  return 0;
}

export async function getAgentCount(): Promise<number> {
  try {
    const agents = await restGet<unknown[]>(`/agents?limit=1000`);
    return agents.length;
  } catch {
    return 0;
  }
}

export async function getAgentMarketStatus(
  marketId: string,
  address: string
): Promise<{ participated: boolean; hasClaimed: boolean } | null> {
  try {
    const row = await restGet<{
      participated: boolean;
      claimedShares: boolean;
      totalPayout: string;
    }>(`/markets/${marketId}/agents/${address.toLowerCase()}`);
    return {
      participated: row.participated,
      // hasClaimed = payout already recorded (totalPayout > 0)
      hasClaimed: BigInt(row.totalPayout || '0') > 0n,
    };
  } catch {
    // 404 or network error → not a participant
    return null;
  }
}

export interface OrderbookOrder {
  id: string;
  orderId: bigint;
  marketId: bigint;
  maker: string;
  sellYes: boolean;
  amount: bigint;       // shares (1e6 precision)
  price: bigint;        // 1e18 precision — cost in other-outcome per 1 share
  status: 'open' | 'filled' | 'cancelled';
  taker: string | null;
  sharesAmount: bigint | null;
  takerPaysAmount: bigint | null;
  timestamp: bigint;
  txHash: string;
}

export async function getMarketOrders(marketId: string, status?: string): Promise<OrderbookOrder[]> {
  try {
    const statusParam = status ? `?status=${encodeURIComponent(status)}` : '';
    const items = await restGet<Array<{
      id: string;
      orderId: string;
      marketId: string;
      maker: string;
      sellYes: boolean;
      amount: string;
      price: string;
      status: string;
      taker: string | null;
      sharesAmount: string | null;
      takerPaysAmount: string | null;
      timestamp: string;
      txHash: string;
    }>>(`/markets/${marketId}/orders${statusParam}`);
    return items.map((i) => ({
      id: i.id,
      orderId: BigInt(i.orderId),
      marketId: BigInt(i.marketId),
      maker: i.maker,
      sellYes: i.sellYes,
      amount: BigInt(i.amount),
      price: BigInt(i.price),
      status: i.status as 'open' | 'filled' | 'cancelled',
      taker: i.taker ?? null,
      sharesAmount: i.sharesAmount != null ? BigInt(i.sharesAmount) : null,
      takerPaysAmount: i.takerPaysAmount != null ? BigInt(i.takerPaysAmount) : null,
      timestamp: BigInt(i.timestamp),
      txHash: i.txHash,
    }));
  } catch (error) {
    console.error('Failed to fetch orders:', error);
    return [];
  }
}

export async function getPriceHistory(marketId: string): Promise<PriceHistoryPoint[]> {
  try {
    const items = await restGet<Array<{
      timestamp: string;
      priceYes: string;
      priceNo: string;
      eventType: string;
    }>>(`/markets/${marketId}/price-history`);

    const PRECISION = BigInt('1000000000000000000');

    return items.map((item) => ({
      timestamp: Number(item.timestamp),
      priceYes: Number(BigInt(item.priceYes)) / Number(PRECISION),
      priceNo: Number(BigInt(item.priceNo)) / Number(PRECISION),
      eventType: item.eventType as 'reveal' | 'swap',
    }));
  } catch (error) {
    console.error('Failed to fetch price history:', error);
    return [];
  }
}
