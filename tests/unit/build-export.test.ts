import { describe, expect, it } from "vitest";
import Papa from "papaparse";

import { buildExport } from "@/lib/export/build-export";
import type { RecordData, TableDefinition } from "@/types/db";

/**
 * Unit coverage for the pure export serializer (Story 8.4) — the serialization
 * rows of the frozen I/O & Edge-Case Matrix, with no HTTP/DB harness:
 *   - multiple tables each produce a CSV with an `id`-first, label-headed,
 *     field-ordered column set;
 *   - the JSON is the complete, faithful representation (field keys preserved,
 *     values exactly as stored, relation ids RAW not resolved);
 *   - a zero-table org yields a valid empty bundle (no spurious CSVs);
 *   - a zero-record table yields a header-only CSV;
 *   - every record of a table appears (no truncation in the pure layer).
 */

const clientsTable: TableDefinition = {
  key: "clients",
  label: "Clients",
  fields: [
    { key: "full_name", label: "Full name", type: "text" },
    { key: "email", label: "Email", type: "email" },
    // A hidden field is still exported — the user owns all of it.
    { key: "notes", label: "Notes", type: "text", hidden: true },
  ],
};

const jobsTable: TableDefinition = {
  key: "jobs",
  label: "Jobs",
  fields: [
    { key: "title", label: "Title", type: "text" },
    {
      key: "client",
      label: "Client",
      type: "relation",
      relationConfig: { targetTable: "clients", cardinality: "one" },
    },
  ],
};

function parseCsv(content: string): { header: string[]; rows: string[][] } {
  const result = Papa.parse<string[]>(content.trim(), { skipEmptyLines: true });
  const [header, ...rows] = result.data;
  return { header, rows };
}

describe("buildExport (Story 8.4)", () => {
  it("produces one CSV per table with id-first, label-headed, field-ordered columns", () => {
    const recordsByTable: Record<string, RecordData[]> = {
      clients: [
        {
          id: "c1",
          version: 1,
          data: { full_name: "Ada Lovelace", email: "ada@x.ca", notes: "VIP" },
        },
      ],
      jobs: [
        { id: "j1", version: 1, data: { title: "Install", client: "c1" } },
      ],
    };

    const { csvs } = buildExport({
      slug: "acme",
      exportedAt: "2026-10-05T00:00:00.000Z",
      tables: [clientsTable, jobsTable],
      recordsByTable,
    });

    expect(csvs.map((c) => c.name)).toEqual([
      "tables/clients.csv",
      "tables/jobs.csv",
    ]);

    const clientsCsv = parseCsv(csvs[0].content);
    // id first, then each field's LABEL in schema order (hidden field included).
    expect(clientsCsv.header).toEqual(["id", "Full name", "Email", "Notes"]);
    expect(clientsCsv.rows[0]).toEqual([
      "c1",
      "Ada Lovelace",
      "ada@x.ca",
      "VIP",
    ]);

    const jobsCsv = parseCsv(csvs[1].content);
    expect(jobsCsv.header).toEqual(["id", "Title", "Client"]);
    // The relation value is the RAW stored target id, not a resolved label.
    expect(jobsCsv.rows[0]).toEqual(["j1", "Install", "c1"]);
  });

  it("emits a complete, faithful JSON with keys preserved and values as stored", () => {
    const recordsByTable: Record<string, RecordData[]> = {
      clients: [
        {
          id: "c1",
          version: 7,
          data: { full_name: "Ada", email: "ada@x.ca", notes: "VIP" },
        },
      ],
      jobs: [{ id: "j1", version: 1, data: { title: "Install", client: "c1" } }],
    };

    const { jsonText } = buildExport({
      slug: "acme",
      exportedAt: "2026-10-05T12:00:00.000Z",
      tables: [clientsTable, jobsTable],
      recordsByTable,
    });

    const json = JSON.parse(jsonText);
    expect(json.organizationSlug).toBe("acme");
    expect(json.exportedAt).toBe("2026-10-05T12:00:00.000Z");
    expect(json.tables).toHaveLength(2);

    const clients = json.tables[0];
    expect(clients.key).toBe("clients");
    expect(clients.label).toBe("Clients");
    expect(clients.fields.map((f: { key: string }) => f.key)).toEqual([
      "full_name",
      "email",
      "notes",
    ]);
    // Record data is exactly as stored (keys preserved, no version in the body).
    expect(clients.records).toEqual([
      { id: "c1", data: { full_name: "Ada", email: "ada@x.ca", notes: "VIP" } },
    ]);
    // Relation value stays the raw stored target id.
    expect(json.tables[1].records[0].data.client).toBe("c1");
  });

  it("handles a zero-table org as a valid empty bundle (no spurious CSVs)", () => {
    const { jsonText, csvs } = buildExport({
      slug: "empty",
      exportedAt: "2026-10-05T00:00:00.000Z",
      tables: [],
      recordsByTable: {},
    });

    expect(csvs).toEqual([]);
    const json = JSON.parse(jsonText);
    expect(json.tables).toEqual([]);
    expect(json.organizationSlug).toBe("empty");
  });

  it("emits a header-only CSV for a zero-record table", () => {
    const { csvs } = buildExport({
      slug: "acme",
      exportedAt: "2026-10-05T00:00:00.000Z",
      tables: [clientsTable],
      recordsByTable: { clients: [] },
    });

    const { header, rows } = parseCsv(csvs[0].content);
    expect(header).toEqual(["id", "Full name", "Email", "Notes"]);
    expect(rows).toEqual([]);
  });

  it("[F2] neutralizes CSV formula-injection in string cells while keeping JSON exact", () => {
    const recordsByTable: Record<string, RecordData[]> = {
      clients: [
        {
          id: "c1",
          version: 1,
          data: {
            full_name: '=HYPERLINK("http://evil","x")',
            email: "+15550000",
            notes: "-cmd|calc",
          },
        },
      ],
    };

    const { csvs, jsonText } = buildExport({
      slug: "acme",
      exportedAt: "2026-10-05T00:00:00.000Z",
      tables: [clientsTable],
      recordsByTable,
    });

    const { rows } = parseCsv(csvs[0].content);
    // Each formula-trigger cell is prefixed with a single quote so a spreadsheet
    // renders it as text instead of evaluating it.
    expect(rows[0][1]).toBe("'=HYPERLINK(\"http://evil\",\"x\")");
    expect(rows[0][2]).toBe("'+15550000");
    expect(rows[0][3]).toBe("'-cmd|calc");

    // The JSON side keeps the exact stored value — faithfulness preserved there.
    const json = JSON.parse(jsonText);
    expect(json.tables[0].records[0].data.full_name).toBe(
      '=HYPERLINK("http://evil","x")',
    );
    expect(json.tables[0].records[0].data.email).toBe("+15550000");
  });

  it("includes every record of a table (no truncation in the pure layer)", () => {
    const many: RecordData[] = Array.from({ length: 2500 }, (_, i) => ({
      id: `c${i}`,
      version: 1,
      data: { full_name: `Name ${i}`, email: `n${i}@x.ca`, notes: "" },
    }));

    const { jsonText, csvs } = buildExport({
      slug: "acme",
      exportedAt: "2026-10-05T00:00:00.000Z",
      tables: [clientsTable],
      recordsByTable: { clients: many },
    });

    const json = JSON.parse(jsonText);
    expect(json.tables[0].records).toHaveLength(2500);
    const { rows } = parseCsv(csvs[0].content);
    expect(rows).toHaveLength(2500);
  });
});
