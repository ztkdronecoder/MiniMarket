import type { Market, MarketPhase, PriceHistoryPoint } from './types';

const PONDER_ENDPOINT = process.env.NEXT_PUBLIC_PONDER_ENDPOINT || 'http://localhost:42069';

interface PonderMarket {
  id: string;
  question: string;
  schemaURI: string | null;
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
}

interface PonderSubmission {
  id: string;
  marketId: string;
}

const graphqlQuery = async <T>(query: string, variables?: Record<string, unknown>): Promise<T> => {
  const response = await fetch(`${PONDER_ENDPOINT}/graphql`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query, variables }),
  });

  const json = await response.json();
  
  if (json.errors) {
    console.error('GraphQL errors:', json.errors);
    throw new Error(json.errors[0]?.message || 'GraphQL error');
  }

  return json.data;
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

function formatEth(value: string | bigint): string {
  const eth = Number(value) / 1e18;
  if (eth >= 1) return `${eth.toFixed(2)} ETH`;
  const wei = Number(value);
  if (wei >= 1000) return `${(wei / 1000).toFixed(2)} K wei`;
  return `${wei} wei`;
}

export async function getMarkets(limit = 20, offset = 0): Promise<Market[]> {
  const query = `
    query GetMarkets($limit: Int!, $offset: Int!) {
      markets(
        limit: $limit
        offset: $offset
        orderBy: "id"
        orderDirection: "desc"
      ) {
        items {
          id
          question
          schemaURI
          phase
          totalParticipants
          marketCap
          ticketCost
          drandTargetRound
          merkleRoot
          consensusOutcome
          resolvedOutcome
          reserveYes
          reserveNo
          validSubmissions
          createdAt
        }
      }
    }
  `;

  try {
    const data = await graphqlQuery<{ markets: { items: PonderMarket[] } }>(query, { limit, offset });
    
    return data.markets.items.map((market) => {
      const { priceYes, priceNo } = calculatePrice(
        BigInt(market.reserveYes || 0),
        BigInt(market.reserveNo || 0)
      );
      
      return {
        id: market.id,
        question: market.question,
        schemaURI: market.schemaURI,
        phase: phaseFromNumber(market.phase),
        priceYes,
        priceNo,
        participants: Number(market.totalParticipants),
        totalStaked: formatEth(market.marketCap),
        decryptAt: new Date(Number(market.drandTargetRound) * 30 * 1000),
        tradingEndsAt: new Date(Number(market.createdAt) * 1000 + 7 * 24 * 60 * 60 * 1000),
        consensusOutcome: outcomeFromNumber(market.consensusOutcome),
        resolvedOutcome: outcomeFromNumber(market.resolvedOutcome),
        paymentToken: 'ETH',
        ticketCost: formatEth(market.ticketCost),
        drandTargetRound: BigInt(market.drandTargetRound),
      };
    });
  } catch (error) {
    console.error('Failed to fetch markets:', error);
    return [];
  }
}

export async function getMarketById(id: string): Promise<Market | null> {
  const query = `
    query GetMarket($id: String!) {
      market(id: $id) {
        id
        question
        schemaURI
        phase
        totalParticipants
        marketCap
        ticketCost
        drandTargetRound
        merkleRoot
        consensusOutcome
        resolvedOutcome
        reserveYes
        reserveNo
        validSubmissions
        createdAt
      }
    }
  `;

  try {
    const data = await graphqlQuery<{ market: PonderMarket | null }>(query, { id });
    
    if (!data.market) return null;
    
    const market = data.market;
    const { priceYes, priceNo } = calculatePrice(
      BigInt(market.reserveYes || 0),
      BigInt(market.reserveNo || 0)
    );
    
    return {
      id: market.id,
      question: market.question,
      schemaURI: market.schemaURI,
      phase: phaseFromNumber(market.phase),
      priceYes,
      priceNo,
      participants: Number(market.totalParticipants),
      totalStaked: formatEth(market.marketCap),
      decryptAt: new Date(Number(market.drandTargetRound) * 30 * 1000),
      tradingEndsAt: new Date(Number(market.createdAt) * 1000 + 7 * 24 * 60 * 60 * 1000),
      consensusOutcome: outcomeFromNumber(market.consensusOutcome),
      resolvedOutcome: outcomeFromNumber(market.resolvedOutcome),
      paymentToken: 'ETH',
      ticketCost: formatEth(market.ticketCost),
      drandTargetRound: BigInt(market.drandTargetRound),
    };
  } catch (error) {
    console.error('Failed to fetch market:', error);
    return null;
  }
}

export async function getMarketCount(): Promise<number> {
  const query = `
    query GetMarketCount {
      markets {
        totalCount
      }
    }
  `;

  try {
    const data = await graphqlQuery<{ markets: { totalCount: number } }>(query);
    return data.markets.totalCount;
  } catch {
    return 0;
  }
}

export async function getSubmissionCount(): Promise<number> {
  const query = `
    query GetSubmissionCount {
      submissions {
        totalCount
      }
    }
  `;

  try {
    const data = await graphqlQuery<{ submissions: { totalCount: number } }>(query);
    return data.submissions.totalCount;
  } catch {
    return 0;
  }
}

export async function getAgentCount(): Promise<number> {
  const query = `
    query GetAgentCount {
      agents {
        totalCount
      }
    }
  `;

  try {
    const data = await graphqlQuery<{ agents: { totalCount: number } }>(query);
    return data.agents.totalCount;
  } catch {
    return 0;
  }
}

export async function getPriceHistory(marketId: string): Promise<PriceHistoryPoint[]> {
  const query = `
    query GetPriceHistory($marketId: String!) {
      priceHistories(
        where: { marketId: $marketId }
        orderBy: "timestamp"
        orderDirection: "asc"
        limit: 1000
      ) {
        items {
          timestamp
          priceYes
          priceNo
          eventType
        }
      }
    }
  `;

  try {
    const data = await graphqlQuery<{ 
      priceHistories: { 
        items: Array<{
          timestamp: string;
          priceYes: string;
          priceNo: string;
          eventType: string;
        }>
      } 
    }>(query, { marketId });

    const PRECISION = BigInt('1000000000000000000');

    return data.priceHistories.items.map((item) => ({
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
