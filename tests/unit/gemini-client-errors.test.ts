import { describe, expect, it } from "vitest";

import { isModelNotFoundError } from "@/lib/gemini/client";

/**
 * Unit coverage for the pure `isModelNotFoundError` classifier (epic-1 retro
 * item 2, FR45). It must positively identify a retired/unresolvable Gemini model
 * error — a numeric `404` status/code, or a not-found-model message — and return
 * `false` for everything it cannot (timeout, validator rejection, unknown, null),
 * so only a genuine model retirement escalates to a paging `reportCritical` and
 * no transient failure ever false-pages. Pure: no SDK, no network.
 */

describe("isModelNotFoundError", () => {
  it("returns true for a numeric 404 on `status`", () => {
    expect(
      isModelNotFoundError({
        status: 404,
        message: "models/gemini-3.8-flash is not found for API version v1beta",
      }),
    ).toBe(true);
  });

  it("returns true for a numeric 404 on `code`", () => {
    expect(
      isModelNotFoundError({ code: 404, message: "Not Found" }),
    ).toBe(true);
  });

  it("returns true for a stringified 404 status/code", () => {
    expect(isModelNotFoundError({ status: "404" })).toBe(true);
    expect(isModelNotFoundError({ code: "404" })).toBe(true);
  });

  it("returns true for a message-only model-not-found (no numeric status)", () => {
    expect(
      isModelNotFoundError(
        new Error(
          "models/gemini-3.8-flash is not found for API version v1beta, or is not supported",
        ),
      ),
    ).toBe(true);
  });

  it("returns true for a loosely-worded model not found message", () => {
    expect(
      isModelNotFoundError(new Error("The requested model was not found")),
    ).toBe(true);
  });

  it("returns false for a timeout (stays ordinary reportError)", () => {
    expect(isModelNotFoundError(new Error("Gemini timeout"))).toBe(false);
  });

  it("returns false for a validator rejection (AppError 422 shape)", () => {
    expect(
      isModelNotFoundError({
        name: "AppError",
        statusCode: 422,
        message: "schema validation rejected",
      }),
    ).toBe(false);
  });

  it("returns false for an unrelated not-found message with no model term", () => {
    expect(
      isModelNotFoundError(new Error("resource not found")),
    ).toBe(false);
  });

  it("returns false for an unknown error", () => {
    expect(isModelNotFoundError(new Error("boom"))).toBe(false);
  });

  it("returns false for a non-404 numeric status", () => {
    expect(
      isModelNotFoundError({ status: 500, message: "internal error" }),
    ).toBe(false);
  });

  it("returns false for null / undefined / primitives", () => {
    expect(isModelNotFoundError(null)).toBe(false);
    expect(isModelNotFoundError(undefined)).toBe(false);
    expect(isModelNotFoundError("404 not found model")).toBe(false);
    expect(isModelNotFoundError(404)).toBe(false);
  });
});
