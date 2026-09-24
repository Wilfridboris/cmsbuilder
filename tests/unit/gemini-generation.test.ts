import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Unit coverage for the generation pipeline mechanics (Story 1.4) WITHOUT a live
 * LLM or DB. The `@google/genai` SDK is mocked so `callGeminiWithTimeout` never
 * hits the network. Covers: the hardened single-call contract (model, system
 * instruction, JSON mime + responseSchema on 100% of calls), the 15s timeout
 * race, JSON parsing, the retry-once-then-fail loop shape, and the
 * prompt-inflation / response-schema shape (language-detection instruction,
 * Ontario/trade context, no `relation` type).
 */

// Shared spy the mock's generateContent delegates to, swappable per test.
const generateContent = vi.fn();

vi.mock("@google/genai", () => ({
  // `Type` is used by prompts.ts to build the responseSchema.
  Type: {
    OBJECT: "OBJECT",
    ARRAY: "ARRAY",
    STRING: "STRING",
    NUMBER: "NUMBER",
    BOOLEAN: "BOOLEAN",
  },
  GoogleGenAI: class {
    models = {
      generateContent: (...args: unknown[]) => generateContent(...args),
    };
  },
}));

beforeEach(() => {
  generateContent.mockReset();
  process.env.GEMINI_API_KEY = "test-key";
});

afterEach(() => {
  vi.useRealTimers();
});

describe("callGeminiWithTimeout — single-call contract", () => {
  it("issues ONE gemini-2.0-flash call with the hardened system prompt + JSON schema", async () => {
    const { callGeminiWithTimeout } = await import("@/lib/gemini/client");
    const { HARDENED_SYSTEM_PROMPT } = await import("@/lib/gemini/prompts");

    generateContent.mockResolvedValue({ text: JSON.stringify({ ok: true }) });

    const schema = { type: "OBJECT" };
    const out = await callGeminiWithTimeout<{ ok: boolean }>("hello", schema);

    expect(out).toEqual({ ok: true });
    expect(generateContent).toHaveBeenCalledTimes(1);
    const arg = generateContent.mock.calls[0][0] as {
      model: string;
      contents: string;
      config: {
        systemInstruction: string;
        responseMimeType: string;
        responseSchema: unknown;
        abortSignal: unknown;
      };
    };
    expect(arg.model).toBe("gemini-2.0-flash");
    expect(arg.contents).toBe("hello");
    expect(arg.config.systemInstruction).toBe(HARDENED_SYSTEM_PROMPT);
    expect(arg.config.responseMimeType).toBe("application/json");
    expect(arg.config.responseSchema).toBe(schema);
    expect(arg.config.abortSignal).toBeInstanceOf(AbortSignal);
  });

  it("throws on invalid JSON in the response text", async () => {
    const { callGeminiWithTimeout } = await import("@/lib/gemini/client");
    generateContent.mockResolvedValue({ text: "not json{" });
    await expect(callGeminiWithTimeout("x", {})).rejects.toThrow();
  });

  it("rejects at the timeout wall when the SDK hangs past the budget", async () => {
    vi.useFakeTimers();
    const { callGeminiWithTimeout } = await import("@/lib/gemini/client");

    // A generate call that never resolves — the race must reject via setTimeout.
    generateContent.mockImplementation(() => new Promise(() => {}));

    const promise = callGeminiWithTimeout("x", {}, 15000);
    const assertion = expect(promise).rejects.toThrow(/timeout/i);
    await vi.advanceTimersByTimeAsync(15000);
    await assertion;
  });
});

describe("retry-once-then-fail loop shape", () => {
  // Mirrors the route's attemptGeneration retry contract at the client level:
  // the caller invokes exactly twice, then gives up.
  async function runWithRetryOnce(): Promise<{ attempts: number; failed: boolean }> {
    const { callGeminiWithTimeout } = await import("@/lib/gemini/client");
    let attempts = 0;
    const attempt = async () => {
      attempts += 1;
      return callGeminiWithTimeout("x", {});
    };
    try {
      await attempt();
    } catch {
      try {
        await attempt();
      } catch {
        return { attempts, failed: true };
      }
    }
    return { attempts, failed: false };
  }

  it("retries exactly once then fails on two consecutive failures", async () => {
    generateContent.mockRejectedValue(new Error("boom"));
    const { attempts, failed } = await runWithRetryOnce();
    expect(attempts).toBe(2);
    expect(failed).toBe(true);
  });

  it("succeeds on the second attempt without a third call", async () => {
    generateContent
      .mockRejectedValueOnce(new Error("boom"))
      .mockResolvedValueOnce({ text: JSON.stringify({ ok: 1 }) });
    const { attempts, failed } = await runWithRetryOnce();
    expect(attempts).toBe(2);
    expect(failed).toBe(false);
  });
});

describe("prompt inflation + response schema shape", () => {
  it("embeds Ontario/trade context and the language-detection instruction", async () => {
    const { buildGenerationPrompt } = await import("@/lib/gemini/prompts");
    const prompt = buildGenerationPrompt({
      tradeType: "hvac",
      city: "Barrie",
      whatYouTrack: "jobs, quotes, clients",
      submittedLocale: "en",
    });
    expect(prompt).toContain("Barrie");
    expect(prompt).toContain("Ontario");
    expect(prompt).toContain("HVAC");
    expect(prompt).toContain("jobs, quotes, clients");
    // FR35: language detected from the description, independent of UI locale.
    expect(prompt.toLowerCase()).toContain("detect the language");
    // Reserved keys and relation fields are forbidden in the prompt itself.
    expect(prompt).toContain("organization_id");
    expect(prompt.toLowerCase()).toContain("relationship");
  });

  it("preserves a French free-text description verbatim so output localizes to French", async () => {
    const { buildGenerationPrompt } = await import("@/lib/gemini/prompts");
    const prompt = buildGenerationPrompt({
      tradeType: "plumbing",
      city: "Ottawa",
      whatYouTrack: "les travaux, les devis et les factures impayées",
      submittedLocale: "en", // UI locale EN, description FR — output must be FR
    });
    expect(prompt).toContain("les travaux, les devis et les factures impayées");
  });

  it("offers only the MVP field-type set — never relation", async () => {
    const { GENERATION_FIELD_TYPES, GENERATION_RESPONSE_SCHEMA } = await import(
      "@/lib/gemini/prompts"
    );
    expect(GENERATION_FIELD_TYPES).not.toContain("relation");
    const json = JSON.stringify(GENERATION_RESPONSE_SCHEMA);
    expect(json).not.toContain("relation");
    // The schema constrains field type to the enum.
    expect(json).toContain("currency");
    expect(json).toContain("seedRows");
  });
});
