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

const fetchViaRpc =
  (rpcUrl: string, marketId: bigint, marketAddress: string) =>
  (sendRequester: HTTPSendRequester, config: Config): EncryptedSubmission[] => {
    const countData = encodeFunctionData({
      abi: MINIMARKET_ABI,
      functionName: "getSubmissionCount",
      args: [marketId],
    });

    const countReq = {
      url: rpcUrl,
      method: "POST" as const,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "eth_call",
        params: [
          { to: marketAddress as `0x${string}`, data: countData },
          "latest",
        ],
      }),
      cacheSettings: { store: false },
    };

    const countResp = sendRequester.sendRequest(countReq).result();
    const countBody = new TextDecoder().decode(countResp.body);
    if (!ok(countResp)) return [];

    const countJson = JSON.parse(countBody) as { result?: string };
    const countHex = countJson.result;
    if (!countHex) return [];
    const count = BigInt(countHex);
    if (count === 0n) return [];

    const submissions: EncryptedSubmission[] = [];
    for (let i = 0; i < Number(count); i++) {
      const subData = encodeFunctionData({
        abi: MINIMARKET_ABI,
        functionName: "getSubmission",
        args: [marketId, BigInt(i)],
      });
      const subReq = {
        url: rpcUrl,
        method: "POST" as const,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: i + 2,
          method: "eth_call",
          params: [
            { to: marketAddress as `0x${string}`, data: subData },
            "latest",
          ],
        }),
        cacheSettings: { store: false },
      };
      const subResp = sendRequester.sendRequest(subReq).result();
      const subBody = new TextDecoder().decode(subResp.body);
      if (!ok(subResp)) continue;
      const subJson = JSON.parse(subBody) as { result?: string };
      const resultHex = subJson.result;
      if (!resultHex) continue;

      const decoded = decodeFunctionResult({
        abi: MINIMARKET_ABI,
        functionName: "getSubmission",
        data: resultHex as `0x${string}`,
      }) as [string, `0x${string}`, `0x${string}`, bigint];

      submissions.push({
        agent: decoded[0] as `0x${string}`,
        ciphertext: decoded[1],
        validationHash: decoded[2],
      });
    }
    return submissions;
  };
