import { describe, expect, it } from "vitest";

import { AppError } from "@/types/api";
import {
  assertRecordNotEmpty,
  isBlankValue,
} from "@/lib/data/record-conformance";

/**
 * Unit coverage for the Story 3.10 non-empty validator (the first slice of the
 * server-side data-vs-schema conformance seam). Locks the I/O & Edge-Case
 * Matrix: `{}` / all-blank rejects; `false` and `0` are real values; one real
 * value among blanks accepts; and the thrown value is `AppError(400,
 * "emptyRecord")`.
 */

describe("isBlankValue", () => {
  it("treats null / undefined / empty / whitespace-only strings as blank", () => {
    expect(isBlankValue(null)).toBe(true);
    expect(isBlankValue(undefined)).toBe(true);
    expect(isBlankValue("")).toBe(true);
    expect(isBlankValue("   ")).toBe(true);
    expect(isBlankValue("\t\n ")).toBe(true);
  });

  it("treats boolean false, number 0, and non-empty strings as real values", () => {
    expect(isBlankValue(false)).toBe(false);
    expect(isBlankValue(true)).toBe(false);
    expect(isBlankValue(0)).toBe(false);
    expect(isBlankValue(1)).toBe(false);
    expect(isBlankValue("x")).toBe(false);
    expect(isBlankValue(" x ")).toBe(false);
  });
});

describe("assertRecordNotEmpty", () => {
  const expectRejected = (data: Record<string, unknown>) => {
    let thrown: unknown;
    try {
      assertRecordNotEmpty(data);
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(AppError);
    const err = thrown as AppError;
    expect(err.userMessage).toBe("emptyRecord");
    expect(err.statusCode).toBe(400);
  };

  it("rejects an empty object", () => {
    expectRejected({});
  });

  it("rejects an all-null / all-undefined record", () => {
    expectRejected({ a: null, b: undefined });
  });

  it("rejects an all-empty-string record", () => {
    expectRejected({ a: "", b: "" });
  });

  it("rejects a whitespace-only record", () => {
    expectRejected({ a: "   ", b: "\t\n" });
  });

  it("accepts a boolean false as a real value", () => {
    expect(() => assertRecordNotEmpty({ someBool: false })).not.toThrow();
  });

  it("accepts a number 0 as a real value", () => {
    expect(() => assertRecordNotEmpty({ qty: 0 })).not.toThrow();
  });

  it("accepts a non-empty string", () => {
    expect(() => assertRecordNotEmpty({ text: "x" })).not.toThrow();
  });

  it("accepts a record with one real value among blanks", () => {
    expect(() =>
      assertRecordNotEmpty({ a: "", b: null, c: "value", d: "   " }),
    ).not.toThrow();
  });
});
