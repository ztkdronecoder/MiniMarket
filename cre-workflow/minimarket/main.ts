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
import { buildMerkleTree, computeLeaf } from "./lib/merkle";

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
    const beacon = fetchBeacon(runtime, targetRound, network);
    runtime.log(`Beacon fetched for round ${targetRound}`);

    const submissions = fetchSubmissions(runtime, marketId);
    runtime.log(`Fetched ${submissions.length} submissions`);

    const decrypted: DecryptedSubmission[] = [];

    for (const sub of submissions) {
      try {
        const decryptedData = decryptSubmission(sub.ciphertext, beacon);
        const isValid = verifySubmission(decryptedData, sub.validationHash);

        decrypted.push({
          agent: decryptedData.agent,
          outcome: decryptedData.outcome,
          salt: decryptedData.salt,
          validationHash: sub.validationHash,
          isConsensus: isValid,
          allocatedShares: 0n,
        });
      } catch (error) {
        runtime.log(`Failed to decrypt submission from ${sub.agent}: ${error}`);
      }
    }

    const validSubmissions = decrypted.filter((s) => s.isConsensus);
    runtime.log(`Valid submissions: ${validSubmissions.length}`);

    if (validSubmissions.length === 0) {
      runtime.log("No valid submissions, skipping reveal");
      return "SKIPPED_NO_VALID";
    }

    const yesVotes = validSubmissions.filter((s) => s.outcome === 1).length;
    const noVotes = validSubmissions.filter((s) => s.outcome === 2).length;
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

    const { root: merkleRoot } = buildMerkleTree(validSubmissions);

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

  return [
    cre.handler(
      evmClient.logTrigger({
        addresses: [config.evms[0].marketAddress],
        topics: [{ values: [INFO_REVEAL_HASH] }],
        confidence: "CONFIDENCE_LEVEL_FINALIZED",
      }),
      onInfoRevealTrigger
    ),
    cre.handler(
      evmClient.logTrigger({
        addresses: [config.evms[0].marketAddress],
        topics: [{ values: [RESOLUTION_HASH] }],
        confidence: "CONFIDENCE_LEVEL_FINALIZED",
      }),
      onResolutionTrigger
    ),
  ];
};

export async function main() {
  const runner = await Runner.newRunner<Config>({ configSchema });
  await runner.run(initWorkflow);
}

main();
