import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { encodeSessionValue, decodeSessionValue } from "@/lib/generation/session";

/**
 * Unit coverage for the signed anonymous-session cookie (Story 1.4). This is the
 * anti-forgery boundary: an HMAC over the org id keyed by `GENERATE_SESSION_SECRET`,
 * verified with `timingSafeEqual`, is what stops a client tampering the cookie to
 * reach another session org's data. Covers round-trip integrity, tamper rejection,
 * malformed input, and safe behavior when the secret is absent.
 */

const ORG = "11111111-1111-1111-1111-111111111111";

beforeEach(() => {
  process.env.GENERATE_SESSION_SECRET = "unit-test-secret";
});

afterEach(() => {
  delete process.env.GENERATE_SESSION_SECRET;
});

describe("session cookie sign/verify", () => {
  it("round-trips a valid org id", () => {
    expect(decodeSessionValue(encodeSessionValue(ORG))).toBe(ORG);
  });

  it("rejects a tampered org id (signature no longer matches)", () => {
    const signed = encodeSessionValue(ORG);
    const sig = signed.slice(signed.lastIndexOf(".") + 1);
    const forged = `22222222-2222-2222-2222-222222222222.${sig}`;
    expect(decodeSessionValue(forged)).toBeNull();
  });

  it("rejects a tampered signature", () => {
    const signed = encodeSessionValue(ORG);
    const tampered = `${ORG}.deadbeef`;
    expect(tampered).not.toBe(signed);
    expect(decodeSessionValue(tampered)).toBeNull();
  });

  it("rejects malformed or empty input without throwing", () => {
    expect(decodeSessionValue(undefined)).toBeNull();
    expect(decodeSessionValue("")).toBeNull();
    expect(decodeSessionValue("no-dot")).toBeNull();
    expect(decodeSessionValue(".onlysig")).toBeNull();
    expect(decodeSessionValue(`${ORG}.`)).toBeNull();
  });

  it("does not verify under a different secret", () => {
    const signed = encodeSessionValue(ORG);
    process.env.GENERATE_SESSION_SECRET = "a-different-secret";
    expect(decodeSessionValue(signed)).toBeNull();
  });

  it("returns null (never throws) when the secret is absent", () => {
    const signed = encodeSessionValue(ORG);
    delete process.env.GENERATE_SESSION_SECRET;
    expect(() => decodeSessionValue(signed)).not.toThrow();
    expect(decodeSessionValue(signed)).toBeNull();
  });
});
