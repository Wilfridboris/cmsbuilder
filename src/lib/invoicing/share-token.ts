import "server-only";

import { randomBytes } from "node:crypto";

/**
 * Share-token minter (Invariant I4) — shared by the invoice and credit-note issue paths
 * (retro [A1], extracted from the two byte-identical copies in the mutation layers).
 *
 * A share token is a 128-bit base62url secret: 22 base62 chars (~131 bits of entropy)
 * from a cryptographically secure source, minted ONCE in the issue transaction and never
 * rotated. No `+`/`/`/`=`, so it is URL-safe for the public `/i/[token]` route.
 */

/** The base62url alphabet for the share token (fixed alphabet, Invariant I4). */
const BASE62 =
  "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";

/** Largest multiple of 62 that fits in a byte (62 * 4). Bytes >= this are rejected. */
const BASE62_REJECT = 248;

/**
 * Mint a 128-bit base62url share token (Invariant I4). Each character is chosen by
 * REJECTION SAMPLING: a random byte is drawn and any byte >= 248 (the largest multiple of
 * 62 under 256) is discarded before `% 62`, so every base62 symbol is equally likely (no
 * modulo bias) and the 22 chars carry their full uniform keyspace.
 */
export function mintShareToken(): string {
  let out = "";
  while (out.length < 22) {
    // Draw a small pool at a time; discard biased bytes (>= 248) and map the rest.
    for (const b of randomBytes(32)) {
      if (b >= BASE62_REJECT) {
        continue;
      }
      out += BASE62[b % 62];
      if (out.length === 22) {
        break;
      }
    }
  }
  return out;
}
