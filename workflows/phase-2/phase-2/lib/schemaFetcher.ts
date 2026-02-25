// schemaFetcher.ts - Fetch resolution schemas for Phase 2

import {
  cre,
  ok,
  consensusIdenticalAggregation,
  type Runtime,
  type HTTPSendRequester,
} from "@chainlink/cre-sdk";
import { type Config, resolutionSchema, type ResolutionSchema } from "../types";

export interface SchemaFetchResult {
  schema: ResolutionSchema;
  rawJson: string;
}

export const fetchSchema = (
  runtime: Runtime<Config>,
  schemaURI: string
): SchemaFetchResult => {
  const httpClient = new cre.capabilities.HTTPClient();
  return httpClient
    .sendRequest(
      runtime,
      fetchSchemaRequest(schemaURI),
      consensusIdenticalAggregation<SchemaFetchResult>()
    )(runtime.config)
    .result();
};

const fetchSchemaRequest =
  (schemaURI: string) =>
  (sendRequester: HTTPSendRequester, _config: Config): SchemaFetchResult => {
    let url: string;
    if (schemaURI.startsWith("ipfs://")) {
      url = `https://ipfs.io/ipfs/${schemaURI.slice(7)}`;
    } else if (schemaURI.startsWith("ar://")) {
      url = `https://arweave.net/${schemaURI.slice(5)}`;
    } else if (schemaURI.startsWith("http://") || schemaURI.startsWith("https://")) {
      url = schemaURI;
    } else if (schemaURI.startsWith("mock://") || schemaURI.startsWith("gemini://")) {
      return parseMockSchema(schemaURI);
    } else {
      throw new Error(`Unsupported schema URI: ${schemaURI}`);
    }

    const req = {
      url,
      method: "GET" as const,
      headers: { Accept: "application/json" },
      cacheSettings: { store: true, maxAge: "300s" },
    };
    const resp = sendRequester.sendRequest(req).result();
    const bodyText = new TextDecoder().decode(resp.body);
    if (!ok(resp)) {
      throw new Error(`Failed to fetch schema: ${resp.statusCode}`);
    }
    const parsed = JSON.parse(bodyText);
    const schema = resolutionSchema.parse(parsed);
    return { schema, rawJson: bodyText };
  };

const parseMockSchema = (uri: string): SchemaFetchResult => {
  let description = "Resolve this market";
  if (uri.includes("btc") || uri.includes("bitcoin")) {
    description = "Is Bitcoin price above $95,000 USD right now?";
  } else if (uri.includes("eth") || uri.includes("ethereum")) {
    description = "Is Ethereum price above $3,000 USD right now?";
  }
  const schema: ResolutionSchema = {
    version: "1.0",
    type: "ai",
    description,
    deadline: Math.floor(Date.now() / 1000) - 1,
    resolution: { type: "ai", sources: [], targetValue: "0" },
    fallback: { type: "ai", provider: "gemini", prompt: description },
  };
  return { schema, rawJson: JSON.stringify(schema) };
};
