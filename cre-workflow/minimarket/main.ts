// main.ts
// Entry point for the MiniMarket CRE workflow.
// Handles Info Reveal and Resolution workflows.

import {
  cre,
  type Runtime,
  Runner,
  getNetwork,
  EVMLog,
  bytesToHex,
} from "@chainlink/cre-sdk";
import { keccak256, toHex, decodeEventLog, parseAbi } from "viem";
import { configSchema, type Config, type LogDetails, type DecryptedSubmission } from "./types";
import { askGemini } from "./resolvers/gemini";
import { fetchSchema } from "./lib/schemaFetcher";
import { fetchBeacon, canDecrypt, decryptSubmission, verifySubmission } from "./lib/drand";
import { buildMerkleTree, type MerkleLeaf } from "./lib/merkle";
import { readFileSync } from "fs";
import { resolve } from "path";

const MINI_MARKET_ABI = JSON.parse(
  readFileSync(resolve("./abis/MiniMarket.json"), "utf-8")
);

const INFO_REVEAL_HASH = keccak256(
  toHex("InfoRevealRequested(uint256,uint64,uint256)")
);
const RESOLUTION_HASH = keccak256(
  toHex("ResolutionRequested(uint256,string,uint48)")
);

const onInfoRevealTrigger = (runtime: Runtime<Config>, log: EVMLog): string => {
  runtime.log("InfoRevealRequested event received");

  const topics = log.topics.map((t) => bytesToHex(t)) as [
    `0x${string}`,
    ...`0x${string}`[]
  ];
  const data = bytesToHex(log.data);

  const eventAbi = parseAbi([
    "event InfoRevealRequested(uint256 indexed marketId, uint64 drandTargetRound, uint256 submissionCount)",
  ]);

  const decodedLog = decodeEventLog({ abi: eventAbi, data, topics });
  const marketId = decodedLog.args.marketId;
  const targetRound = decodedLog.args.drandTargetRound;

  runtime.log(`Market ID: ${marketId}`);
  runtime.log(`Target Round: ${targetRound}`);

  const network = runtime.config.drandNetwork;

  if (!canDecrypt(targetRound, network)) {
    runtime.log("Target round not yet reached, skipping");
    return "SKIPPED_NOT_YET";
  }

  try {
    let beacon;
    try {
      beacon = fetchBeacon(runtime, targetRound, network);
      runtime.log(`Beacon fetched for round ${targetRound}`);
    } catch (beaconError) {
      runtime.log(`Failed to fetch drand beacon: ${beaconError}`);
      runtime.log("No beacon available - completing reveal with empty submissions for testing");
      
      const { root: merkleRoot } = buildMerkleTree([]);
      runtime.log(`Mock merkle root: ${merkleRoot}`);
      
      return "COMPLETED_MOCK_NO_BEACON";
    }

    const submissions = fetchSubmissions(runtime, marketId);
    runtime.log(`Fetched ${submissions.length} submissions`);

    const decrypted: DecryptedSubmission[] = [];

    for (const sub of submissions) {
      let yesPercent = 500n;
      let noPercent = 500n;
      let isValid = false;

      try {
        const decryptedData = decryptSubmission(sub.ciphertext, beacon);
        yesPercent = decryptedData.yesPercent;
        noPercent = decryptedData.noPercent;

        // If garbage (yes+no != 1000), assume 50-50
        if (yesPercent + noPercent !== 1000n) {
          yesPercent = 500n;
          noPercent = 500n;
        }

        isValid =
          verifySubmission(
            { agent: decryptedData.agent, yesPercent, noPercent, salt: decryptedData.salt },
            sub.validationHash
          );
      } catch (error) {
        runtime.log(`Failed to decrypt submission from ${sub.agent}, assuming 50-50: ${error}`);
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

    // Include all submissions (decrypt failure → assumed 50-50, still gets shares)
    const validSubmissions = decrypted;
    runtime.log(`Submissions to process: ${validSubmissions.length}`);

    if (validSubmissions.length === 0) {
      runtime.log("No submissions, skipping reveal");
      return "SKIPPED_NO_VALID";
    }

    // Consensus = average yesPercent (price discovery)
    const totalYes = validSubmissions.reduce((s, x) => s + x.yesPercent, 0n);
    const consensusYesPercent = totalYes / BigInt(validSubmissions.length);
    const consensusNoPercent = 1000n - consensusYesPercent;
    const consensusOutcome: 1 | 2 = consensusYesPercent >= 500n ? 1 : 2;

    // Fixed pool: K yes-shares, K no-shares (constant-sum)
    const PRECISION = BigInt(10 ** 18);
    const K = BigInt(validSubmissions.length) * PRECISION;
    let totalReserveYes = 0n;
    let totalReserveNo = 0n;

    // Score = proximity to consensus (1000 - distance)
    const scores = validSubmissions.map((s) => {
      const dist = s.yesPercent >= consensusYesPercent
        ? s.yesPercent - consensusYesPercent
        : consensusYesPercent - s.yesPercent;
      return 1000n - dist;
    });
    const totalScore = scores.reduce((a, b) => a + b, 0n);

    // Allocate: yesShares_i = K * (score_i * yesPercent_i) / sum(score_j * yesPercent_j)
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

    // AMM reserves: constant-sum, proportional to consensus
    const totalReserve = 2n * K;
    totalReserveYes = (totalReserve * consensusYesPercent) / 1000n;
    totalReserveNo = (totalReserve * consensusNoPercent) / 1000n;

    const { root: merkleRoot } = buildMerkleTree(
      validSubmissions.map((s) => ({
        agent: s.agent,
        yesShares: s.yesShares,
        noShares: s.noShares,
      }))
    );

    runtime.log(`Consensus: ${consensusOutcome === 1 ? "YES" : "NO"}`);
    runtime.log(`Merkle Root: ${merkleRoot}`);
    runtime.log(`Total Reserve YES: ${totalReserveYes}`);
    runtime.log(`Total Reserve NO: ${totalReserveNo}`);

    // Submit onchain reveal
    // In simulation mode, this would call the contract
    // For now, we just return success
    return "PROCESSED";
  } catch (error) {
    runtime.log(`Error processing reveal: ${error}`);
    throw error;
  }
};

const onResolutionTrigger = (runtime: Runtime<Config>, log: EVMLog): string => {
  runtime.log("ResolutionRequested event received");

  const topics = log.topics.map((t) => bytesToHex(t)) as [
    `0x${string}`,
    ...`0x${string}`[]
  ];
  const data = bytesToHex(log.data);

  const eventAbi = parseAbi([
    "event ResolutionRequested(uint256 indexed marketId, string schemaURI, uint48 tradingEnd)",
  ]);

  const decodedLog = decodeEventLog({ abi: eventAbi, data, topics });
  const marketId = decodedLog.args.marketId;
  const schemaURI = decodedLog.args.schemaURI;

  runtime.log(`Market ID: ${marketId}`);
  runtime.log(`Schema URI: ${schemaURI}`);

  try {
    const schemaResult = fetchSchema(runtime, schemaURI);
    runtime.log(`Schema fetched: ${schemaResult.schema.type}`);

    const deadline = schemaResult.schema.deadline;
    const currentTimestamp = Math.floor(Date.now() / 1000);

    if (currentTimestamp < deadline) {
      runtime.log(`Deadline not reached (${deadline}), skipping resolution`);
      return "SKIPPED_NOT_YET";
    }

    // For AI resolution, call Gemini
    const geminiResponse = askGemini(
      runtime,
      marketId.toString(),
      schemaResult.schema.description || "Resolve this market"
    );

    runtime.log(`Gemini response: ${geminiResponse.geminiResponse}`);

    const parsed = JSON.parse(geminiResponse.geminiResponse);
    const result = parsed.result;
    const confidence = parsed.confidence || 0;

    runtime.log(`Resolution: ${result}`);
    runtime.log(`Confidence: ${confidence}`);

    // Submit onchain resolution
    // In simulation mode, this would call resolveMarket()
    return `RESOLVED_${result}`;
  } catch (error) {
    runtime.log(`Error processing resolution: ${error}`);
    throw error;
  }
};

// Placeholder for fetching submissions
const fetchSubmissions = (
  _runtime: Runtime<Config>,
  _marketId: bigint
): Array<{
  agent: `0x${string}`;
  ciphertext: `0x${string}`;
  validationHash: `0x${string}`;
}> => {
  // In production, this would call the contract to get all submissions
  // For simulation, return mock data
  return [];
};

const initWorkflow = (config: Config) => {
  const network = getNetwork({
    chainFamily: "evm",
    chainSelectorName: config.evms[0].chainSelectorName,
    isTestnet: true,
  });

  if (!network) {
    throw new Error(
      `Network not found for chain selector name: ${config.evms[0].chainSelectorName}`
    );
  }

  const evmClient = new cre.capabilities.EVMClient(network.chainSelector.selector);

  const triggerConfig = {
    addresses: [config.evms[0].marketAddress],
    topics: [{ values: [RESOLUTION_HASH] }] as any,
    confidence: "CONFIDENCE_LEVEL_FINALIZED" as const,
  };

  return [
    cre.handler(
      evmClient.logTrigger(triggerConfig),
      onResolutionTrigger
    ),
  ];
};

export async function main() {
  const runner = await Runner.newRunner<Config>({ configSchema });
  await runner.run(initWorkflow);
}

main();
