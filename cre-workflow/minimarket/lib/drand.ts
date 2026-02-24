// drand.ts
// Drand timelock decryption utilities for Info Reveal workflow.

import { cre, ok, consensusIdenticalAggregation, type Runtime, type HTTPSendRequester } from "@chainlink/cre-sdk";
import { type Config, type DecryptedSubmission, type DrandBeacon } from "../types";
import { keccak256, encodeAbiParameters, parseAbiParameters } from "viem";

export interface DrandConfig {
  chainHash: string;
  genesis: number;
  period: number;
  httpClient: string;
}

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
    const req = {
      url: `${network.httpClient}/${network.chainHash}/public/${round}`,
      method: "GET" as const,
      headers: {
        Accept: "application/json",
      },
      cacheSettings: {
        store: true,
        maxAge: "3600s",
      },
    };

    const resp = sendRequester.sendRequest(req).result();
    const bodyText = new TextDecoder().decode(resp.body);

    if (!ok(resp)) {
      throw new Error(`Failed to fetch drand beacon: ${resp.statusCode}`);
    }

    return JSON.parse(bodyText) as DrandBeacon;
  };

export const canDecrypt = (
  targetRound: bigint,
  network: DrandConfig
): boolean => {
  const current = BigInt(Math.floor((Math.floor(Date.now() / 1000) - network.genesis) / network.period));
  return current >= targetRound;
};

export const computeValidationHash = (
  outcome: 1 | 2,
  agent: `0x${string}`,
  salt: string
): `0x${string}` => {
  const saltBytes = salt.padEnd(64, "0").slice(0, 64);
  return keccak256(
    encodeAbiParameters(
      parseAbiParameters("uint8, address, bytes32"),
      [outcome, agent, `0x${saltBytes}` as `0x${string}`]
    )
  );
};

export const verifySubmission = (
  decrypted: { outcome: 1 | 2; agent: `0x${string}`; salt: string },
  validationHash: `0x${string}`
): boolean => {
  const computed = computeValidationHash(decrypted.outcome, decrypted.agent, decrypted.salt);
  return computed.toLowerCase() === validationHash.toLowerCase();
};

export const decryptSubmission = (
  ciphertext: `0x${string}`,
  beacon: DrandBeacon
): { outcome: 1 | 2; agent: `0x${string}`; salt: string } => {
  const ciphertextBytes = Buffer.from(ciphertext.slice(2), "hex");

  const signature = Buffer.from(beacon.signature, "hex");
  const randomness = Buffer.from(beacon.randomness, "hex");

  const decrypted = xorDecrypt(ciphertextBytes, signature);

  const parsed = JSON.parse(decrypted.toString("utf-8"));

  return {
    outcome: parsed.outcome === 2 ? 2 : 1,
    agent: parsed.agent as `0x${string}`,
    salt: parsed.salt || "",
  };
};

const xorDecrypt = (data: Buffer, key: Buffer): Buffer => {
  const result = Buffer.alloc(data.length);
  for (let i = 0; i < data.length; i++) {
    result[i] = data[i] ^ key[i % key.length];
  }
  return result;
};
