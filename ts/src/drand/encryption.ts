import { timelockEncrypt, timelockDecrypt, NetworkInfo as TlockNetworkInfo } from 'tlock-js';
import { DRAND_QUICKNET, type NetworkInfo } from './network.js';

export interface EncryptedPayload {
  ciphertext: string;
  round: bigint;
  targetTime: Date;
  network: NetworkInfo;
}

export interface PredictionPayload {
  outcome: 1 | 2;
  agent: string;
  salt: string;
}

export function toTlockNetwork(network: NetworkInfo): TlockNetworkInfo {
  return {
    chainHash: network.chainHash,
    genesis: network.genesis,
    period: network.period,
    httpClient: network.httpClient,
  };
}

export async function encryptPrediction(
  prediction: PredictionPayload,
  targetRound: bigint,
  network: NetworkInfo = DRAND_QUICKNET
): Promise<EncryptedPayload> {
  const payload = JSON.stringify(prediction);
  const tlockNetwork = toTlockNetwork(network);
  
  const ciphertext = await timelockEncrypt(
    Number(targetRound),
    new TextEncoder().encode(payload),
    tlockNetwork
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
  const tlockNetwork = toTlockNetwork(network);
  const ciphertext = Buffer.from(encryptedPayload.ciphertext, 'base64');
  
  const decrypted = await timelockDecrypt(ciphertext, tlockNetwork);
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

export async function canDecrypt(targetRound: bigint, network: NetworkInfo = DRAND_QUICKNET): Promise<boolean> {
  const current = BigInt(Math.floor((Math.floor(Date.now() / 1000) - network.genesis) / network.period));
  return current >= targetRound;
}
