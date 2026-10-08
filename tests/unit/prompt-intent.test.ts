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
 * Node-env unit coverage for the capture contract (Story 1.3, reshaped 15.1) —
 * the I/O-matrix mechanics that need no DOM. The schema factory is called with
 * an identity resolver `(k) => k` so assertions match on the returned
 * translation KEY, not localized text. The persistence seam is exercised against
 * an in-memory fake storage.
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
  businessName: "Joe's Plumbing",
  tradeType: "hvac",
  city: "Ottawa",
  description: "jobs, quotes, and unpaid invoices",
  explicitItems: "warranties",
} as const;

describe("createPromptIntentSchema — valid input", () => {
  it("parses a fully valid input into the typed values", () => {
    const result = schema.safeParse(validInput);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual(validInput);
    }
  });

  it("accepts a valid input WITHOUT the optional explicit-items field", () => {
    const { explicitItems: _omit, ...withoutItems } = validInput;
    void _omit;
    const result = schema.safeParse(withoutItems);
    expect(result.success).toBe(true);
  });

  it("accepts every fixed trade key", () => {
    for (const tradeType of TRADE_KEYS) {
      const result = schema.safeParse({ ...validInput, tradeType });
      expect(result.success).toBe(true);
    }
  });

  it("trims surrounding whitespace on name, city, and description", () => {
    const result = schema.safeParse({
      ...validInput,
      businessName: "  Joe's Plumbing  ",
      city: "  Ottawa  ",
      description: "  jobs and invoices  ",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.businessName).toBe("Joe's Plumbing");
      expect(result.data.city).toBe("Ottawa");
      expect(result.data.description).toBe("jobs and invoices");
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
  it("flags a missing business name", () => {
    const { businessName: _omit, ...rest } = validInput;
    void _omit;
    const result = schema.safeParse(rest);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(
        result.error.issues.some((i) => i.path[0] === "businessName"),
      ).toBe(true);
    }
  });

  it("flags an empty business name", () => {
    expectFieldError(
      { ...validInput, businessName: "" },
      "businessName",
      "validation.businessNameRequired",
    );
  });

  it("flags a missing trade type", () => {
    const { tradeType: _omit, ...rest } = validInput;
    void _omit;
    expectFieldError(rest, "tradeType", "validation.tradeRequired");
  });

  it("flags an empty city", () => {
    expectFieldError(
      { ...validInput, city: "" },
      "city",
      "validation.cityRequired",
    );
  });

  it("flags an empty description", () => {
    expectFieldError(
      { ...validInput, description: "" },
      "description",
      "validation.descriptionRequired",
    );
  });
});

describe("createPromptIntentSchema — whitespace-only fields", () => {
  it("treats a whitespace-only business name as empty", () => {
    expectFieldError(
      { ...validInput, businessName: "   " },
      "businessName",
      "validation.businessNameRequired",
    );
  });

  it("treats a whitespace-only city as empty", () => {
    expectFieldError(
      { ...validInput, city: "   " },
      "city",
      "validation.cityRequired",
    );
  });

  it("treats a whitespace-only description as empty", () => {
    expectFieldError(
      { ...validInput, description: "   " },
      "description",
      "validation.descriptionRequired",
    );
  });
});

describe("createPromptIntentSchema — over-length input", () => {
  it("rejects a business name over 80 characters", () => {
    expectFieldError(
      { ...validInput, businessName: "a".repeat(81) },
      "businessName",
      "validation.businessNameTooLong",
    );
  });

  it("rejects a city over 80 characters", () => {
    expectFieldError(
      { ...validInput, city: "a".repeat(81) },
      "city",
      "validation.cityTooLong",
    );
  });

  it("rejects a description over 280 characters", () => {
    expectFieldError(
      { ...validInput, description: "a".repeat(281) },
      "description",
      "validation.descriptionTooLong",
    );
  });

  it("rejects a too-short description", () => {
    expectFieldError(
      { ...validInput, description: "ab" },
      "description",
      "validation.descriptionRequired",
    );
  });

  it("rejects an explicit-items field over 280 characters", () => {
    expectFieldError(
      { ...validInput, explicitItems: "a".repeat(281) },
      "explicitItems",
      "validation.explicitItemsTooLong",
    );
  });
});

describe("saveIntent → readIntent round-trip", () => {
  const intent: GenerationIntent = {
    businessName: "Sudbury Service Co",
    tradeType: "plumbing",
    city: "Sudbury",
    description: "service calls and recurring maintenance",
    explicitItems: "equipment",
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

  it("returns null for a stale pre-15.1 stored payload (shape mismatch)", () => {
    // The old shape used `whatYouTrack` and had no `businessName`; it must fail
    // the revalidating parser so a stale intent degrades safely.
    const storage = fakeStorage({
      [INTENT_STORAGE_KEY]: JSON.stringify({
        tradeType: "hvac",
        city: "Ottawa",
        whatYouTrack: "jobs",
        submittedLocale: "en",
      }),
    });
    expect(readIntent(storage)).toBeNull();
  });

  it("returns null for a structurally invalid stored payload", () => {
    const storage = fakeStorage({
      [INTENT_STORAGE_KEY]: JSON.stringify({
        businessName: "X",
        tradeType: "not_a_real_trade",
        city: "Ottawa",
        description: "jobs",
        submittedLocale: "en",
      }),
    });
    expect(readIntent(storage)).toBeNull();
  });

  it("returns null for an out-of-range stored payload", () => {
    const storage = fakeStorage({
      [INTENT_STORAGE_KEY]: JSON.stringify({
        businessName: "X",
        tradeType: "hvac",
        city: "x".repeat(81),
        description: "jobs and invoices",
        submittedLocale: "en",
      }),
    });
    expect(readIntent(storage)).toBeNull();
  });
});
