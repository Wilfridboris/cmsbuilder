/**
 * Shared invoice / credit-note display formatters, extracted per retro [A1] so the
 * previously-duplicated helpers live in one place. Pure functions with no side effects.
 */

/** Coerce a PostgREST numeric-boundary value to a 2-decimal display string. */
export function money(value: number | string): string {
  const n = typeof value === "number" ? value : Number(value);
  return (Number.isFinite(n) ? n : 0).toFixed(2);
}

export function formatIssueDate(iso: string | null, locale: string): string {
  if (!iso) return "";
  const date = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleDateString(locale, {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

export function todayIso(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}
