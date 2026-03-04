// ponder.ts - Ponder API client for Phase 1

import {
  cre,
  ok,
  consensusIdenticalAggregation,
  type Runtime,
  type HTTPSendRequester,
} from "@chainlink/cre-sdk";
import { type Config, type PonderSubmission } from "../types";

export interface Phase1PendingMarket {
  marketId: string;
  optionCount: number;
  drandTargetRound: string;
  drandChainHash: string;
  submissionCount: number;
  submissions?: Array<{ agent: string; validationHash: string; ciphertext: string }>;
}

/** Ponder next-phase1 response shape */
interface NextPhase1Response {
  marketId: string;
  optionCount: number;
  drandTargetRound: string;
  drandChainHash: string;
  submissionCount: number;
  submissions?: Array<{ agent: string; validationHash: string; ciphertext: string }>;
}

/** Fetch markets from Ponder /workflows/next-phase1 endpoint */
export const fetchPhase1PendingMarkets = (
  runtime: Runtime<Config>
): Phase1PendingMarket[] => {
  const httpClient = new cre.capabilities.HTTPClient();
  const network = runtime.config.drandNetwork;
  const currentRound = BigInt(
    Math.floor((Math.floor(Date.now() / 1000) - network.genesis) / network.period)
  );

  let result: NextPhase1Response[];
  try {
    result = httpClient
      .sendRequest(
        runtime,
        fetchNextPhase1Request(runtime.config.ponderUrl, currentRound.toString()),
        consensusIdenticalAggregation<NextPhase1Response[]>()
      )(runtime.config)
      .result();
  } catch (e) {
    runtime.log(`Ponder next-phase1 fetch failed: ${e}`);
    return [];
  }

  return result;
};

const fetchNextPhase1Request =
  (baseUrl: string, currentDrandRound: string) =>
    (sendRequester: HTTPSendRequester, _config: Config): NextPhase1Response[] => {
      const url = `${baseUrl.replace(/\/$/, "")}/workflows/next-phase1?currentDrandRound=${currentDrandRound}`;
      const req = {
        url,
        method: "GET" as const,
        headers: { Accept: "application/json" },
        cacheSettings: { store: false },
      };
      const resp = sendRequester.sendRequest(req).result();
      const bodyText = new TextDecoder().decode(resp.body);
      if (!ok(resp)) return [];
      const data = JSON.parse(bodyText);
      return Array.isArray(data) ? data : [];
    };

/** Fetch submissions for a market - Ponder has agent, validationHash but NOT ciphertext */
export const fetchSubmissionsFromPonder = (
  runtime: Runtime<Config>,
  marketId: string
): PonderSubmission[] => {
  try {
    const httpClient = new cre.capabilities.HTTPClient();
    return httpClient
      .sendRequest(
        runtime,
        fetchSubmissionsRequest(runtime.config.ponderUrl, marketId),
        consensusIdenticalAggregation<PonderSubmission[]>()
      )(runtime.config)
      .result();
  } catch {
    runtime.log(`Ponder submissions fetch failed for market ${marketId}`);
    return [];
  }
};

const fetchSubmissionsRequest =
  (baseUrl: string, marketId: string) =>
    (sendRequester: HTTPSendRequester, _config: Config): PonderSubmission[] => {
      const req = {
        url: `${baseUrl.replace(/\/$/, "")}/markets/${marketId}/submissions`,
        method: "GET" as const,
        headers: { Accept: "application/json" },
        cacheSettings: { store: true, maxAge: "30s" },
      };
      const resp = sendRequester.sendRequest(req).result();
      const bodyText = new TextDecoder().decode(resp.body);
      if (!ok(resp)) return [];
      const data = JSON.parse(bodyText);
      return Array.isArray(data) ? data : [];
    };
