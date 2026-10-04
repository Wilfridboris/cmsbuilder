import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { CellStrings } from "@/lib/format";
import type { FieldDefinition } from "@/types/db";
import { renderCell, type ResolveRelation } from "@/components/dashboard/DemoDashboard";

/**
 * Coverage for the demo dashboard's `renderCell` (the pre-account "aha moment"
 * table/card renderer). Story 13.5 makes AI generation and the hard fallback
 * emit `select` fields for the first time, so the demo preview must resolve a
 * select cell's stored `value` token to its option `label` — it forwards
 * `field.options` to the shared `CellText`/`formatCell`. These assertions pin
 * that forwarding; without it a select cell renders the raw token (e.g.
 * `in_progress`) on the very first screen a new user sees.
 *
 * Node SSR (`renderToStaticMarkup`) keeps this a pure unit — `renderCell` only
 * uses `CellText` (hook-free) and the injected `resolveRelation`, so the heavy
 * `DemoDashboard` client component (framer-motion, next-intl) is never mounted.
 */

const cellStrings: CellStrings = { empty: "EMPTY", yes: "Yes", no: "No" };
const noRelation: ResolveRelation = () => null;

const statusField: FieldDefinition = {
  key: "status",
  label: "Status",
  type: "select",
  options: [
    { value: "scheduled", label: "Scheduled" },
    { value: "in_progress", label: "In Progress" },
    { value: "complete", label: "Complete" },
  ],
};

describe("DemoDashboard renderCell — select fields (Story 13.5)", () => {
  it("renders a select cell's option label, not the raw stored value token", () => {
    const html = renderToStaticMarkup(
      renderCell(statusField, "in_progress", cellStrings, noRelation),
    );
    expect(html).toContain("In Progress");
    expect(html).not.toContain("in_progress");
  });

  it("falls back to the raw token when the stored value matches no option", () => {
    // Defensive: an orphaned token (e.g. an archived/removed value) still renders
    // something rather than vanishing — the shared formatCell contract.
    const html = renderToStaticMarkup(
      renderCell(statusField, "cancelled", cellStrings, noRelation),
    );
    expect(html).toContain("cancelled");
  });

  it("still renders a plain scalar cell unchanged", () => {
    const textField: FieldDefinition = { key: "name", label: "Name", type: "text" };
    const html = renderToStaticMarkup(
      renderCell(textField, "Acme Co", cellStrings, noRelation),
    );
    expect(html).toContain("Acme Co");
  });
});
