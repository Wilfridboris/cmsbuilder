/**
 * Shared typed cell formatter (Story 1.6).
 *
 * Extracted from the read-only `/generate` reveal (Story 1.4) so the demo
 * dashboard's list view and record-detail view render every scalar value
 * identically. Pure, framework-agnostic logic: it takes a resolver for the
 * three locale-dependent strings (`cellEmpty | cellYes | cellNo`, reused from
 * the existing `Generate.cell*` next-intl keys) so it stays free of any React /
 * next-intl import and can be unit-tested in the node env (no jsdom), per the
 * 1.3–1.5 precedent.
 *
 * `relation` is intentionally absent from the field-type union (never generated
 * or accepted — see the Schema Validator); it can never reach this formatter.
 */

import type { FieldDefinition } from "@/types/db";

/** The three locale-dependent strings the formatter needs, keyed by intent. */
export type CellStrings = {
  /** Shown for null / undefined / blank values (`Generate.cellEmpty`). */
  empty: string;
  /** Boolean true (`Generate.cellYes`). */
  yes: string;
  /** Boolean false (`Generate.cellNo`). */
  no: string;
};

/** CAD currency, Ontario locale — matches the seed data's currency. */
const CAD_FORMATTER = new Intl.NumberFormat("en-CA", {
  style: "currency",
  currency: "CAD",
});

// Date-only values ("2026-01-15") parse as UTC midnight; format them in UTC so
// the displayed calendar day matches the stored ISO date in negative-UTC zones
// (Ontario, UTC-5/-4 — the story's target), which would otherwise show the
// previous day. `datetime` stays local (real instants render correctly locally).
const DATE_FORMATTER = new Intl.DateTimeFormat("en-CA", {
  year: "numeric",
  month: "short",
  day: "numeric",
  timeZone: "UTC",
});

const DATETIME_FORMATTER = new Intl.DateTimeFormat("en-CA", {
  year: "numeric",
  month: "short",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

/**
 * Format one JSONB cell value for display, per its declared field type.
 *
 * Shared by the list (table/card) and the detail dialog so a value looks the
 * same in both places. Unknown / mistyped values fall back to `String(value)`
 * rather than throwing, so a stray shape from the seed data never breaks render.
 *
 * - `currency` → CAD (`$1,234.56`) when numeric, else raw text.
 * - `boolean`  → i18n yes/no.
 * - `date` / `datetime` → locale-formatted when parseable, else the raw string.
 * - `email` / `phone` / `text` / `number` → plain text (no linkification here).
 * - null / undefined / empty-string → the `empty` placeholder.
 */
export function formatCell(
  value: unknown,
  type: FieldDefinition["type"],
  strings: CellStrings,
): string {
  if (
    value === null ||
    value === undefined ||
    (typeof value === "string" && value.trim() === "")
  ) {
    return strings.empty;
  }

  if (type === "boolean") {
    return value ? strings.yes : strings.no;
  }

  if (type === "currency" && typeof value === "number") {
    return CAD_FORMATTER.format(value);
  }

  if (type === "date" || type === "datetime") {
    const parsed = new Date(value as string | number);
    if (!Number.isNaN(parsed.getTime())) {
      return (type === "date" ? DATE_FORMATTER : DATETIME_FORMATTER).format(
        parsed,
      );
    }
    // Unparseable date-ish value: show it verbatim rather than "Invalid Date".
    return String(value);
  }

  // text | number | email | phone, and any non-numeric currency fallthrough.
  return String(value);
}
