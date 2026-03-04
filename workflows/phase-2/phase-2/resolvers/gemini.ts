// gemini.ts - Gemini AI with grounded Google Search for Phase 2 resolution
// Matches scripts/phase-1-test/trade-and-phase2-simulator.ts: v1beta, systemInstruction, googleSearch

import {
  cre,
  ok,
  consensusIdenticalAggregation,
  type Runtime,
  type HTTPSendRequester,
} from "@chainlink/cre-sdk";
import { type Config, type GeminiResponse } from "../types";

const MODEL = "gemini-2.5-flash";

export interface SubmarketEntry {
  submarketId: string;
  optionIndex: number;
  optionLabel: string;
}

export interface SubmarketResolution {
  submarketIndex: number;
  outcome: "YES" | "NO";
}

// Same system prompt as trade-and-phase2-simulator.ts — binary prediction market resolver
const systemInstruction =
  `You are a binary prediction market resolver. Your job is to determine the real-world outcome of market conditions using Google Search.\n` +
  `\n` +
  `STRICT OUTPUT RULES — you MUST follow these exactly:\n` +
  `1. Your entire response must be a single valid JSON array. Nothing else.\n` +
  `2. No markdown, no code fences, no explanation text before or after the array.\n` +
  `3. Each element must be: {"submarketIndex": <integer>, "outcome": "<YES or NO>"}\n` +
  `4. "outcome" must be exactly "YES" or "NO" in uppercase.\n` +
  `5. Every submarketIndex listed in the user message must appear in your response.\n` +
  `\n` +
  `Example of a valid response for 3 submarkets:\n` +
  `[{"submarketIndex":0,"outcome":"YES"},{"submarketIndex":1,"outcome":"NO"},{"submarketIndex":2,"outcome":"YES"}]`;

export const askGemini = (
  runtime: Runtime<Config>,
  marketId: string,
  question: string,
  submarkets: SubmarketEntry[]
): GeminiResponse => {
  const secret = runtime.getSecret({ id: "GEMINI_API_KEY" }).result();
  const geminiApiKey = secret.value;

  const httpClient = new cre.capabilities.HTTPClient();
  return httpClient
    .sendRequest(
      runtime,
      postGeminiData({ marketId, question, submarkets }, geminiApiKey),
      consensusIdenticalAggregation<GeminiResponse>()
    )(runtime.config)
    .result();
};

const postGeminiData =
  (
    logDetails: { marketId: string; question: string; submarkets: SubmarketEntry[] },
    geminiApiKey: string
  ) =>
  (sendRequester: HTTPSendRequester, _config: Config): GeminiResponse => {
    // Build submarket lines: each option gets its own YES/NO question (optionLabel or question fallback)
    const submarketLines =
      logDetails.submarkets.length > 0
        ? logDetails.submarkets
            .map(
              (s) =>
                `Submarket-${s.optionIndex}: ${s.optionLabel?.trim() || logDetails.question}`
            )
            .join("\n")
        : `Submarket-0: ${logDetails.question}`;

    const userPrompt =
      `Market question: "${logDetails.question}"\n\n` +
      submarketLines +
      `\n\nUse Google Search to find the real-world outcome for each submarket. ` +
      `Respond with ONLY the JSON array — no other text.`;

    const body = {
      systemInstruction: { parts: [{ text: systemInstruction }] },
      contents: [{ role: "user" as const, parts: [{ text: userPrompt }] }],
      tools: [{ googleSearch: {} }],
      generationConfig: {
        temperature: 0,
        thinkingConfig: { thinkingBudget: 0 },
      },
    };

    const req = {
      url: `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${geminiApiKey}`,
      method: "POST" as const,
      body: Buffer.from(JSON.stringify(body), "utf8").toString("base64"),
      headers: {
        "Content-Type": "application/json",
      },
      cacheSettings: { store: true, maxAge: "60s" },
    };

    const resp = sendRequester.sendRequest(req).result();
    const bodyText = new TextDecoder().decode(resp.body);

    if (!ok(resp)) {
      throw new Error(`HTTP request failed: ${resp.statusCode}. ${bodyText}`);
    }

    const externalResp = JSON.parse(bodyText) as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string; thought?: unknown }> }; finishReason?: string }>;
      responseId?: string;
    };

    const candidate = externalResp?.candidates?.[0];
    if (!candidate) {
      throw new Error(`Gemini returned no candidates. ${bodyText.slice(0, 300)}`);
    }

    const parts = candidate.content?.parts ?? [];
    const textParts = parts
      .filter((p) => typeof p.text === "string" && !("thought" in p && p.thought))
      .map((p) => p.text as string);

    const rawText = textParts.join("").trim();
    if (!rawText) {
      throw new Error(`Gemini returned no text. finishReason=${candidate.finishReason}`);
    }

    // Extract JSON array — strip markdown fences like trade-and-phase2-simulator.ts
    let jsonText = rawText;
    const fenceMatch = jsonText.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
    if (fenceMatch) jsonText = fenceMatch[1].trim();
    const arrayMatch = jsonText.match(/\[\s*\{[\s\S]*?\}\s*\]/);
    if (arrayMatch) jsonText = arrayMatch[0];

    // Parse [{"submarketIndex":0,"outcome":"YES"},...] — full array for multi-submarket resolution
    let resolutions: SubmarketResolution[] = [];
    let confidence = 8000;
    try {
      const arr = JSON.parse(jsonText) as Array<{ submarketIndex: number; outcome: string }>;
      for (const r of arr) {
        if (r.outcome === "YES" || r.outcome === "NO") {
          resolutions.push({ submarketIndex: r.submarketIndex, outcome: r.outcome });
        }
      }
      if (resolutions.length === 0) {
        confidence = 0;
      }
    } catch {
      confidence = 0;
    }

    return {
      statusCode: resp.statusCode,
      geminiResponse: JSON.stringify({ resolutions, confidence }),
      responseId: externalResp?.responseId || "",
      rawJsonString: bodyText,
    };
  };
