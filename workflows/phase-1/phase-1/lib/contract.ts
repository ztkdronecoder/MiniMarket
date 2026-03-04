// contract.ts - Fetch submissions (with ciphertext) from chain via RPC

import {
  cre,
  ok,
  consensusIdenticalAggregation,
  type Runtime,
  type HTTPSendRequester,
} from "@chainlink/cre-sdk";
import { type Config } from "../types";
import { encodeFunctionData, decodeFunctionResult } from "viem";

const MINIMARKET_ABI = [
  {
    type: "function",
    name: "getSubmissionCount",
    inputs: [{ name: "marketId", type: "uint256" }],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "getSubmission",
    inputs: [
      { name: "marketId", type: "uint256" },
      { name: "index", type: "uint256" },
    ],
    outputs: [
      {
        type: "tuple",
        components: [
          { name: "agent", type: "address" },
          { name: "ciphertext", type: "bytes" },
          { name: "validationHash", type: "bytes32" },
          { name: "targetRound", type: "uint64" },
        ],
      },
    ],
  },
] as const;

export interface EncryptedSubmission {
  agent: `0x${string}`;
  ciphertext: `0x${string}`;
  validationHash: `0x${string}`;
}

/** Fetch submissions with ciphertext from contract via RPC. Requires rpcUrl in config. */
export const fetchSubmissionsFromContract = (
  runtime: Runtime<Config>,
  marketId: bigint,
  marketAddress: string
): EncryptedSubmission[] => {
  const rpcUrl = runtime.config.rpcUrl;
  if (!rpcUrl) {
    runtime.log("No rpcUrl in config, cannot fetch ciphertext from contract");
    return [];
  }

  const httpClient = new cre.capabilities.HTTPClient();
  const result = httpClient
    .sendRequest(
      runtime,
      fetchViaRpc(rpcUrl, marketId, marketAddress),
      consensusIdenticalAggregation<EncryptedSubmission[]>()
    )(runtime.config)
    .result();
  return result;
};

/** Max submissions per batch (CRE simulator limits to 5 HTTP calls total; Ponder+drand=2, so 1 batch for contract) */
const MAX_SUBMISSIONS_BATCH = 10;

const fetchViaRpc =
  (rpcUrl: string, marketId: bigint, marketAddress: string) =>
  (sendRequester: HTTPSendRequester, _config: Config): EncryptedSubmission[] => {
    const countData = encodeFunctionData({
      abi: MINIMARKET_ABI,
      functionName: "getSubmissionCount",
      args: [marketId],
    });

    const batch: Array<{ jsonrpc: string; id: number; method: string; params: unknown[] }> = [
      {
        jsonrpc: "2.0",
        id: 0,
        method: "eth_call",
        params: [
          { to: marketAddress as `0x${string}`, data: countData },
          "latest",
        ],
      },
    ];
    for (let i = 0; i < MAX_SUBMISSIONS_BATCH; i++) {
      const subData = encodeFunctionData({
        abi: MINIMARKET_ABI,
        functionName: "getSubmission",
        args: [marketId, BigInt(i)],
      });
      batch.push({
        jsonrpc: "2.0",
        id: i + 1,
        method: "eth_call",
        params: [
          { to: marketAddress as `0x${string}`, data: subData },
          "latest",
        ],
      });
    }

    const batchReq = {
      url: rpcUrl,
      method: "POST" as const,
      headers: { "Content-Type": "application/json" },
      body: Buffer.from(JSON.stringify(batch), "utf8").toString("base64"),
      cacheSettings: { store: false },
    };

    const resp = sendRequester.sendRequest(batchReq).result();
    const bodyText = new TextDecoder().decode(resp.body);
    if (!ok(resp)) return [];

    let parsed: unknown;
    try {
      parsed = JSON.parse(bodyText || "[]");
    } catch {
      return [];
    }
    const batchResp = Array.isArray(parsed) ? parsed : [parsed];
    const byId = new Map<number, { result?: string }>();
    for (const item of batchResp) {
      if (item && typeof item === "object" && "id" in item && typeof (item as { id: number }).id === "number") {
        byId.set((item as { id: number }).id, item as { result?: string });
      }
    }

    const countItem = byId.get(0);
    const countHex = countItem?.result;
    if (!countHex || typeof countHex !== "string") return [];
    const count = BigInt(countHex);
    if (count === 0n) return [];

    const submissions: EncryptedSubmission[] = [];
    const toFetch = Math.min(Number(count), MAX_SUBMISSIONS_BATCH);
    for (let i = 0; i < toFetch; i++) {
      const item = byId.get(i + 1);
      const resultHex = item?.result;
      if (!resultHex || typeof resultHex !== "string") continue;
      try {
        const decoded = decodeFunctionResult({
          abi: MINIMARKET_ABI,
          functionName: "getSubmission",
          data: resultHex as `0x${string}`,
        }) as [string, `0x${string}`, `0x${string}`, bigint];
        const agent = decoded[0];
        const ciphertext = decoded[1];
        const validationHash = decoded[2];
        if (agent != null && ciphertext != null && validationHash != null) {
          submissions.push({
            agent: agent as `0x${string}`,
            ciphertext,
            validationHash,
          });
        }
      } catch {
        break;
      }
    }
    return submissions;
  };
