import { timelockEncrypt, timelockDecrypt, HttpCachingChain, HttpChainClient } from 'tlock-js';
import type { ChainClient } from 'tlock-js';
import { keccak256, encodeAbiParameters, parseAbiParameters } from 'viem';
import { DRAND_QUICKNET, type NetworkInfo } from './network.js';

export interface EncryptedPayload {
  ciphertext: string;
  round: bigint;
  targetTime: Date;
  network: NetworkInfo;
}

/** Legacy: binary outcome (deprecated) */
export interface PredictionPayload {
  outcome: 1 | 2;
  agent: string;
  salt: string;
}

/** Phase1 price discovery: yes/no as % in 1000 basis points (e.g. 700/300 = 70% yes, 30% no) */
export interface PredictionPayloadBasisPoints {
  yesPercent: number;  // 0-1000
  noPercent: number;   // 0-1000, must equal 1000 - yesPercent
  agent: string;
  salt: string;
}

export function createDrandClient(network: NetworkInfo): ChainClient {
  const chainHash = network.chainHash.replace(/^0x/, '');
  const url = `${network.httpClient}/${chainHash}`;
  const chain = new HttpCachingChain(url);
  return new HttpChainClient(chain);
}

export async function encryptPrediction(
  prediction: PredictionPayload,
  targetRound: bigint,
  network: NetworkInfo = DRAND_QUICKNET
): Promise<EncryptedPayload> {
  const payload = JSON.stringify(prediction);
  const client = createDrandClient(network);

  const ciphertext = await timelockEncrypt(
    Number(targetRound),
    Buffer.from(new TextEncoder().encode(payload)),
    client
  );

  return {
    ciphertext: Buffer.from(ciphertext).toString('base64'),
    round: targetRound,
    targetTime: new Date((network.genesis + Number(targetRound) * network.period) * 1000),
    network,
  };
}

/** Encrypt yes/no prediction as basis points (1000 = 100%) */
export async function encryptPredictionBasisPoints(
  prediction: PredictionPayloadBasisPoints,
  targetRound: bigint,
  network: NetworkInfo = DRAND_QUICKNET
): Promise<EncryptedPayload> {
  const payload = JSON.stringify({
    yesPercent: prediction.yesPercent,
    noPercent: prediction.noPercent,
    agent: prediction.agent,
    salt: prediction.salt,
  });
  const client = createDrandClient(network);

  const ciphertext = await timelockEncrypt(
    Number(targetRound),
    Buffer.from(new TextEncoder().encode(payload)),
    client
  );

  return {
    ciphertext: Buffer.from(ciphertext).toString('base64'),
    round: targetRound,
    targetTime: new Date((network.genesis + Number(targetRound) * network.period) * 1000),
    network,
  };
}

export async function decryptPrediction(
  encryptedPayload: EncryptedPayload,
  network: NetworkInfo = DRAND_QUICKNET
): Promise<PredictionPayload> {
  const client = createDrandClient(network);
  const ciphertext = Buffer.from(encryptedPayload.ciphertext, 'base64');

  const decrypted = await timelockDecrypt(ciphertext, client);
  return JSON.parse(new TextDecoder().decode(decrypted));
}

export function computeValidationHash(prediction: PredictionPayload): string {
  const encoder = new TextEncoder();
  const data = new Uint8Array([
    ...encoder.encode(prediction.outcome.toString()),
    ...encoder.encode(prediction.agent),
    ...encoder.encode(prediction.salt),
  ]);
  
  return Buffer.from(data).toString('hex');
}

/** Validation hash for basis points: keccak256(agent, yesPercent, noPercent, salt) */
export function computeValidationHashBasisPoints(prediction: PredictionPayloadBasisPoints): `0x${string}` {
  const saltHex = prediction.salt.startsWith('0x') ? prediction.salt.slice(2) : prediction.salt;
  const saltBytes = `0x${saltHex.padEnd(64, '0').slice(0, 64)}` as `0x${string}`;
  return keccak256(
    encodeAbiParameters(
      parseAbiParameters('address, uint256, uint256, bytes32'),
      [
        prediction.agent as `0x${string}`,
        BigInt(prediction.yesPercent),
        BigInt(prediction.noPercent),
        saltBytes,
      ]
    )
  );
}

export async function canDecrypt(targetRound: bigint, network: NetworkInfo = DRAND_QUICKNET): Promise<boolean> {
  const current = BigInt(Math.floor((Math.floor(Date.now() / 1000) - network.genesis) / network.period));
  return current >= targetRound;
}
