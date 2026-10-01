import { describe, expect, it } from "vitest";

import { isReadOnly, assertWritable } from "@/lib/billing/access";
import { AppError } from "@/types/api";

/**
 * Unit coverage for the read-only write gate predicate (Story 7.4). Pins the
 * I/O & Edge-Case Matrix's writable-vs-non-writable rows:
 *   - read_only                         → non-writable;
 *   - trial, expiry <= now              → non-writable (expired trial == read-only);
 *   - trial, expiry > now               → writable;
 *   - trial, null expiry                → writable (pre-claim / clock not started);
 *   - active / past_due                 → writable (past_due is mid-dunning, NFR-R4);
 * and that `assertWritable` throws AppError(403,"readOnly") only when non-writable.
 */

const NOW = new Date("2026-09-30T12:00:00.000Z");
const PAST = new Date("2026-09-29T12:00:00.000Z").toISOString();
const FUTURE = new Date("2026-10-05T12:00:00.000Z").toISOString();

describe("isReadOnly", () => {
  it("read_only is non-writable regardless of expiry", () => {
    expect(isReadOnly("read_only", null, NOW)).toBe(true);
    expect(isReadOnly("read_only", FUTURE, NOW)).toBe(true);
  });

  it("an expired trial is non-writable (expired == read-only on the fly)", () => {
    expect(isReadOnly("trial", PAST, NOW)).toBe(true);
  });

  it("a trial whose expiry equals now is non-writable (boundary, <=)", () => {
    expect(isReadOnly("trial", NOW.toISOString(), NOW)).toBe(true);
  });

  it("a non-expired trial is writable", () => {
    expect(isReadOnly("trial", FUTURE, NOW)).toBe(false);
  });

  it("a trial with a null expiry is writable (clock not started / pre-claim)", () => {
    expect(isReadOnly("trial", null, NOW)).toBe(false);
  });

  it("active and past_due are writable (past_due is mid-dunning, NFR-R4)", () => {
    expect(isReadOnly("active", null, NOW)).toBe(false);
    expect(isReadOnly("active", PAST, NOW)).toBe(false);
    expect(isReadOnly("past_due", null, NOW)).toBe(false);
    expect(isReadOnly("past_due", PAST, NOW)).toBe(false);
  });

  it("defaults `now` to the current time when omitted", () => {
    // A far-future expiry is always writable; a far-past one never is.
    expect(isReadOnly("trial", "2999-01-01T00:00:00.000Z")).toBe(false);
    expect(isReadOnly("trial", "2000-01-01T00:00:00.000Z")).toBe(true);
  });
});

describe("assertWritable", () => {
  it("throws AppError(403, readOnly) for a read_only org", () => {
    try {
      assertWritable({ subscription_status: "read_only", trial_expires_at: null });
      throw new Error("expected throw");
    } catch (err) {
      expect(err).toBeInstanceOf(AppError);
      expect((err as AppError).statusCode).toBe(403);
      expect((err as AppError).userMessage).toBe("readOnly");
    }
  });

  it("throws for an expired trial", () => {
    expect(() =>
      assertWritable({ subscription_status: "trial", trial_expires_at: "2000-01-01T00:00:00.000Z" }),
    ).toThrow(AppError);
  });

  it("does not throw for a writable state (active)", () => {
    expect(() =>
      assertWritable({ subscription_status: "active", trial_expires_at: null }),
    ).not.toThrow();
  });

  it("does not throw for a non-expired trial", () => {
    expect(() =>
      assertWritable({ subscription_status: "trial", trial_expires_at: "2999-01-01T00:00:00.000Z" }),
    ).not.toThrow();
  });
});
