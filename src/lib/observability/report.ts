import "server-only";

/**
 * Thin server-only observability seam (Story 1.4, FR45).
 *
 * The generation pipeline must log every validator rejection and unexpected
 * failure with enough context to debug (org/session id + the raw LLM output),
 * WITHOUT leaking any of it to the client (that contract is enforced at the
 * route boundary).
 *
 * Full Sentry wiring (instrumentation.ts, sentry.*.config, source maps) is out
 * of scope for this story. This seam degrades gracefully:
 *   - when a Sentry DSN is configured, it best-effort forwards to `@sentry/nextjs`
 *     `captureException` / `captureMessage` (lazy dynamic import so the SDK is
 *     never pulled in — nor required to be initialized — when no DSN is set);
 *   - otherwise (and always in CI/tests, where no DSN exists) it falls back to
 *     `console.error`.
 *
 * Both entry points are fire-and-forget and never throw: an observability
 * failure must not break generation.
 */

/** Structured context attached to every report. Values must be non-sensitive. */
export type ReportContext = Record<string, unknown>;

function sentryDsnConfigured(): boolean {
  return Boolean(
    process.env.SENTRY_DSN || process.env.NEXT_PUBLIC_SENTRY_DSN,
  );
}

/**
 * Best-effort load of `@sentry/nextjs`. Returns `null` when the package is
 * unavailable or not initializable so callers fall back to console. The import
 * is wrapped so a missing/mis-wired Sentry never surfaces as a thrown error.
 */
async function loadSentry(): Promise<typeof import("@sentry/nextjs") | null> {
  try {
    return await import("@sentry/nextjs");
  } catch {
    return null;
  }
}

/** Report an unexpected error (timeout, parse failure, provisioning error). */
export function reportError(err: unknown, context: ReportContext = {}): void {
  if (sentryDsnConfigured()) {
    void loadSentry().then((sentry) => {
      if (sentry) {
        sentry.captureException(err, { extra: context });
      } else {
        console.error("[observability] reportError", err, context);
      }
    });
    return;
  }
  console.error("[observability] reportError", err, context);
}

/**
 * Report a Schema Validator rejection. `context` carries the org/session id and
 * the raw LLM output (FR45) — server-side only, never returned to the client.
 */
export function reportRejection(reason: string, context: ReportContext = {}): void {
  if (sentryDsnConfigured()) {
    void loadSentry().then((sentry) => {
      if (sentry) {
        sentry.captureMessage(`Schema validator rejection: ${reason}`, {
          level: "warning",
          extra: context,
        });
      } else {
        console.error("[observability] reportRejection", reason, context);
      }
    });
    return;
  }
  console.error("[observability] reportRejection", reason, context);
}
