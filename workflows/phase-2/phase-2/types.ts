// types.ts - Phase 2 (Plaintext Prediction Market) workflow types

import { z } from "zod";

const evmConfigSchema = z.object({
  chainSelectorName: z.string().min(1),
  marketAddress: z.string().regex(/^0x[a-fA-F0-9]{40}$/u),
  gasLimit: z.string().regex(/^\d+$/),
});

export const configSchema = z.object({
  schedule: z.string().default("0 */2 * * * *"),
  ponderUrl: z.string().min(1).default("http://127.0.0.1:42069"),
  evms: z.array(evmConfigSchema).min(1),
});

export type Config = z.infer<typeof configSchema>;

export type GeminiResponse = {
  statusCode: number;
  geminiResponse: string;
  responseId: string;
  rawJsonString: string;
};

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
  fallback: z
    .object({
      type: z.literal("ai"),
      provider: z.literal("gemini"),
      prompt: z.string(),
    })
    .optional(),
});

export type ResolutionSchema = z.infer<typeof resolutionSchema>;

export interface PonderMarket {
  id: string | number;
  phase: number;
  schemaURI?: string | null;
  question?: string;
  resolvedOutcome?: number | null;
  createdAt?: string | number;
  tradingDuration?: string | number;
}
