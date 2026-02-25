import { createPublicClient, createWalletClient, http, type Address, type PublicClient, type WalletClient } from 'viem';
import { baseSepolia } from 'viem/chains';
import { MINIMARKET_ABI } from './abi.js';
import { 
  MarketPhase, 
  Outcome, 
  type MarketConfig, 
  type MarketState, 
  type MarketStats,
  type EncryptedSubmission 
} from './types.js';
import { DRAND_QUICKNET, currentRound, timeUntilRound } from '../drand/network.js';

const PRECISION = BigInt(10 ** 18);

export interface MiniMarketClientConfig {
  contractAddress: Address;
  rpcUrl?: string;
  chain?: typeof baseSepolia;
}

export class MiniMarketClient {
  private publicClient: PublicClient;
  private walletClient?: WalletClient;
  private contractAddress: Address;
  private chain: typeof baseSepolia;
  private drandNetwork = DRAND_QUICKNET;

  constructor(config: MiniMarketClientConfig) {
    this.chain = config.chain ?? baseSepolia;
    this.contractAddress = config.contractAddress;
    
    this.publicClient = createPublicClient({
      chain: this.chain,
      transport: http(config.rpcUrl),
    });
  }

  connectWallet(privateKey: `0x${string}`): void {
    this.walletClient = createWalletClient({
      chain: this.chain,
      transport: http(),
      account: privateKey,
    });
  }

  async getMarketConfig(marketId: bigint): Promise<MarketConfig> {
    const result = await this.publicClient.readContract({
      address: this.contractAddress,
      abi: MINIMARKET_ABI,
      functionName: 'configs',
      args: [marketId],
    });

    return {
      marketId: result[0],
      question: result[1],
      schemaJson: result[2],
      maxSlots: result[3],
      ticketCost: result[4],
      marketCap: result[5],
      drandTargetRound: result[6],
      drandChainHash: result[7],
      createdAt: result[8],
      tradingDuration: result[9],
    };
  }

  async getMarketState(marketId: bigint): Promise<MarketState> {
    const result = await this.publicClient.readContract({
      address: this.contractAddress,
      abi: MINIMARKET_ABI,
      functionName: 'states',
      args: [marketId],
    });

    return {
      phase: result[0] as MarketPhase,
      merkleRoot: result[1],
      consensusOutcome: result[2] as Outcome,
      reserveYes: result[3],
      reserveNo: result[4],
      totalClaimedYes: result[5],
      totalClaimedNo: result[6],
      resolvedOutcome: result[7] as Outcome,
    };
  }

  async getSubmissionCount(marketId: bigint): Promise<bigint> {
    return this.publicClient.readContract({
      address: this.contractAddress,
      abi: MINIMARKET_ABI,
      functionName: 'getSubmissionCount',
      args: [marketId],
    });
  }

  async getPriceRatio(marketId: bigint): Promise<{ priceYes: number; priceNo: number }> {
    const result = await this.publicClient.readContract({
      address: this.contractAddress,
      abi: MINIMARKET_ABI,
      functionName: 'getPriceRatio',
      args: [marketId],
    });

    return {
      priceYes: Number(result[0]) / Number(PRECISION),
      priceNo: Number(result[1]) / Number(PRECISION),
    };
  }

  async getMarketStats(marketId: bigint): Promise<MarketStats> {
    const [config, state, submissionCount, prices, usdc] = await Promise.all([
      this.getMarketConfig(marketId),
      this.getMarketState(marketId),
      this.getSubmissionCount(marketId),
      this.getPriceRatio(marketId),
      this.publicClient.readContract({
        address: this.contractAddress,
        abi: MINIMARKET_ABI,
        functionName: 'USDC',
      }),
    ]);

    const timeRemaining = timeUntilRound(config.drandTargetRound, this.drandNetwork);
    const tradingEndsAt = new Date(Number(config.createdAt + config.tradingDuration) * 1000);

    return {
      marketId: config.marketId,
      question: config.question,
      phase: state.phase,
      totalParticipants: Number(submissionCount),
      totalStaked: config.marketCap,
      reserveYes: state.reserveYes,
      reserveNo: state.reserveNo,
      priceYes: prices.priceYes,
      priceNo: prices.priceNo,
      consensusOutcome: state.consensusOutcome !== Outcome.NONE ? state.consensusOutcome : null,
      resolvedOutcome: state.resolvedOutcome !== Outcome.NONE ? state.resolvedOutcome : null,
      drandTargetRound: config.drandTargetRound,
      timeUntilDecrypt: timeRemaining,
      tradingEndsAt,
      usdc: usdc as `0x${string}`,
      ticketCost: config.ticketCost,
    };
  }

  async getDrandInfo(): Promise<{
    currentRound: bigint;
    genesis: bigint;
    period: bigint;
    chainHash: string;
  }> {
    const [genesis, period, chainHash] = await Promise.all([
      this.publicClient.readContract({
        address: this.contractAddress,
        abi: MINIMARKET_ABI,
        functionName: 'DRAND_GENESIS',
      }),
      this.publicClient.readContract({
        address: this.contractAddress,
        abi: MINIMARKET_ABI,
        functionName: 'DRAND_PERIOD',
      }),
      this.publicClient.readContract({
        address: this.contractAddress,
        abi: MINIMARKET_ABI,
        functionName: 'DRAND_QUICKNET_HASH',
      }),
    ]);

    return {
      currentRound: currentRound(this.drandNetwork),
      genesis,
      period,
      chainHash,
    };
  }

  getContractAddress(): Address {
    return this.contractAddress;
  }
}
