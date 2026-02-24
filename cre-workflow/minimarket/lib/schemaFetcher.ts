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
    } else if (schemaURI.startsWith("mock://") || schemaURI.startsWith("gemini://")) {
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
        store: true,
        maxAge: "300s",
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
  let description: string;
  let type: ResolutionSchema["type"] = "ai";
  
  if (uri.includes("btc-price") || uri.includes("bitcoin")) {
    if (uri.includes("70k") || uri.includes("70000")) {
      description = "Will Bitcoin price exceed $70,000 USD on Feb 20 2026?";
    } else if (uri.includes("95k") || uri.includes("95000")) {
      description = "Is Bitcoin price above $95,000 USD right now?";
    } else {
      description = "Is Bitcoin price above $95,000 USD right now?";
    }
    type = "price";
  } else if (uri.includes("eth-price") || uri.includes("ethereum")) {
    description = "Is Ethereum price above $3,000 USD right now?";
    type = "price";
  } else if (uri.includes("price")) {
    description = "What is the current price?";
    type = "price";
  } else {
    description = "Resolve this market";
  }

  const mockSchema: ResolutionSchema = {
    version: "1.0",
    type,
    description,
    deadline: Math.floor(Date.now() / 1000) - 1,
    resolution: {
      type: "ai",
      sources: [],
      targetValue: "0",
    },
    fallback: {
      type: "ai",
      provider: "gemini",
      prompt: description,
    },
  };

  const rawJson = JSON.stringify(mockSchema);

  return {
    schema: mockSchema,
    rawJson,
  };
};
