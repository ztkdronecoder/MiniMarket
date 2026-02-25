// types.ts - Phase 1 (Encrypted Infomarket) workflow types

import { z } from "zod";

const drandNetworkSchema = z.object({
  chainHash: z.string().startsWith("0x"),
  genesis: z.number().positive(),
  period: z.number().positive(),
  httpClient: z.string().min(1),
});

const evmConfigSchema = z.object({
  chainSelectorName: z.string().min(1),
  marketAddress: z.string().regex(/^0x[a-fA-F0-9]{40}$/u),
  gasLimit: z.string().regex(/^\d+$/),
});

export const configSchema = z.object({
  schedule: z.string().default("0 */2 * * * *"),
  ponderUrl: z.string().url().default("http://localhost:42069"),
  rpcUrl: z.string().url().optional(),
  drandNetwork: drandNetworkSchema,
  evms: z.array(evmConfigSchema).min(1),
});

export type Config = z.infer<typeof configSchema>;

export interface DrandBeacon {
  round: bigint;
  signature: string;
  randomness: string;
  previous_signature: string;
}

export interface DecryptedSubmission {
  agent: `0x${string}`;
  yesPercent: bigint;
  noPercent: bigint;
  salt: string;
  validationHash: `0x${string}`;
  isConsensus: boolean;
  yesShares: bigint;
  noShares: bigint;
}

export interface PonderMarket {
  id: string | number;
  phase: number;
  merkleRoot?: string | null;
  drandTargetRound: string | number;
  drandChainHash?: string | null;
  schemaURI?: string | null;
}

export interface PonderSubmission {
  id: string;
  marketId: string;
  agent: string;
  validationHash: string;
  targetRound: string;
}
