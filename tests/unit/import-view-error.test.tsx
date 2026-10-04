import { describe, expect, it } from "vitest";
import type { useTranslations } from "next-intl";

import { resolveCommitError } from "@/components/import/ImportView";

/**
 * Story 13.6: the commit route composes the `selectValueInvalid` message
 * server-side (the string envelope can't carry next-intl params), so
 * `resolveCommitError` must show that composed sentence verbatim while still
 * translating known `Import.error.*` codes and falling back to generic copy for a
 * bare unknown token. A fake translator returns a tagged key so the test asserts
 * WHICH key was looked up without coupling to the shipped copy.
 */
const t = ((key: string) => `t:${key}`) as unknown as ReturnType<
  typeof useTranslations
>;

describe("resolveCommitError (Story 13.6 verbatim-vs-fallback branch)", () => {
  it("shows a composed server sentence (non-key, contains whitespace) verbatim", () => {
    const composed =
      'The column mapped to "Status" has values that are not valid options: shipped. Nothing was saved.';
    expect(resolveCommitError(composed, t)).toBe(composed);
  });

  it("falls back to generic commitFailed for a bare unknown token (no whitespace)", () => {
    expect(resolveCommitError("someUnknownCode", t)).toBe("t:error.commitFailed");
  });

  it("maps a prefixed known Import.error.<key> to its translated copy", () => {
    expect(resolveCommitError("Import.error.schemaChanged", t)).toBe(
      "t:error.schemaChanged",
    );
  });

  it("maps a bare known key to its translated copy", () => {
    expect(resolveCommitError("unresolvedColumns", t)).toBe(
      "t:error.unresolvedColumns",
    );
  });

  it("defaults a null code to commitFailed", () => {
    expect(resolveCommitError(null, t)).toBe("t:error.commitFailed");
  });
});
