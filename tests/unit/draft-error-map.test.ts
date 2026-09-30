import { describe, expect, it } from "vitest";

import {
  BASE_ERROR_KEYS,
  mapErrorCode,
} from "@/components/invoices/use-draft-form";

/**
 * Unit coverage for the shared draft error-code mapping (retro A3). This is the pure
 * core of the hook's `resolveError` — extracted so the "unknown error code falls back
 * to genericError" matrix row is covered by a real test (the hook itself is not
 * unit-testable in the repo's node/no-jsdom env). `translate` is an echo so we can
 * assert exactly which short key was resolved.
 */

const echo = (key: string) => key;
const invoiceKeys = new Set<string>([...BASE_ERROR_KEYS, "dateInvalid"]);
const creditNoteKeys = new Set<string>([
  ...BASE_ERROR_KEYS,
  "creditExceedsInvoice",
  "notIssued",
]);

describe("mapErrorCode", () => {
  it("resolves a known base code to its own message", () => {
    expect(mapErrorCode("versionConflict", invoiceKeys, echo)).toBe(
      "versionConflict",
    );
  });

  it("resolves each form's extra codes", () => {
    expect(mapErrorCode("dateInvalid", invoiceKeys, echo)).toBe("dateInvalid");
    expect(mapErrorCode("creditExceedsInvoice", creditNoteKeys, echo)).toBe(
      "creditExceedsInvoice",
    );
    expect(mapErrorCode("notIssued", creditNoteKeys, echo)).toBe("notIssued");
  });

  it("falls back to genericError for an unknown code", () => {
    expect(mapErrorCode("somethingWeNeverMapped", invoiceKeys, echo)).toBe(
      "genericError",
    );
  });

  it("falls back to genericError for a null code", () => {
    expect(mapErrorCode(null, invoiceKeys, echo)).toBe("genericError");
  });

  it("does not resolve one form's extra code under the other form's key set", () => {
    // A credit-note-only code is unknown to the invoice key set -> generic.
    expect(mapErrorCode("creditExceedsInvoice", invoiceKeys, echo)).toBe(
      "genericError",
    );
  });
});
