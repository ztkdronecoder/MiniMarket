// ponder.ts - Ponder API client for Phase 2

import {
  cre,
  ok,
  consensusIdenticalAggregation,
  type Runtime,
  type HTTPSendRequester,
} from "@chainlink/cre-sdk";
import { type Config } from "../types";

export interface SubmarketEntry {
  submarketId: string;
  optionIndex: number;
  optionLabel: string;
}

export interface Phase2PendingMarket {
  marketId: string;
  question: string;
  tradingEnd: number;
  schema: Record<string, unknown>;
  submarkets: SubmarketEntry[];
}

/** Ponder next-phase2 response shape */
interface NextPhase2Response {
  marketId: string;
  question: string;
  tradingEnd: number;
  schema: Record<string, unknown>;
  submarkets: SubmarketEntry[];
}

/** Fetch markets from Ponder /workflows/next-phase2 endpoint */
export const fetchPhase2PendingMarkets = (
  runtime: Runtime<Config>
): Phase2PendingMarket[] => {
  let result: NextPhase2Response[];
  try {
    const httpClient = new cre.capabilities.HTTPClient();
    result = httpClient
      .sendRequest(
        runtime,
        fetchNextPhase2Request(runtime.config.ponderUrl),
        consensusIdenticalAggregation<NextPhase2Response[]>()
      )(runtime.config)
      .result();
  } catch (e) {
    runtime.log(`Ponder next-phase2 fetch failed: ${e}`);
    return [];
  }

  return result;
};

const fetchNextPhase2Request =
  (baseUrl: string) =>
    (sendRequester: HTTPSendRequester, _config: Config): NextPhase2Response[] => {
      const req = {
        url: `${baseUrl.replace(/\/$/, "")}/workflows/next-phase2`,
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
