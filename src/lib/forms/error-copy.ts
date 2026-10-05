/**
 * Shared Forms client error-copy resolver (Epic 14 retro, finding F4).
 *
 * Every Admin-facing Forms component turns a server error CODE (a frozen `Forms.error.*`
 * key or a shared code like `writeFailed`) into a non-technical, translated message, and
 * falls back to the generic message for any code the surface has no specific wording for —
 * so an unexpected code never reaches `next-intl` as a missing-message error. That
 * `code.replace(...).has(...) ? t(...) : t(generic)` logic was copy-pasted into five
 * components (`FormEditor`, `CreateFormDialog`, `FormsList`, `FormFieldsEditor`,
 * `FormPublishShare`); this is the single authority they now share. Each surface keeps its
 * own `allowedKeys` allowlist — the set of codes it has a specific message for — and passes
 * it in, so the per-surface copy stays precise.
 *
 * Pure and client-safe (no `server-only`, no data imports): it takes only a `next-intl`
 * translator bound to the `Forms` namespace and the raw code.
 *
 * @param t - a `next-intl` translator bound to the `Forms` namespace.
 * @param code - the raw server code; a leading `Forms.error.` prefix is stripped.
 * @param allowedKeys - the short codes this surface renders a specific message for.
 */
export function resolveFormError(
  t: (key: string) => string,
  code: string,
  allowedKeys: ReadonlySet<string>,
): string {
  const short = code.replace(/^Forms\.error\./, "");
  return allowedKeys.has(short) ? t(`error.${short}`) : t("error.genericError");
}
