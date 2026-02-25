// Phase 2: Plaintext Prediction Market - Cron workflow
// Resolves markets using Gemini + grounded Google Search, posts resolveMarket onchain

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
import { configSchema, type Config } from "./types";
import { askGemini } from "./resolvers/gemini";
import { fetchPhase2PendingMarkets } from "./lib/ponder";
import { resolutionSchema, type ResolutionSchema } from "./types";

const onCronTrigger = (runtime: Runtime<Config>): string => {
  runtime.log("Phase 2 cron triggered");

  const pending = fetchPhase2PendingMarkets(runtime);
  if (pending.length === 0) {
    runtime.log("No phase2 markets to resolve");
    return "NO_PENDING";
  }

  const market = pending[0];
  const marketId = BigInt(market.marketId);
  const evmConfig = runtime.config.evms[0];

  try {
    if (!market.schema) {
      runtime.log(`Market ${marketId}: no schema`);
      return "SKIPPED_NO_SCHEMA";
    }
    const schema = resolutionSchema.parse(market.schema);

    const deadline = schema.deadline;
    const now = Math.floor(Date.now() / 1000);

    if (now < deadline) {
      runtime.log(`Market ${marketId}: deadline not reached`);
      return "SKIPPED_NOT_YET";
    }

    const question =
      schema.description ??
      schema.fallback?.prompt ??
      market.question;

    const geminiResponse = askGemini(runtime, market.marketId, question);
    runtime.log(`Gemini response: ${geminiResponse.geminiResponse}`);

    let parsed: { result: string; confidence?: number };
    try {
      parsed = JSON.parse(geminiResponse.geminiResponse);
    } catch {
      runtime.log("Invalid JSON from Gemini");
      return "SKIPPED_INVALID_RESPONSE";
    }

    const result = parsed.result;
    if (result === "INCONCLUSIVE") {
      runtime.log(`Market ${marketId}: inconclusive`);
      return "SKIPPED_INCONCLUSIVE";
    }

    const outcome = result === "YES" ? 1 : 2;

    // Report format for resolution: (uint8 selector=1, uint256 marketId, uint8 outcome)
    // Contract onReport must be extended to support selector 1 and call resolveMarket
    const reportData = encodeAbiParameters(
      parseAbiParameters("uint8, uint256, uint8"),
      [1, marketId, outcome]
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
      runtime.log("Network not found");
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
      runtime.log(`Resolved market ${marketId} as ${result}: ${txHash}`);
      return `RESOLVED_${result}_${txHash}`;
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
  return [handler(cron.trigger({ schedule: config.schedule }), onCronTrigger)];
};

export async function main() {
  const runner = await Runner.newRunner<Config>({ configSchema });
  await runner.run(initWorkflow);
}

main();
