import type { Market, Submarket, MarketPhase, PriceHistoryPoint } from './types';

const PONDER_ENDPOINT = process.env.NEXT_PUBLIC_PONDER_ENDPOINT || 'http://localhost:42069';

// ── Ponder REST response shapes ────────────────────────────────────────────

interface PonderMarket {
  id: string;
  question: string;
  schema: string | null;
  label: string | null;
  totalParticipants: string;
  marketCap: string;
  ticketCost: string;
  drandTargetRound: string;
  createdAt: string;
  tradingDuration: string;
  creator: string | null;
  creatorOffer: string | null;
  optionCount: number | null;
}

interface PonderSubmarket {
  id: string;
  parentMarketId: string;
  optionIndex: number;
  optionLabel: string | null;
  phase: number;
  merkleRoot: string | null;
  consensusOutcome: number | null;
  reserveYes: string | null;
  reserveNo: string | null;
  totalYesShares: string | null;
  totalNoShares: string | null;
  validSubmissions: string | null;
  resolvedOutcome: number | null;
  totalPenaltyCollected: string | null;
  leavesURI: string | null;
  createdAt: string;
}

// ── Helpers ────────────────────────────────────────────────────────────────

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
  const priceYes = Number(reserveNo) / Number(total);
  return { priceYes, priceNo: 1 - priceYes };
}

function formatUsdc(value: string | bigint): string {
  const usdc = Number(value) / 1e6;
  return `${usdc.toFixed(2)} USDC`;
}

function mapPonderSubmarket(s: PonderSubmarket): Submarket {
  const reserveYes = BigInt(s.reserveYes || 0);
  const reserveNo = BigInt(s.reserveNo || 0);
  const { priceYes, priceNo } = calculatePrice(reserveYes, reserveNo);
  return {
    id: s.id,
    parentMarketId: s.parentMarketId,
    optionIndex: s.optionIndex,
    optionLabel: s.optionLabel ?? null,
    phase: phaseFromNumber(s.phase),
    priceYes,
    priceNo,
    reserveYes,
    reserveNo,
    totalYesShares: BigInt(s.totalYesShares || 0),
    totalNoShares: BigInt(s.totalNoShares || 0),
    validSubmissions: Number(s.validSubmissions || 0),
    resolvedOutcome: outcomeFromNumber(s.resolvedOutcome),
    consensusOutcome: outcomeFromNumber(s.consensusOutcome),
    totalPenaltyCollected: BigInt(s.totalPenaltyCollected || 0),
    leavesURI: s.leavesURI ?? null,
    createdAt: new Date(Number(s.createdAt) * 1000),
  };
}

function mapPonderMarket(m: PonderMarket, submarkets: Submarket[] = []): Market {
  // Derive phase/price from the primary (first) submarket when available
  const primary = submarkets[0] ?? null;
  const priceYes = primary?.priceYes ?? 0.5;
  const priceNo = primary?.priceNo ?? 0.5;
  const phase = primary?.phase ?? 'INFO_COLLECTION';
  const consensusOutcome = primary?.consensusOutcome ?? null;
  const resolvedOutcome = primary?.resolvedOutcome ?? null;
  const totalPenaltyCollected = primary?.totalPenaltyCollected ?? BigInt(0);

  return {
    id: m.id,
    question: m.question,
    schema: m.schema,
    label: m.label ?? null,
    phase,
    priceYes,
    priceNo,
    participants: Number(m.totalParticipants),
    totalStaked: formatUsdc(m.marketCap),
    createdAt: new Date(Number(m.createdAt) * 1000),
    decryptAt: new Date((1692803367 + Number(m.drandTargetRound) * 3) * 1000),
    tradingDuration: Number(m.tradingDuration),
    tradingEndsAt: new Date((Number(m.createdAt) + Number(m.tradingDuration)) * 1000),
    consensusOutcome,
    resolvedOutcome,
    ticketCost: formatUsdc(m.ticketCost),
    drandTargetRound: BigInt(m.drandTargetRound),
    creator: m.creator ?? null,
    creatorPremium: formatUsdc(m.creatorOffer ?? '0'),
    creatorPayout: formatUsdc(totalPenaltyCollected),
    optionCount: m.optionCount ?? 1,
    submarkets,
  };
}

// ── Submarket API ──────────────────────────────────────────────────────────

export async function getSubmarkets(parentMarketId: string): Promise<Submarket[]> {
  try {
    const items = await restGet<PonderSubmarket[]>(`/submarkets?parentMarketId=${parentMarketId}`);
    return items
      .map(mapPonderSubmarket)
      .sort((a, b) => a.optionIndex - b.optionIndex);
  } catch (error) {
    console.error('Failed to fetch submarkets:', error);
    return [];
  }
}

export async function getSubmarketById(submarketId: string): Promise<Submarket | null> {
  try {
    const s = await restGet<PonderSubmarket>(`/submarkets/${submarketId}`);
    return mapPonderSubmarket(s);
  } catch (error) {
    console.error('Failed to fetch submarket:', error);
    return null;
  }
}

export async function getSubmarketPriceHistory(submarketId: string): Promise<PriceHistoryPoint[]> {
  try {
    const items = await restGet<Array<{
      timestamp: string;
      priceYes: string;
      priceNo: string;
      eventType: string;
    }>>(`/submarkets/${submarketId}/price-history`);

    const PRECISION = BigInt('1000000000000000000');

    return items.map((item) => ({
      timestamp: Number(item.timestamp),
      priceYes: Number(BigInt(item.priceYes)) / Number(PRECISION),
      priceNo: Number(BigInt(item.priceNo)) / Number(PRECISION),
      eventType: item.eventType as 'reveal' | 'swap',
    }));
  } catch (error) {
    console.error('Failed to fetch submarket price history:', error);
    return [];
  }
}

export interface OrderbookOrder {
  id: string;
  orderId: bigint;
  submarketId: string;
  parentMarketId: bigint;
  maker: string;
  sellYes: boolean;
  amount: bigint;
  price: bigint;
  status: 'open' | 'filled' | 'cancelled';
  taker: string | null;
  sharesAmount: bigint | null;
  takerPaysAmount: bigint | null;
  timestamp: bigint;
  txHash: string;
}

export async function getSubmarketOrders(submarketId: string, status?: string): Promise<OrderbookOrder[]> {
  try {
    const statusParam = status ? `&status=${encodeURIComponent(status)}` : '';
    const items = await restGet<Array<{
      id: string;
      orderId: string;
      submarketId: string;
      parentMarketId: string;
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
    }>>(`/submarkets/${submarketId}/orders?${statusParam}`);
    return items.map((i) => ({
      id: i.id,
      orderId: BigInt(i.orderId),
      submarketId: i.submarketId,
      parentMarketId: BigInt(i.parentMarketId),
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
    console.error('Failed to fetch submarket orders:', error);
    return [];
  }
}

// ── Market API ─────────────────────────────────────────────────────────────

export async function getMarkets(limit = 20, offset = 0, label?: string): Promise<Market[]> {
  try {
    const labelParam = label ? `&label=${encodeURIComponent(label)}` : '';
    const markets = await restGet<PonderMarket[]>(`/markets?limit=${limit}&offset=${offset}${labelParam}`);
    markets.sort((a, b) => Number(BigInt(b.id) - BigInt(a.id)));
    // Fetch submarkets in parallel for all markets
    const withSubmarkets = await Promise.all(
      markets.map(async (m) => {
        const subs = await getSubmarkets(m.id).catch(() => []);
        return mapPonderMarket(m, subs);
      })
    );
    return withSubmarkets;
  } catch (error) {
    console.error('Failed to fetch markets:', error);
    return [];
  }
}

export async function getMarketById(id: string): Promise<Market | null> {
  try {
    const [m, subs] = await Promise.all([
      restGet<PonderMarket>(`/markets/${id}`),
      getSubmarkets(id),
    ]);
    return mapPonderMarket(m, subs);
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
    }>(`/markets/${marketId}/agents/${address.toLowerCase()}`);
    return {
      participated: row.participated,
      hasClaimed: false, // Now tracked per-submarket in agentSubmarket
    };
  } catch {
    return null;
  }
}

// Legacy: kept for backward compat with existing UI
export async function getMarketOrders(marketId: string, status?: string): Promise<OrderbookOrder[]> {
  try {
    const subs = await getSubmarkets(marketId);
    if (subs.length === 0) return [];
    // Return orders for the first submarket
    return getSubmarketOrders(subs[0].id, status);
  } catch (error) {
    console.error('Failed to fetch orders:', error);
    return [];
  }
}

export async function getPriceHistory(marketId: string): Promise<PriceHistoryPoint[]> {
  try {
    const subs = await getSubmarkets(marketId);
    if (subs.length === 0) return [];
    // Return price history for the first submarket
    return getSubmarketPriceHistory(subs[0].id);
  } catch (error) {
    console.error('Failed to fetch price history:', error);
    return [];
  }
}
