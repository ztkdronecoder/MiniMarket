import { createPublicClient, createWalletClient, http, type Address, type Log } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { baseSepolia } from 'viem/chains';
import { MINIMARKET_ABI } from '../market/abi.js';
import { decryptPrediction, type PredictionPayload, canDecrypt } from '../drand/encryption.js';
import { DRAND_QUICKNET, type NetworkInfo } from '../drand/network.js';
import { keccak256, encodeAbiParameters, encodePacked, parseAbiParameters } from 'viem';
import { SimpleMerkleTree } from '@openzeppelin/merkle-tree';

export interface CREWorkflowConfig {
  contractAddress: Address;
  privateKey: `0x${string}`;
  rpcUrl: string;
  chain?: typeof baseSepolia;
  drandNetwork?: NetworkInfo;
}

export interface InfoRevealRequestedEvent {
  marketId: bigint;
  targetRound: bigint;
  submissionCount: bigint;
}

export interface DecryptedSubmission {
  agent: Address;
  yesPercent: bigint;
  noPercent: bigint;
  salt: string;
  yesShares: bigint;
  noShares: bigint;
  validationHash: `0x${string}`;
  isConsensus: boolean;
  /** Per-option predictions (present when agent submitted a multi-option payload) */
  optionPredictions?: Array<{ index: number; yesPercent: bigint; noPercent: bigint }>;
}

/** Result for a single submarket (one optionIndex). */
export interface SubmarketRevealResult {
  optionIndex: number;
  merkleRoot: `0x${string}`;
  consensusOutcome: 1 | 2;
  consensusYesPercent: bigint;
  totalReserveYes: bigint;
  totalReserveNo: bigint;
  totalYesShares: bigint;
  totalNoShares: bigint;
  validSubmissions: bigint;
  leaves: DecryptedSubmission[];
  getProof: (index: number) => `0x${string}`[];
}

/** Backward-compat alias: single-submarket result (optionIndex = 0). */
export type RevealResult = SubmarketRevealResult;

export class CREWorkflow {
  private publicClient: ReturnType<typeof createPublicClient>;
  private walletClient: ReturnType<typeof createWalletClient>;
  private contractAddress: Address;
  private drandNetwork: NetworkInfo;

  constructor(config: CREWorkflowConfig) {
    this.contractAddress = config.contractAddress;
    this.drandNetwork = config.drandNetwork ?? DRAND_QUICKNET;

    const chain = config.chain ?? baseSepolia;

    this.publicClient = createPublicClient({
      chain,
      transport: http(config.rpcUrl),
    });

    this.walletClient = createWalletClient({
      chain,
      transport: http(config.rpcUrl),
      account: privateKeyToAccount(config.privateKey),
    });
  }

  async watchForInfoRevealRequests(
    fromBlock: bigint,
    onEvent: (event: InfoRevealRequestedEvent, log: Log) => void
  ): Promise<void> {
    const filter = await this.publicClient.createContractEventFilter({
      address: this.contractAddress,
      abi: MINIMARKET_ABI,
      eventName: 'InfoRevealRequested',
      fromBlock,
    });

    for await (const log of this.publicClient.watchContractEvent({
      address: this.contractAddress,
      abi: MINIMARKET_ABI,
      eventName: 'InfoRevealRequested',
    })) {
      const args = log.args as { marketId: bigint; targetRound: bigint; submissionCount: bigint };
      onEvent(
        {
          marketId: args.marketId,
          targetRound: args.targetRound,
          submissionCount: args.submissionCount,
        },
        log
      );
    }
  }

  async getSubmissions(marketId: bigint): Promise<Array<{
    agent: Address;
    ciphertext: `0x${string}`;
    validationHash: `0x${string}`;
    targetRound: bigint;
  }>> {
    const count = await this.publicClient.readContract({
      address: this.contractAddress,
      abi: MINIMARKET_ABI,
      functionName: 'getSubmissionCount',
      args: [marketId],
    });

    const submissions = [];
    for (let i = 0n; i < count; i++) {
      const submission = await this.publicClient.readContract({
        address: this.contractAddress,
        abi: MINIMARKET_ABI,
        functionName: 'getSubmission',
        args: [marketId, i],
      });
      submissions.push({
        agent: submission.agent as Address,
        ciphertext: submission.ciphertext as `0x${string}`,
        validationHash: submission.validationHash as `0x${string}`,
        targetRound: submission.targetRound,
      });
    }

    return submissions;
  }

  async decryptSubmissions(
    submissions: Array<{
      agent: Address;
      ciphertext: `0x${string}`;
      validationHash: `0x${string}`;
      targetRound: bigint;
    }>
  ): Promise<DecryptedSubmission[]> {
    const results: DecryptedSubmission[] = [];

    for (const sub of submissions) {
      let yesPercent = 500n;
      let noPercent = 500n;
      let isValid = false;
      let dec: { outcome?: number; yesPercent?: number; noPercent?: number; agent: string; salt: string; options?: Array<{index: number; yesPercent: number; noPercent: number}> } | null = null;

      try {
        // tlock-js expects armor string; contract stores hex bytes of armor (UTF-8)
        const decrypted = await decryptPrediction(
          {
            ciphertext: sub.ciphertext,
            round: sub.targetRound,
            targetTime: new Date(),
            network: this.drandNetwork,
          },
          this.drandNetwork
        );

        dec = decrypted as typeof dec;
        const hasBasisPoints = dec!.yesPercent !== undefined || dec!.noPercent !== undefined;
        yesPercent = BigInt(dec!.yesPercent ?? (dec!.outcome === 1 ? 1000 : dec!.outcome === 2 ? 0 : 500));
        noPercent = BigInt(dec!.noPercent ?? (dec!.outcome === 2 ? 1000 : dec!.outcome === 1 ? 0 : 500));

        // Normalize: if garbage (e.g. yes+no != 1000), assume 50-50
        if (yesPercent + noPercent !== 1000n) {
          yesPercent = 500n;
          noPercent = 500n;
        }

        const computedHash = hasBasisPoints
          ? this.computeValidationHashBasisPoints(sub.agent, yesPercent, noPercent, dec!.salt)
          : this.computeValidationHash(dec as unknown as PredictionPayload);
        isValid = computedHash.toLowerCase() === sub.validationHash.toLowerCase();
      } catch (error) {
        console.error(`Failed to decrypt submission from ${sub.agent}, assuming 50-50:`, error);
      }

      const optionPredictions = dec?.options
        ? dec.options.map((o) => ({
            index: o.index,
            yesPercent: BigInt(o.yesPercent),
            noPercent: BigInt(o.noPercent),
          }))
        : undefined;

      results.push({
        agent: sub.agent,
        yesPercent,
        noPercent,
        salt: '',
        yesShares: 0n,
        noShares: 0n,
        validationHash: sub.validationHash,
        isConsensus: isValid,
        optionPredictions,
      });
    }

    return results;
  }

  computeValidationHash(prediction: PredictionPayload): `0x${string}` {
    return keccak256(
      encodeAbiParameters(
        parseAbiParameters('uint8, address, bytes32'),
        [
          prediction.outcome,
          prediction.agent as Address,
          `0x${prediction.salt.padEnd(64, '0')}` as `0x${string}`,
        ]
      )
    );
  }

  computeValidationHashBasisPoints(agent: Address, yesPercent: bigint, noPercent: bigint, salt: string): `0x${string}` {
    const saltBytes = `0x${(salt.startsWith('0x') ? salt.slice(2) : salt).padEnd(64, '0').slice(0, 64)}` as `0x${string}`;
    return keccak256(
      encodeAbiParameters(
        parseAbiParameters('address, uint256, uint256, bytes32'),
        [agent, yesPercent, noPercent, saltBytes]
      )
    );
  }

  computeLeaf(submission: DecryptedSubmission): `0x${string}` {
    return keccak256(
      encodePacked(
        ['address', 'uint256', 'uint256'],
        [submission.agent, submission.yesShares, submission.noShares]
      )
    );
  }

  /**
   * Compute shares for a set of submissions for a single submarket's yesPercent values.
   * Returns a SubmarketRevealResult with a fresh merkle tree.
   */
  private computeSubmarketResult(
    optionIndex: number,
    submissions: Array<{ agent: Address; yesPercent: bigint; noPercent: bigint; validationHash: `0x${string}`; optionPredictions?: any[]; isConsensus: boolean }>,
  ): SubmarketRevealResult {
    const PRECISION = BigInt(10 ** 6);
    const n = submissions.length;
    const K = (BigInt(n) * PRECISION) / 2n;

    const totalYes = submissions.reduce((s, x) => s + x.yesPercent, 0n);
    const consensusYesPercent = totalYes / BigInt(n);
    const consensusOutcome: 1 | 2 = consensusYesPercent >= 500n ? 1 : 2;

    const scores = submissions.map(s => {
      const dist = s.yesPercent >= consensusYesPercent
        ? s.yesPercent - consensusYesPercent
        : consensusYesPercent - s.yesPercent;
      return 1000n - dist;
    });
    const weightedYes = submissions.reduce((s, x, i) => s + scores[i] * x.yesPercent, 0n);
    const weightedNo  = submissions.reduce((s, x, i) => s + scores[i] * x.noPercent, 0n);

    const leaves: DecryptedSubmission[] = submissions.map((sub, i) => {
      const score = scores[i];
      const yesShares = weightedYes > 0n ? (K * score * sub.yesPercent) / weightedYes : 0n;
      const noShares  = weightedNo  > 0n ? (K * score * sub.noPercent)  / weightedNo  : 0n;
      return {
        agent: sub.agent,
        yesPercent: sub.yesPercent,
        noPercent: sub.noPercent,
        salt: '',
        yesShares,
        noShares,
        validationHash: sub.validationHash,
        isConsensus: sub.isConsensus,
        optionPredictions: sub.optionPredictions,
      };
    });

    const totalReserve = 2n * K;
    const totalReserveYes = (totalReserve * consensusYesPercent) / 1000n;
    const totalReserveNo  = (totalReserve * (1000n - consensusYesPercent)) / 1000n;
    const totalYesShares  = leaves.reduce((s, x) => s + x.yesShares, 0n);
    const totalNoShares   = leaves.reduce((s, x) => s + x.noShares,  0n);

    const leafHashes = leaves.map(s => this.computeLeaf(s));
    const tree = SimpleMerkleTree.of(leafHashes);
    const merkleRoot = tree.root as `0x${string}`;
    const getProof = (idx: number) => tree.getProof(idx) as `0x${string}`[];

    return {
      optionIndex,
      merkleRoot,
      consensusOutcome,
      consensusYesPercent,
      totalReserveYes,
      totalReserveNo,
      totalYesShares,
      totalNoShares,
      validSubmissions: BigInt(n),
      leaves,
      getProof,
    };
  }

  /**
   * Process all encrypted submissions for a market and return per-submarket reveal results.
   * @param marketId Parent market ID
   * @param optionCount Number of submarkets (default 1)
   */
  async processInfoReveal(marketId: bigint, optionCount = 1): Promise<SubmarketRevealResult[]> {
    const submissions = await this.getSubmissions(marketId);
    const decrypted = await this.decryptSubmissions(submissions);

    if (decrypted.length === 0) {
      throw new Error('No submissions to process');
    }

    const results: SubmarketRevealResult[] = [];
    for (let optIdx = 0; optIdx < optionCount; optIdx++) {
      // Build per-option yesPercent for each submission:
      // If the agent included per-option predictions, use them; otherwise fall back to yesPercent.
      const optSubmissions = decrypted.map(sub => {
        const optPred = sub.optionPredictions?.find(p => p.index === optIdx);
        return {
          agent: sub.agent,
          yesPercent: optPred ? optPred.yesPercent : sub.yesPercent,
          noPercent:  optPred ? optPred.noPercent  : sub.noPercent,
          validationHash: sub.validationHash,
          optionPredictions: sub.optionPredictions,
          isConsensus: sub.isConsensus,
        };
      });
      results.push(this.computeSubmarketResult(optIdx, optSubmissions));
    }
    return results;
  }

  async submitReveal(marketId: bigint, result: RevealResult): Promise<`0x${string}`> {
    const { request } = await this.publicClient.simulateContract({
      address: this.contractAddress,
      abi: MINIMARKET_ABI,
      functionName: 'revealInfoPhase',
      args: [
        marketId,
        result.merkleRoot,
        result.consensusOutcome,
        result.totalReserveYes,
        result.totalReserveNo,
        result.validSubmissions,
        result.totalYesShares,
        result.totalNoShares,
      ],
      account: this.walletClient.account,
    });

    const hash = await this.walletClient.writeContract(request);
    return hash;
  }

  async submitOnReport(marketId: bigint, result: RevealResult): Promise<`0x${string}`> {
    const report = encodeAbiParameters(
      parseAbiParameters('uint256, bytes32, uint8, uint128, uint128, uint256, uint128, uint128'),
      [
        marketId,
        result.merkleRoot,
        result.consensusOutcome,
        result.totalReserveYes,
        result.totalReserveNo,
        result.validSubmissions,
        result.totalYesShares,
        result.totalNoShares,
      ]
    );

    const { request } = await this.publicClient.simulateContract({
      address: this.contractAddress,
      abi: MINIMARKET_ABI,
      functionName: 'onReport',
      args: [report, '0x'],
      account: this.walletClient.account,
    });

    const hash = await this.walletClient.writeContract(request);
    return hash;
  }

  async processAndReveal(marketId: bigint): Promise<{
    result: RevealResult;
    txHash: `0x${string}`;
  }> {
    const result = await this.processInfoReveal(marketId);
    const txHash = await this.submitOnReport(marketId, result);
    return { result, txHash };
  }
}

export async function runCREWorkflow(config: CREWorkflowConfig): Promise<void> {
  const workflow = new CREWorkflow(config);

  console.log('CRE Workflow started');
  console.log('Contract:', config.contractAddress);
  console.log('Watching for InfoRevealRequested events...');

  const latestBlock = await workflow['publicClient'].getBlockNumber();

  await workflow.watchForInfoRevealRequests(latestBlock, async (event) => {
    console.log(`\nInfoRevealRequested for market ${event.marketId}`);
    console.log(`Target round: ${event.targetRound}`);
    console.log(`Submission count: ${event.submissionCount}`);

    const canDecryptNow = await canDecrypt(event.targetRound, workflow['drandNetwork']);
    if (!canDecryptNow) {
      console.log('Target round not yet reached, waiting...');
      return;
    }

    try {
      const { result, txHash } = await workflow.processAndReveal(event.marketId);
      console.log(`Reveal submitted: ${txHash}`);
      console.log(`Consensus: ${result.consensusOutcome === 1 ? 'YES' : 'NO'}`);
      console.log(`Valid submissions: ${result.validSubmissions}`);
    } catch (error) {
      console.error('Failed to process reveal:', error);
    }
  });
}
