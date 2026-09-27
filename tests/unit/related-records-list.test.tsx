import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { CellStrings } from "@/lib/format";
import type { RecordData, TableDefinition } from "@/types/db";

/**
 * Static-render coverage for the Story 3.9 `RelatedRecordsList` — one inbound
 * reverse-relation section. The repo test env is `node` (no jsdom), so the
 * component is exercised through React's server renderer. `next-intl` echoes keys,
 * and `@tanstack/react-query` is mocked so a test can drive the records query into
 * each branch (data / filtered-empty / load-error) deterministically; `useQueries`
 * (from `useRelationLabels`) returns scripted label batches so a relation cell
 * resolves to a LABEL, never the raw id.
 */

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string, vars?: Record<string, unknown>) => {
    if (vars?.table !== undefined) return `${key}:${String(vars.table)}`;
    if (vars?.field !== undefined) return `${key}:${String(vars.field)}`;
    return key;
  },
}));

// Controlled per-test query state. `useQuery` drives the records fetch; `useQueries`
// backs `useRelationLabels` (one settled batch per target table).
let recordsQueryState: {
  data?: RecordData[];
  isPending: boolean;
  isError: boolean;
  isFetching?: boolean;
};
let labelQueriesState: Array<{
  data: Array<{ id: string; label: string }>;
  isPending: boolean;
  isError: boolean;
}>;
// Captures the records query key so a test can assert the fixed base reverse
// relation filter (`<fieldKey>:<targetId>`) is wired into it via `serverFilters`.
let capturedRecordsQueryKey: unknown;

vi.mock("@tanstack/react-query", () => ({
  useQuery: (opts: { queryKey?: unknown }) => {
    capturedRecordsQueryKey = opts?.queryKey;
    return recordsQueryState;
  },
  useQueries: () => labelQueriesState,
}));

const { RelatedRecordsList } = await import(
  "@/components/dashboard/RelatedRecordsList"
);

const cellStrings: CellStrings = { empty: "EMPTY", yes: "Yes", no: "No" };

// The referencing table: a text field + a relation cell (to prove label display).
const invoices: TableDefinition = {
  key: "invoices",
  label: "Invoices",
  fields: [
    { key: "number", label: "Number", type: "text" },
    {
      key: "job",
      label: "Job",
      type: "relation",
      relationConfig: { targetTable: "jobs", cardinality: "one" },
    },
  ],
};

const rows: RecordData[] = [
  { id: "inv-1", version: 1, data: { number: "INV-001", job: "job-9" } },
];

// The reverse list shows invoices whose `job` relation points at the opened job
// record (`job-1`). `job` is a real relation field on the `invoices` fixture, so
// the fixed base filter `{ field: "job", targetId: "job-1" }` is coherent.
const BASE_FIELD_KEY = "job";
const BASE_TARGET_ID = "job-1";

function render() {
  return renderToStaticMarkup(
    <RelatedRecordsList
      slug="test-org"
      refTable={invoices}
      fieldKey={BASE_FIELD_KEY}
      targetId={BASE_TARGET_ID}
      heading="HEAD"
      cellStrings={cellStrings}
    />,
  );
}

afterEach(() => {
  vi.clearAllMocks();
});

describe("RelatedRecordsList (Story 3.9)", () => {
  it("renders referencing rows read-only by resolved label (never the raw id)", () => {
    recordsQueryState = { data: rows, isPending: false, isError: false };
    // The relation cell's target id (job-9) resolves to a label via useRelationLabels.
    labelQueriesState = [
      { data: [{ id: "job-9", label: "Roof repair" }], isPending: false, isError: false },
    ];

    const html = render();

    // Section heading present.
    expect(html).toContain("HEAD");
    // The scalar value renders.
    expect(html).toContain("INV-001");
    // The relation cell shows the resolved LABEL, never the raw target id.
    expect(html).toContain("Roof repair");
    expect(html).not.toContain("job-9");
    // Rows are READ-ONLY: no inline-edit trigger (editable={false}).
    expect(html).not.toContain('aria-label="editValueLabel:Number"');
  });

  it("wires the fixed base reverse relation filter into the records query key", () => {
    recordsQueryState = { data: rows, isPending: false, isError: false };
    labelQueriesState = [
      { data: [{ id: "job-9", label: "Roof repair" }], isPending: false, isError: false },
    ];

    render();

    // The query key must carry the base filter as a serialized `<field>:<id>` part
    // (via `serverFilters` → `relationFilterKeyPart`), so the server narrows to only
    // the rows that reference the opened record.
    const key = capturedRecordsQueryKey as unknown[];
    expect(key).toEqual([
      "records",
      "test-org",
      "invoices",
      [`${BASE_FIELD_KEY}:${BASE_TARGET_ID}`],
    ]);
  });

  it("shows the section-empty state when the server returns no referencing rows (no filters)", () => {
    // No user filters here, so an empty result is the section-empty state.
    recordsQueryState = { data: [], isPending: false, isError: false };
    labelQueriesState = [];

    const html = render();

    expect(html).toContain("reverseSectionEmpty");
  });

  it("shows a translated per-section load-error line when the fetch fails", () => {
    recordsQueryState = { isPending: false, isError: true };
    labelQueriesState = [];

    const html = render();

    expect(html).toContain("reverseListLoadError");
    // No crash, and no rows rendered.
    expect(html).not.toContain("INV-001");
  });

  it("shows skeletons (never a spinner) while loading", () => {
    recordsQueryState = { isPending: true, isError: false };
    labelQueriesState = [];

    const html = render();

    // Skeleton uses the shared Skeleton component (animate-pulse), not a spinner.
    expect(html).toContain("animate-pulse");
    expect(html).not.toContain("animate-spin");
  });
});
