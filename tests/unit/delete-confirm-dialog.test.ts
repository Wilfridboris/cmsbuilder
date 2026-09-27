import { describe, expect, it } from "vitest";

import {
  deleteReferenceState,
  type DeleteReferenceState,
} from "@/components/dashboard/DeleteConfirmDialog";
import { REFERENCE_COUNT_CAP } from "@/lib/data/records";

/**
 * Coverage for the Story 3.8 safe-delete warning's state selection
 * (`deleteReferenceState`). The dialog body renders inside a Radix portal that
 * only mounts client-side, so under the repo's `node` test env its markup is not
 * reachable via `renderToStaticMarkup`; the branch decision is therefore pinned
 * through the pure exported helper (the same seam pattern as `clampTableIndex`).
 * Locks: loading/error precedence over the count, null/zero → nothing, positive
 * → warning, and the cap flag at `REFERENCE_COUNT_CAP`.
 */

describe("deleteReferenceState", () => {
  it("loading takes precedence over any count", () => {
    expect(deleteReferenceState(5, true, false)).toEqual({ kind: "loading" });
    // Loading wins even if an error flag is also set.
    expect(deleteReferenceState(null, true, true)).toEqual({ kind: "loading" });
  });

  it("error shows the neutral fallback when not loading", () => {
    expect(deleteReferenceState(null, false, true)).toEqual({ kind: "error" });
    expect(deleteReferenceState(3, false, true)).toEqual({ kind: "error" });
  });

  it("null or zero count shows nothing extra", () => {
    expect(deleteReferenceState(null, false, false)).toEqual({ kind: "none" });
    expect(deleteReferenceState(0, false, false)).toEqual({ kind: "none" });
  });

  it("a positive count warns, uncapped below the cap", () => {
    const state: DeleteReferenceState = deleteReferenceState(4, false, false);
    expect(state).toEqual({ kind: "warning", count: 4, capped: false });
  });

  it("marks capped once the count reaches REFERENCE_COUNT_CAP", () => {
    expect(deleteReferenceState(REFERENCE_COUNT_CAP, false, false)).toEqual({
      kind: "warning",
      count: REFERENCE_COUNT_CAP,
      capped: true,
    });
  });
});
