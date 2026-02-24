// types.ts
// Type definitions and schemas for the MiniMarket CRE workflow.

import { z } from "zod";

/*********************************
 * Configuration Schemas
 *********************************/

const drandNetworkSchema = z.object({
  chainHash: z.string().startsWith("0x"),
  genesis: z.number().positive(),
  period: z.number().positive(),
  httpClient: z.string().min(1),
});

const evmConfigSchema = z.object({
  chainSelectorName: z.string().min(1),
  marketAddress: z.string().regex(/^0x[a-fA-F0-9]{40}$/u, "marketAddress must be a valid address"),
  gasLimit: z.string().regex(/^\d+$/, "gasLimit must be a numeric string"),
});

export const configSchema = z.object({
  geminiModel: z.string(),
  drandNetwork: drandNetworkSchema,
  evms: z.array(evmConfigSchema).min(1, "At least one EVM config is required"),
});

export type Config = z.infer<typeof configSchema>;

/*********************************
 * Drand Types
 *********************************/

export interface DrandBeacon {
  round: bigint;
  signature: string;
  randomness: string;
  previous_signature: string;
}

/** Basis points for yes/no (1000 = 100%) */
export const BASIS_POINTS = 1000n;

export interface DecryptedSubmission {
  agent: `0x${string}`;
  yesPercent: bigint;  // 0-1000
  noPercent: bigint;   // 0-1000, must equal 1000 - yesPercent
  salt: string;
  validationHash: `0x${string}`;
  isConsensus: boolean;
  yesShares: bigint;
  noShares: bigint;
}

/*********************************
 * Gemini API Types
 *********************************/

export type GeminiResponse = {
  statusCode: number;
  geminiResponse: string;
  responseId: string;
  rawJsonString: string;
};

export const GeminiResponseSchema = z.object({
  result: z.enum(["YES", "NO", "INCONCLUSIVE"]),
  confidence: z.number().int().min(0).max(10_000),
});

export type LLMResult = z.infer<typeof GeminiResponseSchema>;

export interface GeminiData {
  system_instruction: {
    parts: { text: string }[];
  };
  tools: any[];
  contents: {
    parts: { text: string }[];
  }[];
}

/*********************************
 * Schema Resolution Types
 *********************************/

export const resolutionSchemaType = z.enum(["price", "sports", "weather", "ai", "custom"]);

export const resolutionSourceSchema = z.object({
  type: z.enum(["api", "chainlink", "web"]),
  url: z.string().optional(),
  jsonPath: z.string().optional(),
  transform: z.string().optional(),
  address: z.string().optional(),
  chain: z.string().optional(),
});

export const resolutionSchema = z.object({
  version: z.string(),
  type: resolutionSchemaType,
  description: z.string().optional(),
  deadline: z.number(),
  resolution: z.object({
    type: z.string(),
    sources: z.array(resolutionSourceSchema),
    comparator: z.enum([">", "<", "==", ">=", "<="]).optional(),
    targetValue: z.string(),
  }),
  fallback: z.object({
    type: z.literal("ai"),
    provider: z.literal("gemini"),
    prompt: z.string(),
  }).optional(),
});

export type ResolutionSchema = z.infer<typeof resolutionSchema>;

/*********************************
 * Log Details
 *********************************/

export interface LogDetails {
  marketId: string;
  question: string;
  schemaURI: string;
}

/*********************************
 * Reveal Result
 *********************************/

export interface RevealResult {
  merkleRoot: `0x${string}`;
  consensusOutcome: 1 | 2;
  totalReserveYes: bigint;
  totalReserveNo: bigint;
  validSubmissions: bigint;
  leaves: DecryptedSubmission[];
}

/*********************************
 * Resolution Result
 *********************************/

export type ResolutionStatus = "YES" | "NO" | "NOT_YET" | "INCONCLUSIVE";

export interface ResolutionResult {
  marketId: bigint;
  outcome: ResolutionStatus;
  confidence: number;
  evidenceURI: string;
}
