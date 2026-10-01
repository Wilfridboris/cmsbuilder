import { describe, expect, it } from "vitest";

import { oneMonthBeforeUtc } from "@/lib/billing/tier-view";

/**
 * [retro F9] `oneMonthBeforeUtc` anchors the "last completed cycle" window to the
 * true prior calendar-month boundary (clamping the day for short months), instead of
 * subtracting the current cycle's length — which drifts a day or two across uneven
 * months and could wrongly fire/suppress the advisory FR55 upgrade prompt.
 */

const iso = (ms: number) => new Date(ms).toISOString();

describe("oneMonthBeforeUtc", () => {
  it("steps back one month for a mid-month date", () => {
    expect(iso(oneMonthBeforeUtc(Date.UTC(2026, 9, 1)))).toBe(
      "2026-09-01T00:00:00.000Z",
    );
  });

  it("rolls the year back across January", () => {
    expect(iso(oneMonthBeforeUtc(Date.UTC(2026, 0, 15)))).toBe(
      "2025-12-15T00:00:00.000Z",
    );
  });

  it("clamps the day to the target month's length (Mar 31 -> Feb 28)", () => {
    expect(iso(oneMonthBeforeUtc(Date.UTC(2026, 2, 31)))).toBe(
      "2026-02-28T00:00:00.000Z",
    );
  });

  it("clamps into a leap February (Mar 31 2028 -> Feb 29)", () => {
    expect(iso(oneMonthBeforeUtc(Date.UTC(2028, 2, 31)))).toBe(
      "2028-02-29T00:00:00.000Z",
    );
  });

  it("preserves the time-of-day component", () => {
    expect(iso(oneMonthBeforeUtc(Date.UTC(2026, 5, 10, 13, 45, 30)))).toBe(
      "2026-05-10T13:45:30.000Z",
    );
  });
});
