import "server-only";

import { type NextRequest } from "next/server";

import { AppError } from "@/types/api";

/**
 * Abuse-protection rate limiter for the PUBLIC intake write path (Epic 14, Story 14.7).
 *
 * The two public intake POST routes are unauthenticated, matcher-excluded from the
 * middleware, and otherwise unthrottled — a widely shared link lets a bot drive the
 * endpoint into a spam funnel. This module is the process-local, dependency-free token
 * bucket both routes invoke BEFORE resolving the form, so a flood is shed before any DB
 * read.
 *
 * Decisions (per spec):
 *   - Store = module-level `Map` of token buckets. Zero dependency/infrastructure,
 *     honoring the epic's "no infrastructure changes" rule. Per-instance on serverless:
 *     it throttles a sustained single-source flood on a warm instance but is NOT globally
 *     consistent — the honeypot (in `submit.ts`) is the primary defense and this is
 *     defense-in-depth. The map is bounded (hard entry cap + eviction of expired/oldest)
 *     so a distinct-IP flood cannot grow memory without bound.
 *   - FAIL OPEN: these are non-blocking defenses (Epic 6's rule). Any unexpected error in
 *     the limiter lets the request through — legitimate capture is never dropped by
 *     machinery failure — and is NOT reported to Sentry (an expected/benign decision).
 */

/** One token bucket: current tokens and the ms timestamp they were last refilled. */
type Bucket = { tokens: number; updatedAt: number };

/**
 * Process-local bucket store. Module-level so it survives across requests on a warm
 * instance; `const` so the identity is stable (never reassigned, only mutated).
 */
const buckets = new Map<string, Bucket>();

/**
 * Hard cap on distinct bucket keys. A distinct-IP/slug flood would otherwise grow the
 * map without bound; when the cap is hit we evict expired entries first, then the oldest,
 * so memory stays bounded. Generous enough that legitimate traffic never trips eviction.
 */
const MAX_ENTRIES = 10_000;

/** Per-IP bucket: 20 tokens, refilling 20 over 60s. Deliberately generous. */
const IP_CAPACITY = 20;
const IP_REFILL_PER_MS = 20 / 60_000;

/** Per-slug bucket: 60 tokens, refilling 60 over 60s. Deliberately generous. */
const SLUG_CAPACITY = 60;
const SLUG_REFILL_PER_MS = 60 / 60_000;

/**
 * Evict to keep the map bounded. Called only when the map is at the cap and a NEW key is
 * about to be inserted. Drops every fully-refilled (idle long enough to be back at
 * capacity) bucket first — those carry no useful state — and, if that frees nothing,
 * drops the single oldest-touched entry so there is always room for the newcomer.
 */
function evictIfSaturated(now: number): void {
  if (buckets.size < MAX_ENTRIES) {
    return;
  }

  // First pass: drop stale buckets that have fully refilled to their per-IP capacity.
  // (We don't know a given key's capacity here; a bucket idle long enough to exceed the
  // largest capacity is unambiguously stale and safe to drop.)
  for (const [key, bucket] of buckets) {
    const refilled =
      bucket.tokens + (now - bucket.updatedAt) * SLUG_REFILL_PER_MS;
    if (refilled >= SLUG_CAPACITY) {
      buckets.delete(key);
    }
  }
  if (buckets.size < MAX_ENTRIES) {
    return;
  }

  // Second pass: still full of live buckets — evict the single oldest-touched entry.
  // `Map` preserves insertion order, but `updatedAt` is the true recency signal.
  let oldestKey: string | undefined;
  let oldestAt = Infinity;
  for (const [key, bucket] of buckets) {
    if (bucket.updatedAt < oldestAt) {
      oldestAt = bucket.updatedAt;
      oldestKey = key;
    }
  }
  if (oldestKey !== undefined) {
    buckets.delete(oldestKey);
  }
}

/**
 * Consume one token from the bucket at `key`, lazily refilling by elapsed time first.
 * Pure over the module `Map` (plus the injected `now`), so it is directly unit-testable.
 *
 * @returns `allowed` — whether a token was available (and consumed); `retryAfterSec` —
 *   whole seconds until the next token refills, when denied (0 when allowed).
 */
export function consumeToken(
  key: string,
  capacity: number,
  refillPerMs: number,
  now: number,
): { allowed: boolean; retryAfterSec: number } {
  const existing = buckets.get(key);

  // New key: start full, then consume one. Evict first so an insert can't exceed the cap.
  if (!existing) {
    evictIfSaturated(now);
    buckets.set(key, { tokens: capacity - 1, updatedAt: now });
    return { allowed: true, retryAfterSec: 0 };
  }

  // Lazy refill: add the tokens that have accrued since the last touch, capped at
  // `capacity`. `updatedAt` always advances to `now` so refill can't be double-counted.
  const refilled = Math.min(
    capacity,
    existing.tokens + (now - existing.updatedAt) * refillPerMs,
  );

  if (refilled >= 1) {
    existing.tokens = refilled - 1;
    existing.updatedAt = now;
    return { allowed: true, retryAfterSec: 0 };
  }

  // Denied: no whole token available. Report how long until the next one refills.
  existing.tokens = refilled;
  existing.updatedAt = now;
  const retryAfterSec = Math.ceil((1 - refilled) / refillPerMs / 1000);
  return { allowed: false, retryAfterSec };
}

/**
 * Best-effort client IP: the first hop of `x-forwarded-for` (the original client, before
 * proxies append), else `x-real-ip`, else a shared `"unknown"` sentinel. An absent header
 * must never 500 — a request with no resolvable IP still throttles (against the shared
 * `"unknown"` bucket) and still resolves.
 */
export function getClientIp(req: NextRequest): string {
  const forwarded = req.headers.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) {
      return first;
    }
  }
  const real = req.headers.get("x-real-ip")?.trim();
  if (real) {
    return real;
  }
  return "unknown";
}

/**
 * Enforce the intake rate limit for one POST, over TWO independent buckets: per-IP
 * (`ip:{ip}`) and per-slug (`slug:{slugKey}`). Either exhausted ⇒ `AppError(429,
 * "tooManyRequests")`, which `handleError` returns verbatim (a 429 is <500, never
 * Sentry-logged). The two keys are exhausted independently.
 *
 * FAILS OPEN: the whole body is wrapped so any unexpected error (other than the
 * deliberate 429) lets the request proceed — a limiter bug must never drop a legitimate
 * submission. The benign throttle decision is not reported to Sentry.
 *
 * `now` is injectable so tests can advance time deterministically; it defaults to
 * `Date.now()` in production.
 */
export function enforceIntakeRateLimit(
  req: NextRequest,
  slugKey: string,
  now: number = Date.now(),
): void {
  try {
    const ip = getClientIp(req);

    // Check the per-IP bucket FIRST and reject before touching the per-slug bucket: an
    // IP-rejected request must not debit the shared per-slug token (else a single-IP
    // flood, already blocked on its own IP, would keep the per-slug bucket drained and
    // lock out legitimate visitors of that slug). The two keys stay independent — an
    // exhausted IP never costs the slug a token.
    const ipResult = consumeToken(
      `ip:${ip}`,
      IP_CAPACITY,
      IP_REFILL_PER_MS,
      now,
    );
    if (!ipResult.allowed) {
      throw new AppError(429, "tooManyRequests");
    }

    const slugResult = consumeToken(
      `slug:${slugKey}`,
      SLUG_CAPACITY,
      SLUG_REFILL_PER_MS,
      now,
    );
    if (!slugResult.allowed) {
      throw new AppError(429, "tooManyRequests");
    }
  } catch (err) {
    // The 429 is the one intended throw — re-raise it so the route rejects the flood.
    if (err instanceof AppError && err.statusCode === 429) {
      throw err;
    }
    // Anything else is an unexpected limiter fault: fail open (allow) and stay silent.
  }
}
