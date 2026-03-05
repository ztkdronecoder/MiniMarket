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
  totalExpectedPenalty: string | null;
  totalClaimedYes: string | null;
  totalClaimedNo: string | null;
  creatorFallbackAmount: string | null;
  creatorFallbackClaimed: boolean | null;
  leavesURI: string | null;
  createdAt: string;
}

// ── Helpers ────────────────────────────────────────────────────────────────

const restGet = async <T>(path: string): Promise<T> => {
  const url = `${PONDER_ENDPOINT}${path}`;
  let response: Response;
  try {
    response = await fetch(url, { cache: 'no-store' });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`Ponder unreachable (${url}): ${msg}. Is the indexer running? (pnpm dev:base-sepolia)`);
  }
  if (!response.ok) {
    throw new Error(`Ponder HTTP ${response.status}: ${response.statusText} — ${path}`);
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
  // CRE semantics: reserveYes = allocation for YES outcome, reserveNo = allocation for NO.
  // So priceYes = reserveYes/total (probability of YES).
  const priceYes = Number(reserveYes) / Number(total);
  return { priceYes, priceNo: 1 - priceYes };
}

/** Format USDC (6 decimals) — show up to 6 decimal places for precision */
function formatUsdc(value: string | bigint, decimals = 6): string {
  const usdc = Number(value) / 1e6;
  return `${usdc.toFixed(decimals)} USDC`;
}

function mapPonderSubmarket(s: PonderSubmarket): Submarket {
  const reserveYes = BigInt(s.reserveYes || 0);
  const reserveNo = BigInt(s.reserveNo || 0);
  const totalYesShares = BigInt(s.totalYesShares || 0);
  const totalNoShares = BigInt(s.totalNoShares || 0);
  // When reserves are 0 (e.g. before/after reveal), use share distribution for price
  let priceYes: number;
  let priceNo: number;
  if (reserveYes + reserveNo > BigInt(0)) {
    const p = calculatePrice(reserveYes, reserveNo);
    priceYes = p.priceYes;
    priceNo = p.priceNo;
  } else if (totalYesShares + totalNoShares > BigInt(0)) {
    priceYes = Number(totalYesShares) / Number(totalYesShares + totalNoShares);
    priceNo = 1 - priceYes;
  } else {
    priceYes = 0.5;
    priceNo = 0.5;
  }
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
    totalExpectedPenalty: BigInt(s.totalExpectedPenalty || 0),
    totalClaimedYes: BigInt(s.totalClaimedYes || 0),
    totalClaimedNo: BigInt(s.totalClaimedNo || 0),
    creatorFallbackAmount: BigInt(s.creatorFallbackAmount || 0),
    creatorFallbackClaimed: s.creatorFallbackClaimed ?? false,
    leavesURI: s.leavesURI ?? null,
    createdAt: new Date(Number(s.createdAt) * 1000),
  };
}

const PHASE_ORDER: Record<MarketPhase, number> = { INFO_COLLECTION: 0, TRADING: 1, RESOLVED: 2 };

function mapPonderMarket(m: PonderMarket, submarkets: Submarket[] = []): Market {
  // Derive phase: use minimum across all submarkets (market stays "encrypted" until ALL submarkets revealed)
  const primary = submarkets[0] ?? null;
  const priceYes = primary?.priceYes ?? 0.5;
  const priceNo = primary?.priceNo ?? 0.5;
  const minOrder =
    submarkets.length > 0 ? Math.min(...submarkets.map((s) => PHASE_ORDER[s.phase])) : PHASE_ORDER[primary?.phase ?? 'INFO_COLLECTION'];
  const phase: MarketPhase =
    minOrder === 0 ? 'INFO_COLLECTION' : minOrder === 1 ? 'TRADING' : 'RESOLVED';
  const consensusOutcome = primary?.consensusOutcome ?? null;
  const resolvedOutcome = primary?.resolvedOutcome ?? null;
  const zero = BigInt(0);
  const totalPenaltyCollected = submarkets.reduce((sum, s) => sum + (s.totalPenaltyCollected ?? zero), zero);
  const totalExpectedPenalty = submarkets.reduce((sum, s) => sum + (s.totalExpectedPenalty ?? zero), zero);
  const creatorFallbackAmount = submarkets.reduce((sum, s) => sum + (s.creatorFallbackAmount ?? zero), zero);
  const effectivePenalty = totalPenaltyCollected > zero ? totalPenaltyCollected : (totalExpectedPenalty > zero ? totalExpectedPenalty : creatorFallbackAmount);

  // Total pool = (ticketCost * nParticipants + creatorOffer) * optionCount — what winners can claim
  const ticketCost = BigInt(m.ticketCost ?? 0);
  const nParticipants = Number(m.totalParticipants ?? 0);
  const creatorOffer = BigInt(m.creatorOffer ?? 0);
  const optionCount = Math.max(1, m.optionCount ?? 1);
  const poolPerSubmarket = ticketCost * BigInt(nParticipants) + creatorOffer;
  const totalPool = poolPerSubmarket * BigInt(optionCount);

  return {
    id: m.id,
    question: m.question,
    schema: m.schema,
    label: m.label ?? null,
    phase,
    priceYes,
    priceNo,
    participants: nParticipants,
    totalStaked: formatUsdc(totalPool),
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
    creatorPayout: formatUsdc(effectivePenalty),
    optionCount: m.optionCount ?? 1,
    submarkets,
  };
}

// ── Submarket API ──────────────────────────────────────────────────────────

export async function getSubmarkets(parentMarketId: string): Promise<Submarket[]> {
  try {
    const items = await restGet<PonderSubmarket[]>(`/markets/${parentMarketId}/submarkets`);
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

export interface CreatorStats {
  creator: string;
  totalMarkets: number;
  totalPnL: string;
  totalPremium: string;
  labels: Record<string, { markets: number; pnl: string }>;
}

export async function getCreators(limit = 20, offset = 0, label?: string): Promise<CreatorStats[]> {
  try {
    const labelParam = label ? `&label=${encodeURIComponent(label)}` : '';
    const rows = await restGet<CreatorStats[]>(
      `/creators?limit=${limit}&offset=${offset}${labelParam}`
    );
    return rows;
  } catch {
    return [];
  }
}

export async function getCreatorStats(address: string): Promise<CreatorStats | null> {
  const addr = (address || '').trim().toLowerCase();
  const normalized = addr.startsWith('0x') ? addr : `0x${addr}`;
  if (!normalized || normalized.length < 42) return null;
  try {
    return await restGet<CreatorStats>(`/creators/${normalized}`);
  } catch {
    // Fallback: fetch full list and find creator (handles address format mismatches)
    try {
      const all = await restGet<CreatorStats[]>(`/creators?limit=500`);
      const found = all.find((c) => c.creator.toLowerCase() === normalized);
      return found ?? null;
    } catch {
      return null;
    }
  }
}

export async function getCreatorMarkets(address: string, limit = 20, offset = 0): Promise<Market[]> {
  try {
    const addr = address.toLowerCase().startsWith('0x') ? address.toLowerCase() : `0x${address.toLowerCase()}`;
    const markets = await restGet<PonderMarket[]>(`/creators/${addr}/markets?limit=${limit}&offset=${offset}`);
    const withSubmarkets = await Promise.all(
      markets.map(async (m) => {
        const subs = await getSubmarkets(m.id).catch(() => []);
        return mapPonderMarket(m, subs);
      })
    );
    return withSubmarkets;
  } catch {
    return [];
  }
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

// Returns all orders across every submarket of this parent market
export async function getMarketOrders(marketId: string, status?: string): Promise<OrderbookOrder[]> {
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
    }>>(`/markets/${marketId}/orders?${statusParam}`);
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
