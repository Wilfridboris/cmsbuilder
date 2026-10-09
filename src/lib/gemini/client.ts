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
 *   - a hard wall via `Promise.race` against a `setTimeout` reject, AND an
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

/**
 * Pure, tolerant classifier for a Gemini "model not found" / retired-model error
 * (epic-1 retro item 2, FR45). If `GEMINI_MODEL` is retired after deploy, the
 * live API returns 404 on every call and `/api/generate` degrades to the Story
 * 1.5 hard-fallback template for 100% of generations — a dead generative "aha"
 * that today is logged only at ordinary severity, indistinguishable from a
 * transient timeout. The route uses this to escalate ONLY this case to a paging
 * `reportCritical`; every other failure stays on ordinary `reportError`.
 *
 * Kept pure (no SDK, no network) so the decision is node-testable. The exact
 * `@google/genai` 404 shape is duck-typed: a numeric `404` on `status`/`code`,
 * OR a message indicating a not-found model. Returns `false` for anything it
 * cannot positively identify as model-not-found — a false negative merely keeps
 * the status-quo ordinary report; a false positive only pages on a rare
 * unrelated 404. Both are preferable to silently swallowing a dead pipeline.
 */
export function isModelNotFoundError(err: unknown): boolean {
  if (err === null || typeof err !== "object") {
    return false;
  }

  const record = err as Record<string, unknown>;

  // Numeric 404 on `status` or `code` (the SDK surfaces the HTTP status there).
  for (const key of ["status", "code"] as const) {
    const value = record[key];
    if (value === 404 || value === "404") {
      return true;
    }
  }

  // Message-only heuristic: a not-found phrasing that also mentions a model.
  const message = typeof record.message === "string" ? record.message : "";
  if (
    /not[\s_-]?found/i.test(message) &&
    /\bmodels?\b|models\//i.test(message)
  ) {
    return true;
  }

  return false;
}

/**
 * Default per-call wall. The original 15s (from the `gemini-2.0-flash` era) is far
 * too short for the live model: a full structured generation on `gemini-3.8-flash`
 * (hardened system prompt + `GENERATION_RESPONSE_SCHEMA` + 5-8 seed rows per table)
 * measures ~25-31s end to end — so EVERY `/api/generate` attempt aborted at exactly
 * 15s, both retries failed, and the route served the Story 1.5 fallback template for
 * 100% of generations (observed in prod: a single `Gemini timeout` error cluster,
 * never a model-404 or missing-key error). 45s clears the measured worst case with
 * margin. Disabling model "thinking" does NOT help (it saves <1s); the latency is the
 * size of the structured output, so a longer wall is the fix. Callers that retry once
 * must size their route `maxDuration` to cover 2x this (see `/api/generate`).
 */
export const DEFAULT_GEMINI_TIMEOUT_MS = 45000;

export async function callGeminiWithTimeout<T>(
  userPrompt: string,
  responseSchema: object,
  timeoutMs = DEFAULT_GEMINI_TIMEOUT_MS,
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
