import { describe, expect, it } from "vitest";

import {
  isReadOnly,
  isOffboarding,
  isDeleted,
  assertWritable,
} from "@/lib/billing/access";
import { AppError } from "@/types/api";

/**
 * Unit coverage for the Story 8.5 additions to the access predicates:
 *   - `isReadOnly` is true for the terminal `deleted` tombstone (non-writable);
 *   - `assertWritable` throws readOnly for a `deleted` org;
 *   - `isOffboarding` is true only when the grace clock started and the purge has
 *     not run (distinguishing a cancellation from a trial-expiry/dunning read_only);
 *   - `isDeleted` flags the tombstone.
 */

const NOW = new Date("2026-10-06T12:00:00.000Z");

describe("isReadOnly — deleted (Story 8.5)", () => {
  it("deleted is non-writable regardless of expiry", () => {
    expect(isReadOnly("deleted", null, NOW)).toBe(true);
    expect(isReadOnly("deleted", "2999-01-01T00:00:00.000Z", NOW)).toBe(true);
  });

  it("read_only remains non-writable (unchanged)", () => {
    expect(isReadOnly("read_only", null, NOW)).toBe(true);
  });

  it("active / past_due remain writable (unchanged)", () => {
    expect(isReadOnly("active", null, NOW)).toBe(false);
    expect(isReadOnly("past_due", null, NOW)).toBe(false);
  });
});

describe("assertWritable — deleted", () => {
  it("throws AppError(403, readOnly) for a deleted org", () => {
    try {
      assertWritable({ subscription_status: "deleted", trial_expires_at: null });
      throw new Error("expected throw");
    } catch (err) {
      expect(err).toBeInstanceOf(AppError);
      expect((err as AppError).statusCode).toBe(403);
      expect((err as AppError).userMessage).toBe("readOnly");
    }
  });
});

describe("isOffboarding", () => {
  it("true when the grace clock started and the purge has not run", () => {
    expect(
      isOffboarding({
        offboarding_initiated_at: "2026-10-01T00:00:00.000Z",
        offboarding_purged_at: null,
      }),
    ).toBe(true);
  });

  it("false before any cancellation (no initiated stamp — plain read_only/trial)", () => {
    expect(
      isOffboarding({
        offboarding_initiated_at: null,
        offboarding_purged_at: null,
      }),
    ).toBe(false);
  });

  it("false after the Day-30 purge (initiated set, but purged)", () => {
    expect(
      isOffboarding({
        offboarding_initiated_at: "2026-09-01T00:00:00.000Z",
        offboarding_purged_at: "2026-10-01T00:00:00.000Z",
      }),
    ).toBe(false);
  });
});

describe("isDeleted", () => {
  it("true only for the deleted tombstone", () => {
    expect(isDeleted("deleted")).toBe(true);
    expect(isDeleted("read_only")).toBe(false);
    expect(isDeleted("active")).toBe(false);
    expect(isDeleted("trial")).toBe(false);
    expect(isDeleted("past_due")).toBe(false);
  });
});
