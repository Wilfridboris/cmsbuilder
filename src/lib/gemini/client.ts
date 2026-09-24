import "server-only";

import { GoogleGenAI } from "@google/genai";

import { HARDENED_SYSTEM_PROMPT } from "@/lib/gemini/prompts";

/**
 * The single LLM entry point (Story 1.4) — reused by later epics (import,
 * conversational editor). Server-only: `GEMINI_API_KEY` must never enter a
 * client bundle.
 *
 * Contract (architecture.md — Gemini API Call Pattern):
 *   - exactly ONE structured `gemini-2.0-flash` call;
 *   - `systemInstruction: HARDENED_SYSTEM_PROMPT` on 100% of calls (NFR-S5);
 *   - `responseMimeType: 'application/json'` + a caller-supplied `responseSchema`;
 *   - a hard 15s wall via `Promise.race` against a `setTimeout` reject, AND an
 *     `AbortSignal` passed to the SDK. Belt-and-suspenders: the race guarantees
 *     the caller resolves even if the SDK hangs past the abort; the abort lets
 *     the SDK stop work when it honors the signal. The timer is always cleared.
 *   - `JSON.parse` of the response text.
 *
 * A single shared client is instantiated lazily on first call so importing this
 * module never throws at build time when `GEMINI_API_KEY` is absent (the route
 * is dynamic; the key is only needed at request time). Retry-once and validation
 * live in the caller (`/api/generate`), keeping this a pure single-call seam.
 */

let sharedClient: GoogleGenAI | null = null;

function getClient(): GoogleGenAI {
  if (!sharedClient) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new Error("Missing GEMINI_API_KEY for the Gemini client.");
    }
    sharedClient = new GoogleGenAI({ apiKey });
  }
  return sharedClient;
}

// `gemini-2.0-flash` (pinned by the original spec) was retired by Google; the
// live API now returns 404 and recommends this model. See spec ratification note.
export const GEMINI_MODEL = "gemini-3.8-flash";

export async function callGeminiWithTimeout<T>(
  userPrompt: string,
  responseSchema: object,
  timeoutMs = 15000,
): Promise<T> {
  const ai = getClient();
  const controller = new AbortController();

  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutHandle = setTimeout(() => {
      controller.abort();
      reject(new Error("Gemini timeout"));
    }, timeoutMs);
  });

  const generatePromise = ai.models.generateContent({
    model: GEMINI_MODEL,
    contents: userPrompt,
    config: {
      systemInstruction: HARDENED_SYSTEM_PROMPT,
      responseMimeType: "application/json",
      responseSchema,
      abortSignal: controller.signal,
    },
  });

  try {
    const result = await Promise.race([generatePromise, timeoutPromise]);
    return JSON.parse(result.text ?? "") as T;
  } finally {
    if (timeoutHandle) {
      clearTimeout(timeoutHandle);
    }
  }
}
