import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Signed anonymous-session cookie (Story 1.4).
 *
 * `/api/generate` is the pre-account path — there is no auth. To read a
 * provisioned org back (and to be idempotent per session: re-POSTing reuses the
 * same org rather than minting another), the org/session id is carried in a
 * signed, httpOnly cookie. The signature is an HMAC over the org id keyed by
 * `GENERATE_SESSION_SECRET`, so a client cannot forge or tamper with it to reach
 * another org's data. This is not encryption — the org id is an opaque UUID and
 * carries nothing sensitive; the signature only guarantees integrity.
 */

export const SESSION_COOKIE_NAME = "sb_gen_session";

/** Cookie lifetime — ephemeral pre-claim orgs; a later TTL/cleanup story reaps them. */
export const SESSION_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24; // 24h

function secret(): string {
  const value = process.env.GENERATE_SESSION_SECRET;
  if (!value) {
    throw new Error("Missing GENERATE_SESSION_SECRET for the session cookie.");
  }
  return value;
}

function sign(orgId: string): string {
  return createHmac("sha256", secret()).update(orgId).digest("base64url");
}

/** Serialize an org id into a signed cookie value: `<orgId>.<sig>`. */
export function encodeSessionValue(orgId: string): string {
  return `${orgId}.${sign(orgId)}`;
}

/**
 * Verify a signed cookie value and return the org id, or `null` if absent,
 * malformed, or the signature does not match. Never throws on bad input.
 */
export function decodeSessionValue(value: string | undefined): string | null {
  if (!value) {
    return null;
  }
  const sep = value.lastIndexOf(".");
  if (sep <= 0) {
    return null;
  }
  const orgId = value.slice(0, sep);
  const providedSig = value.slice(sep + 1);

  let expectedSig: string;
  try {
    expectedSig = sign(orgId);
  } catch {
    return null;
  }

  const a = Buffer.from(providedSig);
  const b = Buffer.from(expectedSig);
  if (a.length !== b.length) {
    return null;
  }
  return timingSafeEqual(a, b) ? orgId : null;
}
