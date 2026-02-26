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
}

export interface RevealResult {
  merkleRoot: `0x${string}`;
  consensusOutcome: 1 | 2;
  consensusYesPercent: bigint;   // 0-1000 bp — the mean yes% across all submissions
  totalReserveYes: bigint;
  totalReserveNo: bigint;
  totalYesShares: bigint;        // sum of yesShares across all agents in merkle tree
  totalNoShares: bigint;         // sum of noShares across all agents in merkle tree
  validSubmissions: bigint;
  leaves: DecryptedSubmission[];
  getProof: (index: number) => `0x${string}`[];
}

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

        const dec = decrypted as { outcome?: number; yesPercent?: number; noPercent?: number; agent: string; salt: string };
        const hasBasisPoints = dec.yesPercent !== undefined || dec.noPercent !== undefined;
        yesPercent = BigInt(dec.yesPercent ?? (dec.outcome === 1 ? 1000 : dec.outcome === 2 ? 0 : 500));
        noPercent = BigInt(dec.noPercent ?? (dec.outcome === 2 ? 1000 : dec.outcome === 1 ? 0 : 500));

        // Normalize: if garbage (e.g. yes+no != 1000), assume 50-50
        if (yesPercent + noPercent !== 1000n) {
          yesPercent = 500n;
          noPercent = 500n;
        }

        const computedHash = hasBasisPoints
          ? this.computeValidationHashBasisPoints(sub.agent, yesPercent, noPercent, dec.salt)
          : this.computeValidationHash(dec as PredictionPayload);
        isValid = computedHash.toLowerCase() === sub.validationHash.toLowerCase();
      } catch (error) {
        console.error(`Failed to decrypt submission from ${sub.agent}, assuming 50-50:`, error);
      }

      results.push({
        agent: sub.agent,
        yesPercent,
        noPercent,
        salt: '',
        yesShares: 0n,
        noShares: 0n,
        validationHash: sub.validationHash,
        isConsensus: isValid,
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

  async processInfoReveal(marketId: bigint): Promise<RevealResult> {
    const submissions = await this.getSubmissions(marketId);
    const decrypted = await this.decryptSubmissions(submissions);

    if (decrypted.length === 0) {
      throw new Error('No submissions to process');
    }

    // Include all submissions (decrypt failure → assumed 50-50, still gets shares)
    const validSubmissions = decrypted;

    const totalYes = validSubmissions.reduce((s, x) => s + x.yesPercent, 0n);
    const consensusYesPercent = totalYes / BigInt(validSubmissions.length);
    const consensusOutcome: 1 | 2 = consensusYesPercent >= 500n ? 1 : 2;

    // Use 1e6 scale to match USDC/ticket cost — avoids imprecision from 1e18
    const PRECISION = BigInt(10 ** 6);
    const n = validSubmissions.length;
    const K = (BigInt(n) * PRECISION) / 2n; // total yes+no shares ≈ n * 1e6 (1 USDC per participant)
    const scores = validSubmissions.map(s => {
      const dist = s.yesPercent >= consensusYesPercent
        ? s.yesPercent - consensusYesPercent
        : consensusYesPercent - s.yesPercent;
      return 1000n - dist;
    });
    const totalScore = scores.reduce((a, b) => a + b, 0n);
    const weightedYes = validSubmissions.reduce((s, x, i) => s + scores[i] * x.yesPercent, 0n);
    const weightedNo = validSubmissions.reduce((s, x, i) => s + scores[i] * x.noPercent, 0n);

    for (let i = 0; i < validSubmissions.length; i++) {
      const sub = validSubmissions[i];
      const score = scores[i];
      if (weightedYes > 0n) sub.yesShares = (K * score * sub.yesPercent) / weightedYes;
      if (weightedNo > 0n) sub.noShares = (K * score * sub.noPercent) / weightedNo;
    }

    const totalReserve = 2n * K;
    const totalReserveYes = (totalReserve * consensusYesPercent) / 1000n;
    const totalReserveNo = (totalReserve * (1000n - consensusYesPercent)) / 1000n;

    const totalYesShares = validSubmissions.reduce((s, x) => s + x.yesShares, 0n);
    const totalNoShares  = validSubmissions.reduce((s, x) => s + x.noShares,  0n);

    const leafHashes = validSubmissions.map(s => this.computeLeaf(s));
    const tree = SimpleMerkleTree.of(leafHashes);
    const merkleRoot = tree.root as `0x${string}`;
    // getProof(valueIndex): valueIndex = submission index (0, 1, 2, ...); tree internally maps to sorted position
    const getProof = (submissionIndex: number) =>
      tree.getProof(submissionIndex) as `0x${string}`[];

    return {
      merkleRoot,
      consensusOutcome,
      consensusYesPercent,
      totalReserveYes,
      totalReserveNo,
      totalYesShares,
      totalNoShares,
      validSubmissions: BigInt(validSubmissions.length),
      leaves: validSubmissions,
      getProof,
    };
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
