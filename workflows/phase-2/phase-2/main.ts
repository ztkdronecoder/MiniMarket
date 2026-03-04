// Phase 2: Plaintext Prediction Market - Cron workflow
// Resolves submarkets using Gemini + grounded Google Search, posts batch resolve onchain

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
  const submarkets = market.submarkets ?? [];

  if (submarkets.length === 0) {
    runtime.log(`Market ${marketId}: no submarkets to resolve`);
    return "SKIPPED_NO_SUBMARKETS";
  }

  try {
    // Try to extract question from schema; fall back to market.question
    let question = market.question ?? "";
    if (market.schema && typeof market.schema === "object") {
      const s = market.schema as Record<string, unknown>;
      question =
        (s.description as string) ??
        (s.resolution as Record<string, unknown>)?.prompt as string ??
        (s.fallback as Record<string, unknown>)?.prompt as string ??
        question;
    }

    runtime.log(`Market ${marketId}: asking Gemini for ${submarkets.length} submarket(s)`);

    const geminiResponse = askGemini(runtime, market.marketId, question, submarkets);
    runtime.log(`Gemini response: ${geminiResponse.geminiResponse}`);

    let parsed: { resolutions?: Array<{ submarketIndex: number; outcome: string }>; confidence?: number };
    try {
      parsed = JSON.parse(geminiResponse.geminiResponse);
    } catch {
      runtime.log("Invalid JSON from Gemini");
      return "SKIPPED_INVALID_RESPONSE";
    }

    const resolutions = parsed.resolutions ?? [];
    if (resolutions.length === 0 || (parsed.confidence ?? 0) === 0) {
      runtime.log(`Market ${marketId}: inconclusive`);
      return "SKIPPED_INCONCLUSIVE";
    }

    // Build smIds and outcomes in submarket order (index 0, 1, 2...)
    const smIds: `0x${string}`[] = [];
    const outcomes: number[] = [];
    for (const sm of submarkets) {
      const res = resolutions.find((r) => r.submarketIndex === sm.optionIndex);
      if (!res || (res.outcome !== "YES" && res.outcome !== "NO")) {
        runtime.log(`Market ${marketId}: missing resolution for submarket ${sm.optionIndex}`);
        return "SKIPPED_INCOMPLETE_RESOLUTION";
      }
      const sid = sm.submarketId.startsWith("0x") ? sm.submarketId : `0x${sm.submarketId}`;
      smIds.push(sid.toLowerCase() as `0x${string}`);
      outcomes.push(res.outcome === "YES" ? 1 : 2);
    }

    runtime.log(`Resolving ${smIds.length} submarket(s): ${outcomes.map((o) => (o === 1 ? "YES" : "NO")).join(", ")}`);

    // Report format: selector 3 = batch phase2 resolve (bytes32[] smIds, uint8[] outcomes)
    const reportData = encodeAbiParameters(
      parseAbiParameters("uint8, bytes32[], uint8[]"),
      [3, smIds, outcomes]
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
      runtime.log(`Resolved market ${marketId} (${smIds.length} submarkets): ${txHash}`);
      return `RESOLVED_${txHash}`;
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
