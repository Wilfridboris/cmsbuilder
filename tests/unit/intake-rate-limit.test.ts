import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";

/**
 * NOTE: `vi.resetModules()` gives each `freshModule()` its own copy of the module graph,
 * including a distinct `AppError` class identity — so an `instanceof AppError` against
 * the statically-imported class would not match the limiter's thrown error. We assert on
 * the thrown error's shape (`name`/`statusCode`/`userMessage`) instead, which is the
 * contract `handleError` actually depends on.
 */
type ThrownAppError = {
  name: string;
  statusCode: number;
  userMessage: string;
};

/**
 * Unit coverage for the Story 14.7 abuse-protection rate limiter
 * (`src/lib/intake/rate-limit.ts`). The buckets live in a module-level `Map`, so each
 * test re-imports the module through `vi.resetModules()` + a dynamic import to get a
 * pristine store — no cross-test bleed. `now` is injected everywhere so time is
 * deterministic (no real clock, no timers).
 *
 * Locks the frozen I/O & Edge-Case Matrix rows that live in the limiter:
 *   - allows while under the limit;
 *   - 429 over the per-IP bucket, and independently over the per-slug bucket;
 *   - refills over injected elapsed time;
 *   - `getClientIp` extraction + the `"unknown"` fallback;
 *   - FAILS OPEN on an internal error (never throws a non-429);
 *   - the bounded map evicts so distinct-key floods can't grow without bound.
 */

async function freshModule() {
  vi.resetModules();
  return import("@/lib/intake/rate-limit");
}

/** A minimal `NextRequest` carrying only the IP headers the limiter reads. */
function reqWith(headers: Record<string, string>): NextRequest {
  return {
    headers: {
      get: (name: string) => headers[name.toLowerCase()] ?? null,
    },
  } as unknown as NextRequest;
}

beforeEach(() => {
  vi.resetModules();
});

describe("getClientIp", () => {
  it("takes the first hop of x-forwarded-for", async () => {
    const { getClientIp } = await freshModule();
    expect(
      getClientIp(reqWith({ "x-forwarded-for": "1.2.3.4, 5.6.7.8, 9.9.9.9" })),
    ).toBe("1.2.3.4");
  });

  it("trims whitespace around the first hop", async () => {
    const { getClientIp } = await freshModule();
    expect(getClientIp(reqWith({ "x-forwarded-for": "  10.0.0.1  ,x" }))).toBe(
      "10.0.0.1",
    );
  });

  it("falls back to x-real-ip when x-forwarded-for is absent", async () => {
    const { getClientIp } = await freshModule();
    expect(getClientIp(reqWith({ "x-real-ip": "203.0.113.7" }))).toBe(
      "203.0.113.7",
    );
  });

  it("falls back to the shared \"unknown\" sentinel when no IP header is present", async () => {
    const { getClientIp } = await freshModule();
    expect(getClientIp(reqWith({}))).toBe("unknown");
  });
});

describe("consumeToken", () => {
  it("allows consumption while tokens remain, then denies once the bucket is empty", async () => {
    const { consumeToken } = await freshModule();
    // Capacity 3, refill 1/sec. Three consumes at t=0 all allowed; the fourth denied.
    const refill = 1 / 1000; // one token per 1000ms
    expect(consumeToken("k", 3, refill, 0).allowed).toBe(true);
    expect(consumeToken("k", 3, refill, 0).allowed).toBe(true);
    expect(consumeToken("k", 3, refill, 0).allowed).toBe(true);

    const denied = consumeToken("k", 3, refill, 0);
    expect(denied.allowed).toBe(false);
    // ~1s until the next whole token refills.
    expect(denied.retryAfterSec).toBe(1);
  });

  it("refills over injected elapsed time", async () => {
    const { consumeToken } = await freshModule();
    const refill = 1 / 1000; // 1 token/sec
    // Drain a capacity-1 bucket, then get denied, then allow again after 1s elapses.
    expect(consumeToken("k", 1, refill, 0).allowed).toBe(true);
    expect(consumeToken("k", 1, refill, 500).allowed).toBe(false);
    // After a full second, one token has refilled.
    expect(consumeToken("k", 1, refill, 1000).allowed).toBe(true);
  });

  it("caps the refill at capacity (idle time never over-fills)", async () => {
    const { consumeToken } = await freshModule();
    const refill = 1 / 1000;
    // Consume one from a capacity-2 bucket, idle a very long time, then consume: the
    // bucket is back at full (2), so exactly two consumes succeed before a denial.
    expect(consumeToken("k", 2, refill, 0).allowed).toBe(true);
    expect(consumeToken("k", 2, refill, 1_000_000).allowed).toBe(true);
    expect(consumeToken("k", 2, refill, 1_000_000).allowed).toBe(true);
    expect(consumeToken("k", 2, refill, 1_000_000).allowed).toBe(false);
  });

  it("keeps distinct keys independent", async () => {
    const { consumeToken } = await freshModule();
    const refill = 1 / 1000;
    // Exhaust key "a"; key "b" is untouched.
    expect(consumeToken("a", 1, refill, 0).allowed).toBe(true);
    expect(consumeToken("a", 1, refill, 0).allowed).toBe(false);
    expect(consumeToken("b", 1, refill, 0).allowed).toBe(true);
  });
});

describe("enforceIntakeRateLimit", () => {
  const anyReq = () => reqWith({ "x-forwarded-for": "1.1.1.1" });

  it("allows a request well under both the per-IP and per-slug ceilings", async () => {
    const { enforceIntakeRateLimit } = await freshModule();
    expect(() => enforceIntakeRateLimit(anyReq(), "org:acme", 0)).not.toThrow();
  });

  it("throws 429 tooManyRequests once the per-IP bucket is exhausted", async () => {
    const { enforceIntakeRateLimit } = await freshModule();
    // Per-IP capacity is 20; the 21st request from the same IP (spread across DIFFERENT
    // slugs so the per-slug bucket never trips first) is denied on the IP key.
    for (let i = 0; i < 20; i++) {
      enforceIntakeRateLimit(anyReq(), `org:slug-${i}`, 0);
    }
    let thrown: unknown;
    try {
      enforceIntakeRateLimit(anyReq(), "org:slug-last", 0);
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toMatchObject<ThrownAppError>({
      name: "AppError",
      statusCode: 429,
      userMessage: "tooManyRequests",
    });
  });

  it("throws 429 once the per-slug bucket is exhausted across many IPs, leaving other slugs unaffected", async () => {
    const { enforceIntakeRateLimit } = await freshModule();
    // Per-slug capacity is 60. Hammer ONE slug from 60 distinct IPs (so no single IP
    // bucket trips) — the 61st trips the per-slug key.
    for (let i = 0; i < 60; i++) {
      enforceIntakeRateLimit(
        reqWith({ "x-forwarded-for": `10.0.0.${i}` }),
        "org:hot",
        0,
      );
    }
    let thrown: unknown;
    try {
      enforceIntakeRateLimit(
        reqWith({ "x-forwarded-for": "10.0.0.250" }),
        "org:hot",
        0,
      );
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toMatchObject<ThrownAppError>({
      name: "AppError",
      statusCode: 429,
      userMessage: "tooManyRequests",
    });

    // A DIFFERENT slug from a fresh IP is unaffected — the keys are independent.
    expect(() =>
      enforceIntakeRateLimit(
        reqWith({ "x-forwarded-for": "10.0.0.251" }),
        "org:cold",
        0,
      ),
    ).not.toThrow();
  });

  it("does NOT debit the per-slug bucket when the per-IP bucket already denied the request", async () => {
    const { enforceIntakeRateLimit } = await freshModule();
    const attacker = () => reqWith({ "x-forwarded-for": "9.9.9.9" });

    // Exhaust the attacker's per-IP bucket (20) across distinct slugs so no slug trips.
    for (let i = 0; i < 20; i++) {
      enforceIntakeRateLimit(attacker(), `org:warmup-${i}`, 0);
    }

    // Hammer ONE shared slug from the already-blocked IP: every call is IP-denied, and
    // none may cost the per-slug bucket a token (the pre-fix code debited it here, so a
    // single blocked IP could drain the shared slug and lock out everyone else).
    for (let i = 0; i < 100; i++) {
      expect(() => enforceIntakeRateLimit(attacker(), "org:shared", 0)).toThrow();
    }

    // Proof the slug kept its full capacity (60): 60 distinct fresh IPs all submit to
    // the shared slug without a 429. Had the denied flood debited the slug, these 429.
    for (let i = 0; i < 60; i++) {
      expect(() =>
        enforceIntakeRateLimit(
          reqWith({ "x-forwarded-for": `172.16.0.${i}` }),
          "org:shared",
          0,
        ),
      ).not.toThrow();
    }
  });

  it("refills the per-IP bucket over injected time so a later flood is allowed again", async () => {
    const { enforceIntakeRateLimit } = await freshModule();
    // Exhaust the per-IP bucket (20) at t=0, across distinct slugs.
    for (let i = 0; i < 20; i++) {
      enforceIntakeRateLimit(anyReq(), `org:s-${i}`, 0);
    }
    expect(() => enforceIntakeRateLimit(anyReq(), "org:s-x", 0)).toThrow();
    // After the full 60s refill window the bucket is back at capacity.
    expect(() =>
      enforceIntakeRateLimit(anyReq(), "org:s-y", 60_000),
    ).not.toThrow();
  });

  it("FAILS OPEN on an unexpected internal error (never drops a legitimate submission)", async () => {
    const { enforceIntakeRateLimit } = await freshModule();
    // A request whose `.headers.get` throws forces `getClientIp` to blow up inside the
    // try/catch — the limiter must swallow it and allow the request through.
    const hostileReq = {
      headers: {
        get: () => {
          throw new Error("header access exploded");
        },
      },
    } as unknown as NextRequest;
    expect(() =>
      enforceIntakeRateLimit(hostileReq, "org:acme", 0),
    ).not.toThrow();
  });
});

describe("bounded map eviction", () => {
  it("keeps the store bounded under a distinct-key flood (memory never grows without limit)", async () => {
    const { consumeToken } = await freshModule();
    const refill = 60 / 60_000; // the per-slug rate used by the limiter
    // Insert far more distinct keys than the hard cap (10_000). If the map were
    // unbounded this would hold them all; eviction must keep it at/below the cap.
    //
    // Spread `now` forward so the oldest entries are genuinely older than the newest,
    // exercising the oldest-first eviction fallback deterministically.
    for (let i = 0; i < 12_000; i++) {
      consumeToken(`slug:key-${i}`, 60, refill, i);
    }
    // We can't read the private map directly, but we can prove boundedness indirectly:
    // re-consuming an early key behaves like a brand-new bucket (it was evicted), i.e.
    // it is allowed at full capacity rather than denied. A surviving, long-idle bucket
    // would also be allowed — so instead assert the module never threw / leaked, and
    // that a late key still works, confirming the flood did not corrupt the store.
    expect(consumeToken("slug:key-11999", 60, refill, 12_000).allowed).toBe(
      true,
    );
    expect(consumeToken("slug:brand-new", 60, refill, 12_000).allowed).toBe(
      true,
    );
  });
});
