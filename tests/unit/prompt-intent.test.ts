import { describe, expect, it } from "vitest";

import {
  INTENT_STORAGE_KEY,
  TRADE_KEYS,
  createPromptIntentSchema,
  readIntent,
  saveIntent,
  type GenerationIntent,
  type IntentStorage,
} from "@/lib/generation/intent";

/**
 * Node-env unit coverage for the Story 1.3 capture contract — the I/O-matrix
 * mechanics that need no DOM. The schema factory is called with an identity
 * resolver `(k) => k` so assertions match on the returned translation KEY, not
 * localized text (per the spec's "Translated Zod" note). The intent
 * persistence seam is exercised against an in-memory fake storage.
 */

// Identity resolver — the schema returns the raw translation key as the message.
const t = (key: string) => key;
const schema = createPromptIntentSchema(t);

/** In-memory `IntentStorage` fake standing in for `sessionStorage`. */
function fakeStorage(initial: Record<string, string> = {}): IntentStorage & {
  map: Map<string, string>;
} {
  const map = new Map<string, string>(Object.entries(initial));
  return {
    map,
    getItem: (k: string) => (map.has(k) ? (map.get(k) as string) : null),
    setItem: (k: string, v: string) => {
      map.set(k, v);
    },
  };
}

const validInput = {
  tradeType: "hvac",
  city: "Ottawa",
  whatYouTrack: "jobs, quotes, and unpaid invoices",
} as const;

describe("createPromptIntentSchema — valid input", () => {
  it("parses a fully valid input into the typed values", () => {
    const result = schema.safeParse(validInput);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual(validInput);
    }
  });

  it("accepts every fixed trade key", () => {
    for (const tradeType of TRADE_KEYS) {
      const result = schema.safeParse({ ...validInput, tradeType });
      expect(result.success).toBe(true);
    }
  });

  it("trims surrounding whitespace on city and whatYouTrack", () => {
    const result = schema.safeParse({
      ...validInput,
      city: "  Ottawa  ",
      whatYouTrack: "  jobs and invoices  ",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.city).toBe("Ottawa");
      expect(result.data.whatYouTrack).toBe("jobs and invoices");
    }
  });
});

/** Assert a single field failed with the expected translation-key message. */
function expectFieldError(
  input: Record<string, unknown>,
  field: string,
  messageKey: string,
) {
  const result = schema.safeParse(input);
  expect(result.success).toBe(false);
  if (!result.success) {
    const issue = result.error.issues.find((i) => i.path[0] === field);
    expect(issue, `expected an error on "${field}"`).toBeDefined();
    expect(issue?.message).toBe(messageKey);
  }
}

describe("createPromptIntentSchema — empty required fields", () => {
  it("flags a missing trade type", () => {
    expectFieldError(
      { city: "Ottawa", whatYouTrack: "jobs and invoices" },
      "tradeType",
      "validation.tradeRequired",
    );
  });

  it("flags an empty city", () => {
    expectFieldError(
      { ...validInput, city: "" },
      "city",
      "validation.cityRequired",
    );
  });

  it("flags an empty whatYouTrack", () => {
    expectFieldError(
      { ...validInput, whatYouTrack: "" },
      "whatYouTrack",
      "validation.trackRequired",
    );
  });
});

describe("createPromptIntentSchema — whitespace-only fields", () => {
  it("treats a whitespace-only city as empty", () => {
    expectFieldError(
      { ...validInput, city: "   " },
      "city",
      "validation.cityRequired",
    );
  });

  it("treats a whitespace-only whatYouTrack as empty", () => {
    expectFieldError(
      { ...validInput, whatYouTrack: "   " },
      "whatYouTrack",
      "validation.trackRequired",
    );
  });
});

describe("createPromptIntentSchema — over-length input", () => {
  it("rejects a city over 80 characters", () => {
    expectFieldError(
      { ...validInput, city: "a".repeat(81) },
      "city",
      "validation.cityTooLong",
    );
  });

  it("rejects a whatYouTrack over 280 characters", () => {
    expectFieldError(
      { ...validInput, whatYouTrack: "a".repeat(281) },
      "whatYouTrack",
      "validation.trackTooLong",
    );
  });

  it("rejects a too-short whatYouTrack", () => {
    expectFieldError(
      { ...validInput, whatYouTrack: "ab" },
      "whatYouTrack",
      "validation.trackRequired",
    );
  });
});

describe("saveIntent → readIntent round-trip", () => {
  const intent: GenerationIntent = {
    tradeType: "plumbing",
    city: "Sudbury",
    whatYouTrack: "service calls and recurring maintenance",
    submittedLocale: "fr",
  };

  it("persists and re-reads the exact payload", () => {
    const storage = fakeStorage();
    saveIntent(intent, storage);
    expect(storage.map.get(INTENT_STORAGE_KEY)).toBeDefined();
    expect(readIntent(storage)).toEqual(intent);
  });

  it("returns null when storage is absent (nothing persisted)", () => {
    expect(readIntent(fakeStorage())).toBeNull();
  });

  it("returns null for corrupt (non-JSON) storage without throwing", () => {
    const storage = fakeStorage({ [INTENT_STORAGE_KEY]: "{not valid json" });
    expect(readIntent(storage)).toBeNull();
  });

  it("returns null for a structurally invalid stored payload", () => {
    const storage = fakeStorage({
      [INTENT_STORAGE_KEY]: JSON.stringify({
        tradeType: "not_a_real_trade",
        city: "Ottawa",
        whatYouTrack: "jobs",
        submittedLocale: "en",
      }),
    });
    expect(readIntent(storage)).toBeNull();
  });

  it("returns null for an out-of-range stored payload", () => {
    const storage = fakeStorage({
      [INTENT_STORAGE_KEY]: JSON.stringify({
        tradeType: "hvac",
        city: "x".repeat(81),
        whatYouTrack: "jobs and invoices",
        submittedLocale: "en",
      }),
    });
    expect(readIntent(storage)).toBeNull();
  });
});
