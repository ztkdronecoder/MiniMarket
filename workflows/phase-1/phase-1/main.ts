// Phase 1: Encrypted Infomarket - Cron workflow
// Decrypts submissions via drand, builds merkle tree, posts revealInfoPhase onchain

import {
  cre,
  handler,
  Runner,
  getNetwork,
  hexToBase64,
  bytesToHex,
  TxStatus,
} from "@chainlink/cre-sdk";
import { CronCapability, type Runtime } from "@chainlink/cre-sdk";
import { encodeAbiParameters, parseAbiParameters } from "viem";
import { configSchema, type Config, type DecryptedSubmission } from "./types";
import { fetchBeacon, canDecrypt, decryptSubmission, verifySubmission } from "./lib/drand";
import { buildMerkleTree } from "./lib/merkle";
import { fetchPhase1PendingMarkets } from "./lib/ponder";
import { fetchSubmissionsFromContract } from "./lib/contract";

const onCronTrigger = (runtime: Runtime<Config>): string => {
  runtime.log("Phase 1 cron triggered");

  const pending = fetchPhase1PendingMarkets(runtime);
  if (pending.length === 0) {
    runtime.log("No phase1 markets to decrypt");
    return "NO_PENDING";
  }

  const market = pending[0];
  const marketId = BigInt(market.marketId);
  const targetRound = BigInt(market.drandTargetRound);
  const network = runtime.config.drandNetwork;
  const evmConfig = runtime.config.evms[0];

  if (!canDecrypt(targetRound, network)) {
    runtime.log(`Market ${marketId}: drand round ${targetRound} not yet reached`);
    return "SKIPPED_NOT_YET";
  }

  try {
    let beacon;
    try {
      beacon = fetchBeacon(runtime, targetRound, network);
      runtime.log(`Beacon fetched for round ${targetRound}`);
    } catch (beaconError) {
      runtime.log(`Failed to fetch drand beacon: ${beaconError}`);
      return "SKIPPED_BEACON_FAILED";
    }

    const submissions = fetchSubmissionsFromContract(runtime, marketId, evmConfig.marketAddress);
    if (submissions.length === 0) {
      runtime.log(`Market ${marketId}: no submissions (rpcUrl required for ciphertext)`);
      return "SKIPPED_NO_SUBMISSIONS";
    }

    const decrypted: DecryptedSubmission[] = [];
    for (const sub of submissions) {
      let yesPercent = 500n;
      let noPercent = 500n;
      let isValid = false;

      try {
        const decryptedData = decryptSubmission(sub.ciphertext, beacon);
        yesPercent = decryptedData.yesPercent;
        noPercent = decryptedData.noPercent;
        if (yesPercent + noPercent !== 1000n) {
          yesPercent = 500n;
          noPercent = 500n;
        }
        isValid = verifySubmission(
          { agent: decryptedData.agent, yesPercent, noPercent, salt: decryptedData.salt },
          sub.validationHash
        );
      } catch (error) {
        runtime.log(`Failed to decrypt from ${sub.agent}: ${error}`);
      }

      decrypted.push({
        agent: sub.agent,
        yesPercent,
        noPercent,
        salt: "",
        validationHash: sub.validationHash,
        isConsensus: isValid,
        yesShares: 0n,
        noShares: 0n,
      });
    }

    const validSubmissions = decrypted;
    if (validSubmissions.length === 0) {
      return "SKIPPED_NO_VALID";
    }

    const totalYes = validSubmissions.reduce((s, x) => s + x.yesPercent, 0n);
    const consensusYesPercent = totalYes / BigInt(validSubmissions.length);
    const consensusNoPercent = 1000n - consensusYesPercent;
    const consensusOutcome: 1 | 2 = consensusYesPercent >= 500n ? 1 : 2;

    const PRECISION = BigInt(10 ** 18);
    const K = BigInt(validSubmissions.length) * PRECISION;

    const scores = validSubmissions.map((s) => {
      const dist =
        s.yesPercent >= consensusYesPercent
          ? s.yesPercent - consensusYesPercent
          : consensusYesPercent - s.yesPercent;
      return 1000n - dist;
    });

    const weightedYes = validSubmissions.reduce(
      (s, x, i) => s + scores[i] * x.yesPercent,
      0n
    );
    const weightedNo = validSubmissions.reduce(
      (s, x, i) => s + scores[i] * x.noPercent,
      0n
    );

    for (let i = 0; i < validSubmissions.length; i++) {
      const sub = validSubmissions[i];
      const score = scores[i];
      if (weightedYes > 0n) {
        sub.yesShares = (K * score * sub.yesPercent) / weightedYes;
      }
      if (weightedNo > 0n) {
        sub.noShares = (K * score * sub.noPercent) / weightedNo;
      }
    }

    const totalReserve = 2n * K;
    const totalReserveYes = (totalReserve * consensusYesPercent) / 1000n;
    const totalReserveNo = (totalReserve * consensusNoPercent) / 1000n;

    const totalYesShares = validSubmissions.reduce((s, x) => s + x.yesShares, 0n);
    const totalNoShares = validSubmissions.reduce((s, x) => s + x.noShares, 0n);

    const { root: merkleRoot } = buildMerkleTree(
      validSubmissions.map((s) => ({
        agent: s.agent,
        yesShares: s.yesShares,
        noShares: s.noShares,
      }))
    );

    runtime.log(`Consensus: ${consensusOutcome === 1 ? "YES" : "NO"}`);
    runtime.log(`Merkle Root: ${merkleRoot}`);

    // Report format: selector 0 = phase1 reveal (merkleRoot, leavesURI)
    // leavesURI: IPFS URI for merkle leaves JSON (empty until IPFS upload added)
    const reportData = encodeAbiParameters(
      parseAbiParameters("uint8, uint256, bytes32, uint8, uint128, uint128, uint256, uint128, uint128, string"),
      [
        0, // selector: phase1 reveal
        marketId,
        merkleRoot,
        consensusOutcome,
        totalReserveYes,
        totalReserveNo,
        BigInt(validSubmissions.length),
        totalYesShares,
        totalNoShares,
        "", // leavesURI - TODO: upload leaves to IPFS
      ]
    );

    const reportResponse = runtime
      .report({
        encodedPayload: hexToBase64(reportData),
        encoderName: "evm",
        signingAlgo: "ecdsa",
        hashingAlgo: "keccak256",
      })
      .result();

    const networkInfo = getNetwork({
      chainFamily: "evm",
      chainSelectorName: evmConfig.chainSelectorName,
      isTestnet: true,
    });
    if (!networkInfo) {
      runtime.log("Network not found, skipping writeReport");
      return "COMPUTED_NO_NETWORK";
    }

    const evmClient = new cre.capabilities.EVMClient(networkInfo.chainSelector.selector);
    const writeResult = evmClient
      .writeReport(runtime, {
        receiver: evmConfig.marketAddress as `0x${string}`,
        report: reportResponse,
        gasConfig: { gasLimit: evmConfig.gasLimit },
      })
      .result();

    if (writeResult.txStatus === TxStatus.SUCCESS) {
      const txHash = bytesToHex(writeResult.txHash || new Uint8Array(32));
      runtime.log(`Reveal submitted: ${txHash}`);
      return `REVEALED_${txHash}`;
    }

    runtime.log(`Write failed: ${writeResult.txStatus}`);
    return `FAILED_${writeResult.txStatus}`;
  } catch (error) {
    runtime.log(`Error: ${error}`);
    throw error;
  }
};

const initWorkflow = (config: Config) => {
  const cron = new CronCapability();
  return [
    handler(
      cron.trigger({ schedule: config.schedule }),
      onCronTrigger
    ),
  ];
};

export async function main() {
  const runner = await Runner.newRunner<Config>({ configSchema });
  await runner.run(initWorkflow);
}

main();
