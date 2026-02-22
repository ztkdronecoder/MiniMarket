import { createPublicClient, createWalletClient, http, type Address, type Log } from 'viem';
import { baseSepalia, localhost } from 'viem/chains';
import { MINIMARKET_ABI } from '../market/abi.js';
import { decryptPrediction, type PredictionPayload, canDecrypt } from '../drand/encryption.js';
import { DRAND_QUICKNET, type NetworkInfo } from '../drand/network.js';
import { keccak256, encodeAbiParameters, parseAbiParameters } from 'viem';

export interface CREWorkflowConfig {
  contractAddress: Address;
  privateKey: `0x${string}`;
  rpcUrl: string;
  chain?: typeof baseSepalia;
  drandNetwork?: NetworkInfo;
}

export interface InfoRevealRequestedEvent {
  marketId: bigint;
  targetRound: bigint;
  submissionCount: bigint;
}

export interface DecryptedSubmission {
  agent: Address;
  outcome: 1 | 2;
  salt: string;
  allocatedShares: bigint;
  validationHash: `0x${string}`;
  isConsensus: boolean;
}

export interface RevealResult {
  merkleRoot: `0x${string}`;
  consensusOutcome: 1 | 2;
  totalReserveYes: bigint;
  totalReserveNo: bigint;
  validSubmissions: bigint;
  leaves: DecryptedSubmission[];
}

export class CREWorkflow {
  private publicClient: ReturnType<typeof createPublicClient>;
  private walletClient: ReturnType<typeof createWalletClient>;
  private contractAddress: Address;
  private drandNetwork: NetworkInfo;

  constructor(config: CREWorkflowConfig) {
    this.contractAddress = config.contractAddress;
    this.drandNetwork = config.drandNetwork ?? DRAND_QUICKNET;

    const chain = config.chain ?? baseSepalia;

    this.publicClient = createPublicClient({
      chain,
      transport: http(config.rpcUrl),
    });

    this.walletClient = createWalletClient({
      chain,
      transport: http(config.rpcUrl),
      account: config.privateKey,
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
      try {
        const ciphertextBytes = Buffer.from(sub.ciphertext.slice(2), 'hex');
        const ciphertextBase64 = ciphertextBytes.toString('base64');

        const decrypted = await decryptPrediction(
          {
            ciphertext: ciphertextBase64,
            round: sub.targetRound,
            targetTime: new Date(),
            network: this.drandNetwork,
          },
          this.drandNetwork
        );

        const computedHash = this.computeValidationHash(decrypted);
        const isValid = computedHash.toLowerCase() === sub.validationHash.toLowerCase();

        results.push({
          agent: sub.agent,
          outcome: decrypted.outcome,
          salt: decrypted.salt,
          allocatedShares: 0n,
          validationHash: sub.validationHash,
          isConsensus: isValid,
        });
      } catch (error) {
        console.error(`Failed to decrypt submission from ${sub.agent}:`, error);
      }
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

  computeMerkleRoot(leaves: Array<{ leaf: `0x${string}` }>): `0x${string}` {
    if (leaves.length === 0) {
      return '0x0000000000000000000000000000000000000000000000000000000000000000';
    }

    if (leaves.length === 1) {
      return leaves[0].leaf;
    }

    let currentLevel = leaves.map(l => l.leaf);
    
    while (currentLevel.length > 1) {
      const nextLevel: `0x${string}`[] = [];
      for (let i = 0; i < currentLevel.length; i += 2) {
        if (i + 1 < currentLevel.length) {
          nextLevel.push(
            keccak256(
              Buffer.concat([
                Buffer.from(currentLevel[i].slice(2), 'hex'),
                Buffer.from(currentLevel[i + 1].slice(2), 'hex'),
              ])
            )
          );
        } else {
          nextLevel.push(currentLevel[i]);
        }
      }
      currentLevel = nextLevel;
    }

    return currentLevel[0];
  }

  computeLeaf(submission: DecryptedSubmission): `0x${string}` {
    return keccak256(
      encodeAbiParameters(
        parseAbiParameters('address, uint8, uint256'),
        [submission.agent, submission.outcome, submission.allocatedShares]
      )
    );
  }

  async processInfoReveal(marketId: bigint): Promise<RevealResult> {
    const submissions = await this.getSubmissions(marketId);
    const decrypted = await this.decryptSubmissions(submissions);

    const validSubmissions = decrypted.filter(s => s.isConsensus);

    const yesVotes = validSubmissions.filter(s => s.outcome === 1).length;
    const noVotes = validSubmissions.filter(s => s.outcome === 2).length;
    const consensusOutcome: 1 | 2 = yesVotes >= noVotes ? 1 : 2;

    const PRECISION = BigInt(10 ** 18);
    let totalReserveYes = 0n;
    let totalReserveNo = 0n;

    for (const sub of validSubmissions) {
      const isConsensus = sub.outcome === consensusOutcome;
      const multiplier = isConsensus ? 4n : 1n;
      sub.allocatedShares = PRECISION * multiplier;

      if (sub.outcome === 1) {
        totalReserveYes += sub.allocatedShares;
      } else {
        totalReserveNo += sub.allocatedShares;
      }
    }

    const leaves = validSubmissions.map(s => ({
      leaf: this.computeLeaf(s),
    }));
    const merkleRoot = this.computeMerkleRoot(leaves);

    return {
      merkleRoot,
      consensusOutcome,
      totalReserveYes,
      totalReserveNo,
      validSubmissions: BigInt(validSubmissions.length),
      leaves: validSubmissions,
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
      ],
      account: this.walletClient.account,
    });

    const hash = await this.walletClient.writeContract(request);
    return hash;
  }

  async submitOnReport(marketId: bigint, result: RevealResult): Promise<`0x${string}`> {
    const report = encodeAbiParameters(
      parseAbiParameters('uint256, bytes32, uint8, uint128, uint128, uint256'),
      [
        marketId,
        result.merkleRoot,
        result.consensusOutcome,
        result.totalReserveYes,
        result.totalReserveNo,
        result.validSubmissions,
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
    const txHash = await this.submitReveal(marketId, result);
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
