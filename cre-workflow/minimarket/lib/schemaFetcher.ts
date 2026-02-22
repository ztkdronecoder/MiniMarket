// schemaFetcher.ts
// Fetch and parse resolution schemas from IPFS/HTTP URIs.

import { cre, ok, consensusIdenticalAggregation, type Runtime, type HTTPSendRequester } from "@chainlink/cre-sdk";
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

  const result: SchemaFetchResult = httpClient
    .sendRequest(
      runtime,
      fetchSchemaRequest(schemaURI),
      consensusIdenticalAggregation<SchemaFetchResult>()
    )(runtime.config)
    .result();

  return result;
};

const fetchSchemaRequest =
  (schemaURI: string) =>
  (sendRequester: HTTPSendRequester, _config: Config): SchemaFetchResult => {
    let url: string;

    if (schemaURI.startsWith("ipfs://")) {
      const cid = schemaURI.slice(7);
      url = `https://ipfs.io/ipfs/${cid}`;
    } else if (schemaURI.startsWith("ar://")) {
      const id = schemaURI.slice(5);
      url = `https://arweave.net/${id}`;
    } else if (schemaURI.startsWith("http://") || schemaURI.startsWith("https://")) {
      url = schemaURI;
    } else if (schemaURI.startsWith("mock://")) {
      return parseMockSchema(schemaURI);
    } else {
      throw new Error(`Unsupported schema URI scheme: ${schemaURI}`);
    }

    const req = {
      url,
      method: "GET" as const,
      headers: {
        Accept: "application/json",
      },
      cacheSettings: {
        readFromCache: true,
        maxAgeMs: 300_000,
      },
    };

    const resp = sendRequester.sendRequest(req).result();
    const bodyText = new TextDecoder().decode(resp.body);

    if (!ok(resp)) {
      throw new Error(`Failed to fetch schema from ${url}: ${resp.statusCode}`);
    }

    const parsed = JSON.parse(bodyText);
    const schema = resolutionSchema.parse(parsed);

    return {
      schema,
      rawJson: bodyText,
    };
  };

const parseMockSchema = (uri: string): SchemaFetchResult => {
  const mockSchema: ResolutionSchema = {
    version: "1.0",
    type: "ai",
    description: "Mock schema for testing",
    deadline: Math.floor(Date.now() / 1000) + 86400,
    resolution: {
      type: "ai",
      sources: [],
      targetValue: "0",
    },
    fallback: {
      type: "ai",
      provider: "gemini",
      prompt: uri.includes("price") ? "What is the current price?" : "Resolve this market",
    },
  };

  const rawJson = JSON.stringify(mockSchema);

  return {
    schema: mockSchema,
    rawJson,
  };
};
