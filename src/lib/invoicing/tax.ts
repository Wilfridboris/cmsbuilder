/**
 * Canonical invoice money math (Epic 12, Invariant I2).
 *
 * This module is the SINGLE source of every invoice amount computation. Story
 * 12.2 seeds it with only `computeLineAmount` (line `amount = round(quantity ×
 * unit_price, 2)`); Story 12.3 EXTENDS this same file with the subtotal, tax
 * total, and total helpers (and the shared HST/registration predicate). Nothing
 * anywhere re-implements a line amount — the DB stores what this returns, and the
 * 12.4 issuance gate calls the same function to verify equality.
 *
 * Pure and dependency-free so it unit-tests in the node env and can be imported
 * from both server (the mutation layer) and client (a draft's running subtotal).
 */

/**
 * Round a monetary value to 2 decimal places using half-away-from-zero rounding
 * (standard commercial rounding), guarding against binary floating-point drift
 * (e.g. `1.005` must round to `1.01`, not `1.00`). Scales to cents, nudges by a
 * tiny epsilon in the value's direction to counter the representational error,
 * rounds, then scales back.
 */
function roundMoney(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  const scaled = value * 100;
  // Epsilon nudge (relative to magnitude) so a value that is mathematically at a
  // .5 cent boundary but stored just below it (e.g. 100.49999999) still rounds up.
  const nudged = scaled + (scaled >= 0 ? 1 : -1) * Number.EPSILON * Math.abs(scaled);
  return Math.round(nudged) / 100;
}

/**
 * The ONE canonical line-amount computation (Invariant I2): `round(quantity ×
 * unit_price, 2)`. This is the only place a line amount is ever computed — the DB
 * stores the result, and Story 12.3's subtotal/total build on it rather than a
 * second implementation.
 *
 * Inputs are expected to be finite non-negative numbers (the Zod schema rejects
 * non-numeric / negative values upstream before this is ever called on a write).
 * A non-finite input degrades to `0` rather than propagating `NaN`.
 */
export function computeLineAmount(quantity: number, unitPrice: number): number {
  if (!Number.isFinite(quantity) || !Number.isFinite(unitPrice)) {
    return 0;
  }
  return roundMoney(quantity * unitPrice);
}
