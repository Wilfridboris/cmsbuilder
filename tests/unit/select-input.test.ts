import { describe, expect, it } from "vitest";

import type { SelectOption } from "@/types/db";
import {
  SELECT_CLEAR_SENTINEL,
  fromDropdownValue,
  partitionSelectOptions,
  resolveSelectCommit,
  selectDraftToData,
} from "@/lib/forms/select-input";

/**
 * Story 13.2 — pure decision logic for the single-select edit controls. These
 * cover the I/O-matrix EDIT rows (add-form pick/blank, inline pick, clear,
 * reselect, dropdown option set) that the Radix `Select` portal makes awkward to
 * drive in jsdom, mirroring the `field-input.ts` coerce-helper split.
 */

const OPTIONS: SelectOption[] = [
  { value: "paid", label: "Paid" },
  { value: "unpaid", label: "Unpaid" },
  { value: "rejected", label: "Rejected", archived: true },
];

describe("partitionSelectOptions (dropdown option set)", () => {
  it("offers only non-archived options as selectable choices", () => {
    const { active } = partitionSelectOptions(OPTIONS, null);
    expect(active.map((o) => o.value)).toEqual(["paid", "unpaid"]);
  });

  it("surfaces the current value as archivedCurrent when it is archived", () => {
    const { active, archivedCurrent } = partitionSelectOptions(
      OPTIONS,
      "rejected",
    );
    // Archived current is shown (so the trigger renders its label) but is NOT
    // among the selectable active options.
    expect(archivedCurrent).toEqual({
      value: "rejected",
      label: "Rejected",
      archived: true,
    });
    expect(active.map((o) => o.value)).not.toContain("rejected");
  });

  it("has no archivedCurrent for an active or blank current value", () => {
    expect(partitionSelectOptions(OPTIONS, "paid").archivedCurrent).toBeUndefined();
    expect(partitionSelectOptions(OPTIONS, null).archivedCurrent).toBeUndefined();
    expect(partitionSelectOptions(OPTIONS, "").archivedCurrent).toBeUndefined();
  });
});

describe("fromDropdownValue (clear mapping)", () => {
  it("maps the clear sentinel to null and passes a real value through", () => {
    expect(fromDropdownValue(SELECT_CLEAR_SENTINEL)).toBeNull();
    expect(fromDropdownValue("unpaid")).toBe("unpaid");
  });
});

describe("resolveSelectCommit (inline pick / clear / reselect)", () => {
  it("writes a newly picked option", () => {
    expect(resolveSelectCommit("unpaid", "paid")).toEqual({
      kind: "ok",
      value: "unpaid",
    });
  });

  it("writes a picked option when the cell was previously empty", () => {
    expect(resolveSelectCommit("paid", null)).toEqual({
      kind: "ok",
      value: "paid",
    });
  });

  it("omits the value when cleared", () => {
    expect(resolveSelectCommit(null, "paid")).toEqual({ kind: "omit" });
  });

  it("is a no-op when the current value is re-picked", () => {
    expect(resolveSelectCommit("paid", "paid")).toEqual({ kind: "noop" });
    expect(resolveSelectCommit(null, null)).toEqual({ kind: "noop" });
  });
});

describe("selectDraftToData (add-form pick / blank)", () => {
  it("writes the option value on pick", () => {
    expect(selectDraftToData("unpaid")).toEqual({ kind: "ok", value: "unpaid" });
  });

  it("omits the key when left blank", () => {
    expect(selectDraftToData("")).toEqual({ kind: "omit" });
    expect(selectDraftToData("   ")).toEqual({ kind: "omit" });
    expect(selectDraftToData(undefined)).toEqual({ kind: "omit" });
  });
});
