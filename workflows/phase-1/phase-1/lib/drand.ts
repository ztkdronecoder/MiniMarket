// drand.ts - Drand timelock decryption for Phase 1

import {
  cre,
  ok,
  consensusIdenticalAggregation,
  type Runtime,
  type HTTPSendRequester,
} from "@chainlink/cre-sdk";
import { keccak256, encodeAbiParameters, parseAbiParameters } from "viem";
import { timelockDecrypt, defaultChainInfo } from "tlock-js";
import type { ChainClient, ChainInfo } from "tlock-js";
import { type Config, type DecryptedSubmission, type DrandBeacon, type DrandConfig } from "../types";


export const fetchBeacon = (
  runtime: Runtime<Config>,
  round: bigint,
  network: DrandConfig
): DrandBeacon => {
  const httpClient = new cre.capabilities.HTTPClient();
  const result: DrandBeacon = httpClient
    .sendRequest(
      runtime,
      fetchBeaconRequest(round, network),
      consensusIdenticalAggregation<DrandBeacon>()
    )(runtime.config)
    .result();
  return result;
};

const fetchBeaconRequest =
  (round: bigint, network: DrandConfig) =>
  (sendRequester: HTTPSendRequester, _config: Config): DrandBeacon => {
    const chainHash = network.chainHash.replace(/^0x/i, "");
    const req = {
      url: `${network.httpClient}/${chainHash}/public/${round}`,
      method: "GET" as const,
      headers: { Accept: "application/json" },
      cacheSettings: { store: true, maxAge: "3600s" },
    };
    const resp = sendRequester.sendRequest(req).result();
    const bodyText = new TextDecoder().decode(resp.body);
    if (!ok(resp)) {
      throw new Error(`Failed to fetch drand beacon: ${resp.statusCode}`);
    }
    return JSON.parse(bodyText) as DrandBeacon;
  };

export const canDecrypt = (targetRound: bigint, network: DrandConfig): boolean => {
  const current = BigInt(
    Math.floor((Math.floor(Date.now() / 1000) - network.genesis) / network.period)
  );
  return current >= targetRound;
};

export const verifySubmission = (
  decrypted: { agent: `0x${string}`; yesPercent: bigint; noPercent: bigint; salt: string },
  validationHash: `0x${string}`
): boolean => {
  const saltBytes = decrypted.salt.padEnd(64, "0").slice(0, 64);
  const computed = keccak256(
    encodeAbiParameters(parseAbiParameters("address, uint256, uint256, bytes32"), [
      decrypted.agent,
      decrypted.yesPercent,
      decrypted.noPercent,
      `0x${saltBytes}` as `0x${string}`,
    ])
  );
  return computed.toLowerCase() === validationHash.toLowerCase();
};

// Build a static ChainClient backed by an already-fetched beacon.
// No outbound HTTP calls are made — beacon verification is disabled so
// we skip the signature check (we trust the CRE HTTP layer that already
// fetched the beacon above).
const makeStaticChainClient = (beacon: DrandBeacon): ChainClient => {
  const beaconForDrand = {
    round: Number(beacon.round),
    randomness: beacon.randomness,
    signature: beacon.signature,
  };
  const mockChain = {
    baseUrl: "mock://static",
    info: () => Promise.resolve(defaultChainInfo as ChainInfo),
  };
  return {
    options: { disableBeaconVerification: true, noCache: true },
    latest: () => Promise.resolve(beaconForDrand),
    get: (_round: number) => Promise.resolve(beaconForDrand),
    chain: () => mockChain,
  };
};

export type DecryptedPayload = {
  agent: `0x${string}`;
  yesPercent: bigint;
  noPercent: bigint;
  salt: string;
  /** Per-option predictions for multi-option markets */
  options?: Array<{ index: number; yesPercent: bigint; noPercent: bigint }>;
};

export const decryptSubmission = async (
  ciphertext: `0x${string}`,
  beacon: DrandBeacon,
  _network?: unknown
): Promise<DecryptedPayload> => {
  // Submissions are stored as 0x + hex(UTF-8 armor bytes).
  // sepolia-test/main.ts encodes as: Buffer.from(base64Armor, "base64").toString("hex")
  // So decoding is: hex → bytes → utf8 = armor string.
  const armorString = Buffer.from(ciphertext.slice(2), "hex").toString("utf8");
  const mockClient = makeStaticChainClient(beacon);
  const decrypted = await timelockDecrypt(armorString, mockClient);
  const parsed = JSON.parse(decrypted.toString("utf-8"));
  const yesPercent = BigInt(parsed.yesPercent ?? parsed.yesPercentBp ?? 500);
  const noPercent = BigInt(parsed.noPercent ?? parsed.noPercentBp ?? 500);
  const options = Array.isArray(parsed.options)
    ? parsed.options.map((o: { index?: number; yesPercent?: number; noPercent?: number }) => ({
        index: Number(o.index ?? 0),
        yesPercent: BigInt(o.yesPercent ?? 500),
        noPercent: BigInt(o.noPercent ?? 500),
      }))
    : undefined;
  return {
    agent: parsed.agent as `0x${string}`,
    yesPercent,
    noPercent,
    salt: parsed.salt || "",
    options,
  };
};
