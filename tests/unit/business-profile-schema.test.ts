import { describe, expect, it } from "vitest";

import { AppError } from "@/types/api";
import {
  putBodySchema,
  getQuerySchema,
  toWritableProfile,
  ENTITY_TYPES,
  PROFILE_LANGUAGES,
} from "@/app/api/business-profile/schemas";
import {
  validateLogo,
  logoObjectKey,
  MAX_LOGO_BYTES,
} from "@/lib/storage/logo";

/**
 * Pure validation coverage for Story 12.1's Business Profile (no HTTP harness):
 * the PUT body Zod schema (required legal name, GST/HST number ↔ effective-date
 * pairing, entity-type + language enums, blank-collapsing), the writable-column
 * mapper, and the server-side logo validator (PNG/JPEG only, ≤ 2 MB). These lock
 * the frozen matrix rows that live in the schema/validator rather than the route.
 */

/** Shorthand: parse a PUT body and return `{ success, data?, firstMessage? }`. */
function parseBody(input: Record<string, unknown>) {
  const result = putBodySchema.safeParse(input);
  return {
    success: result.success,
    data: result.success ? result.data : undefined,
    firstMessage: result.success ? undefined : result.error.issues[0]?.message,
  };
}

const VALID_MIN = { slug: "acme", legalName: "Acme Inc." };

describe("putBodySchema — required + defaults", () => {
  it("accepts a minimal body (legal name only) and defaults language to 'en'", () => {
    const { success, data } = parseBody(VALID_MIN);
    expect(success).toBe(true);
    expect(data?.legalName).toBe("Acme Inc.");
    expect(data?.defaultLanguage).toBe("en");
    // Absent optionals stay undefined so the row stores NULL.
    expect(data?.operatingName).toBeUndefined();
    expect(data?.gstHstNumber).toBeUndefined();
  });

  it("rejects a blank legal name with the legalNameRequired KEY", () => {
    const { success, firstMessage } = parseBody({ slug: "acme", legalName: "   " });
    expect(success).toBe(false);
    expect(firstMessage).toBe("BusinessProfile.error.legalNameRequired");
  });

  it("trims free text and collapses an empty string to undefined", () => {
    const { data } = parseBody({
      ...VALID_MIN,
      operatingName: "  Maple Leaf  ",
      jurisdiction: "   ",
    });
    expect(data?.operatingName).toBe("Maple Leaf");
    expect(data?.jurisdiction).toBeUndefined();
  });
});

describe("putBodySchema — GST/HST registration pairing", () => {
  it("accepts both empty (unregistered)", () => {
    expect(parseBody(VALID_MIN).success).toBe(true);
  });

  it("accepts a number together with a valid effective date", () => {
    const { success, data } = parseBody({
      ...VALID_MIN,
      gstHstNumber: "123456789 RT0001",
      gstHstEffectiveDate: "2024-01-01",
    });
    expect(success).toBe(true);
    expect(data?.gstHstNumber).toBe("123456789 RT0001");
    expect(data?.gstHstEffectiveDate).toBe("2024-01-01");
  });

  it("rejects a number without a date with the pairing KEY", () => {
    const { success, firstMessage } = parseBody({
      ...VALID_MIN,
      gstHstNumber: "123456789 RT0001",
    });
    expect(success).toBe(false);
    expect(firstMessage).toBe("BusinessProfile.error.registrationPairRequired");
  });

  it("rejects a date without a number with the pairing KEY", () => {
    const { success, firstMessage } = parseBody({
      ...VALID_MIN,
      gstHstEffectiveDate: "2024-01-01",
    });
    expect(success).toBe(false);
    expect(firstMessage).toBe("BusinessProfile.error.registrationPairRequired");
  });

  it("rejects a malformed effective date", () => {
    const { success, firstMessage } = parseBody({
      ...VALID_MIN,
      gstHstNumber: "123456789 RT0001",
      gstHstEffectiveDate: "not-a-date",
    });
    expect(success).toBe(false);
    expect(firstMessage).toBe("BusinessProfile.error.registrationPairRequired");
  });

  it("rejects a format-valid but impossible calendar date (no DB 500)", () => {
    for (const bad of ["2024-13-45", "2024-02-30", "2024-00-10"]) {
      const { success, firstMessage } = parseBody({
        ...VALID_MIN,
        gstHstNumber: "123456789 RT0001",
        gstHstEffectiveDate: bad,
      });
      expect(success).toBe(false);
      expect(firstMessage).toBe(
        "BusinessProfile.error.registrationPairRequired",
      );
    }
  });
});

describe("putBodySchema — constrained vocabularies", () => {
  it("accepts every entity type in the shared vocabulary", () => {
    for (const entityType of ENTITY_TYPES) {
      const { success, data } = parseBody({ ...VALID_MIN, entityType });
      expect(success).toBe(true);
      expect(data?.entityType).toBe(entityType);
    }
  });

  it("rejects an entity type outside the vocabulary", () => {
    expect(parseBody({ ...VALID_MIN, entityType: "llc" }).success).toBe(false);
  });

  it("accepts every language in the shared vocabulary and rejects others", () => {
    for (const defaultLanguage of PROFILE_LANGUAGES) {
      expect(parseBody({ ...VALID_MIN, defaultLanguage }).success).toBe(true);
    }
    expect(parseBody({ ...VALID_MIN, defaultLanguage: "es" }).success).toBe(false);
  });
});

describe("getQuerySchema", () => {
  it("requires a non-empty slug", () => {
    expect(getQuerySchema.safeParse({ slug: "acme" }).success).toBe(true);
    expect(getQuerySchema.safeParse({ slug: "" }).success).toBe(false);
    expect(getQuerySchema.safeParse({ slug: null }).success).toBe(false);
  });
});

describe("toWritableProfile", () => {
  it("maps a minimal body to columns, absent optionals becoming null", () => {
    const parsed = putBodySchema.parse(VALID_MIN);
    const writable = toWritableProfile(parsed);
    expect(writable.legal_name).toBe("Acme Inc.");
    expect(writable.default_language).toBe("en");
    expect(writable.operating_name).toBeNull();
    expect(writable.gst_hst_number).toBeNull();
    expect(writable.gst_hst_effective_date).toBeNull();
    expect(writable.payment_etransfer_email).toBeNull();
  });

  it("carries the structured payment instructions through", () => {
    const parsed = putBodySchema.parse({
      ...VALID_MIN,
      paymentInstructions: {
        etransferEmail: "pay@acme.ca",
        chequePayableTo: "Acme Inc.",
        chequeAddress: "1 King St",
        cardLink: "https://pay.acme.ca",
      },
    });
    const writable = toWritableProfile(parsed);
    expect(writable.payment_etransfer_email).toBe("pay@acme.ca");
    expect(writable.payment_cheque_payable_to).toBe("Acme Inc.");
    expect(writable.payment_cheque_address).toBe("1 King St");
    expect(writable.payment_card_link).toBe("https://pay.acme.ca");
  });
});

/** Read the AppError code thrown by a call, or fail if it did not throw. */
function thrownCode(fn: () => unknown): { statusCode: number; code: string } {
  try {
    fn();
  } catch (err) {
    if (err instanceof AppError) {
      return { statusCode: err.statusCode, code: err.userMessage };
    }
    throw err;
  }
  throw new Error("expected the call to throw");
}

describe("validateLogo", () => {
  const fakeFile = (type: string, size: number) =>
    ({ type, size, name: "logo" }) as unknown as File;

  it("accepts a PNG and returns the png extension", () => {
    expect(validateLogo(fakeFile("image/png", 1024))).toEqual({ extension: "png" });
  });

  it("accepts a JPEG and returns the jpg extension", () => {
    expect(validateLogo(fakeFile("image/jpeg", 1024))).toEqual({ extension: "jpg" });
  });

  it("rejects an SVG with logoInvalid (400)", () => {
    const { statusCode, code } = thrownCode(() =>
      validateLogo(fakeFile("image/svg+xml", 1024)),
    );
    expect(statusCode).toBe(400);
    expect(code).toBe("BusinessProfile.error.logoInvalid");
  });

  it("rejects an empty file with logoInvalid (400)", () => {
    expect(thrownCode(() => validateLogo(fakeFile("image/png", 0))).code).toBe(
      "BusinessProfile.error.logoInvalid",
    );
  });

  it("rejects an over-size image with logoInvalid (413)", () => {
    const { statusCode, code } = thrownCode(() =>
      validateLogo(fakeFile("image/png", MAX_LOGO_BYTES + 1)),
    );
    expect(statusCode).toBe(413);
    expect(code).toBe("BusinessProfile.error.logoInvalid");
  });

  it("lays out the object key under the org prefix", () => {
    expect(logoObjectKey("org-1", "png")).toBe("org-1/logo.png");
  });
});
