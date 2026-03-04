// pinata.ts - Upload merkle leaves to IPFS via Pinata (1 HTTP call)

import {
  cre,
  ok,
  consensusIdenticalAggregation,
  type Runtime,
  type HTTPSendRequester,
} from "@chainlink/cre-sdk";
import { type Config } from "../types";

export interface MerkleLeaf {
  agent: string;
  yesShares: string;
  noShares: string;
  yesPercent: string;
  noPercent: string;
  validationHash: string;
}

/** Single submarket leaves (for multi-option markets) */
export interface SubmarketLeaves {
  index: number;
  leaves: MerkleLeaf[];
}

/**
 * Upload merkle leaves JSON to Pinata and return the IPFS CID string.
 * For multi-option: pass submarkets array; for single-option pass leaves directly.
 * Returns empty string if upload fails (non-blocking — report still proceeds).
 * Counts as 1 HTTP call toward the CRE 5-call budget.
 */
export const uploadLeafesToPinata = (
  runtime: Runtime<Config>,
  marketId: bigint,
  leaves: MerkleLeaf[],
  jwtToken: string,
  submarkets?: SubmarketLeaves[]
): string => {
  if (!jwtToken) {
    runtime.log("No Pinata JWT, skipping IPFS upload");
    return "";
  }

  const httpClient = new cre.capabilities.HTTPClient();
  try {
    const cid = httpClient
      .sendRequest(
        runtime,
        pinataUploadRequest(marketId, leaves, jwtToken, submarkets),
        consensusIdenticalAggregation<string>()
      )(runtime.config)
      .result();
    return cid;
  } catch (e) {
    runtime.log(`Pinata upload failed: ${e}`);
    return "";
  }
};

const pinataUploadRequest =
  (marketId: bigint, leaves: MerkleLeaf[], jwtToken: string, submarkets?: SubmarketLeaves[]) =>
  (sendRequester: HTTPSendRequester, _config: Config): string => {
    const pinataContent = submarkets && submarkets.length > 0
      ? { marketId: marketId.toString(), submarkets }
      : { marketId: marketId.toString(), leaves };
    const body = JSON.stringify({
      pinataContent,
      pinataMetadata: {
        name: `minimarket-phase1-leaves-${marketId}`,
      },
    });

    const req = {
      url: "https://api.pinata.cloud/pinning/pinJSONToIPFS",
      method: "POST" as const,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${jwtToken}`,
      },
      body: Buffer.from(body, "utf8").toString("base64"),
      cacheSettings: { store: false },
    };

    const resp = sendRequester.sendRequest(req).result();
    const bodyText = new TextDecoder().decode(resp.body);
    if (!ok(resp)) {
      return "";
    }

    try {
      const parsed = JSON.parse(bodyText) as { IpfsHash?: string };
      return parsed.IpfsHash || "";
    } catch {
      return "";
    }
  };
