/**
 * Drand timelock encryption for agent predictions.
 * Mirrors ts/src/drand/encryption.ts for browser use.
 */
import { timelockEncrypt, HttpCachingChain, HttpChainClient } from 'tlock-js';
import { keccak256, encodeAbiParameters, parseAbiParameters } from 'viem';

/** Safe base64 encode for large Uint8Arrays (avoids spread stack overflow) */
function uint8ArrayToBase64(bytes: Uint8Array): string {
  const chunk = 4096;
  let binary = '';
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(
      null,
      Array.from(bytes.subarray(i, Math.min(i + chunk, bytes.length)))
    );
  }
  return btoa(binary);
}

export const DRAND_QUICKNET = {
  chainHash: '0x52db9ba70e0cc0f6eaf7803dd07447a1f5477735fd3f661792ba94600c84e971',
  genesis: 1692803367,
  period: 3,
  httpClient: 'https://api.drand.sh',
} as const;

export interface PredictionPayloadBasisPoints {
  yesPercent: number;
  noPercent: number;
  agent: string;
  salt: string;
  options?: Array<{ index: number; yesPercent: number; noPercent: number }>;
}

export async function encryptPredictionBasisPoints(
  prediction: PredictionPayloadBasisPoints,
  targetRound: bigint,
  network = DRAND_QUICKNET
): Promise<{ ciphertext: string }> {
  const payloadObj: Record<string, unknown> = {
    yesPercent: prediction.yesPercent,
    noPercent: prediction.noPercent,
    agent: prediction.agent,
    salt: prediction.salt,
  };
  if (prediction.options && prediction.options.length > 0) {
    payloadObj.options = prediction.options;
  }
  const payload = JSON.stringify(payloadObj);
  const chainHash = network.chainHash.replace(/^0x/, '');
  const url = `${network.httpClient}/${chainHash}`;
  const chain = new HttpCachingChain(url);
  const client = new HttpChainClient(chain);

  const ciphertext = await timelockEncrypt(
    Number(targetRound),
    new Uint8Array(new TextEncoder().encode(payload)),
    client
  );

  const base64 =
    typeof ciphertext === 'string'
      ? ciphertext
      : (typeof Buffer !== 'undefined'
          ? Buffer.from(ciphertext).toString('base64')
          : uint8ArrayToBase64(new Uint8Array(ciphertext)));

  return { ciphertext: base64 };
}

/** Convert ciphertext (base64 or ASCII-armor) to 0x-prefixed hex for contract */
export function ciphertextToHex(ciphertext: string): `0x${string}` {
  // Try base64 decode first (Node/ts path: binary was base64-encoded)
  try {
    const bin = atob(ciphertext.replace(/\s/g, ''));
    let hex = '';
    for (let i = 0; i < bin.length; i++) {
      hex += bin.charCodeAt(i).toString(16).padStart(2, '0');
    }
    return `0x${hex}` as `0x${string}`;
  } catch {
    // tlock-js in browser may return ASCII-armor string; contract expects UTF-8 bytes
    const bytes = new TextEncoder().encode(ciphertext);
    const hex = Array.from(bytes)
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
    return `0x${hex}` as `0x${string}`;
  }
}

export function computeValidationHashBasisPoints(
  prediction: PredictionPayloadBasisPoints
): `0x${string}` {
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

export function currentRound(network = DRAND_QUICKNET): bigint {
  const now = Math.floor(Date.now() / 1000);
  return BigInt(Math.floor((now - network.genesis) / network.period));
}
