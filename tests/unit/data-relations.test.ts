import { describe, expect, it } from "vitest";

import {
  enumerateInboundRelations,
  type InboundRelation,
} from "@/lib/data/relations";
// The re-export from records.ts must resolve to the SAME implementation so the
// references route / `countReferencingRecords` / safe-delete tests keep working.
import { enumerateInboundRelations as reExported } from "@/lib/data/records";
import type { SchemaDefinition } from "@/types/db";

/**
 * Unit coverage for the pure `enumerateInboundRelations` after its Story 3.9
 * extraction into the client-safe `relations.ts`. Mirrors the cases in
 * `records-safe-delete.test.ts` (which still imports via the re-export) and adds
 * the "multiple fields → one pair per field" case the reverse list depends on.
 */

const schema: SchemaDefinition = {
  tables: [
    {
      key: "clients",
      label: "Clients",
      fields: [{ key: "name", label: "Name", type: "text" }],
    },
    {
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
    },
    {
      key: "invoices",
      label: "Invoices",
      fields: [
        {
          key: "job",
          label: "Job",
          type: "relation",
          relationConfig: { targetTable: "jobs", cardinality: "one" },
        },
        {
          key: "client",
          label: "Client",
          type: "relation",
          relationConfig: { targetTable: "clients", cardinality: "one" },
        },
      ],
    },
  ],
};

describe("enumerateInboundRelations (relations.ts)", () => {
  it("finds every (table, field) pair whose relation targets the table", () => {
    expect(enumerateInboundRelations(schema, "clients")).toEqual<
      InboundRelation[]
    >([
      { tableKey: "jobs", fieldKey: "client" },
      { tableKey: "invoices", fieldKey: "client" },
    ]);
  });

  it("returns an empty list for a table nothing references", () => {
    expect(enumerateInboundRelations(schema, "invoices")).toEqual([]);
  });

  it("includes a self-referencing relation field", () => {
    const selfSchema: SchemaDefinition = {
      tables: [
        {
          key: "tasks",
          label: "Tasks",
          fields: [
            {
              key: "parent",
              label: "Parent",
              type: "relation",
              relationConfig: { targetTable: "tasks", cardinality: "one" },
            },
          ],
        },
      ],
    };
    expect(enumerateInboundRelations(selfSchema, "tasks")).toEqual([
      { tableKey: "tasks", fieldKey: "parent" },
    ]);
  });

  it("yields one pair PER field when a table references the target twice", () => {
    const twoFieldSchema: SchemaDefinition = {
      tables: [
        {
          key: "people",
          label: "People",
          fields: [{ key: "name", label: "Name", type: "text" }],
        },
        {
          key: "meetings",
          label: "Meetings",
          fields: [
            {
              key: "organizer",
              label: "Organizer",
              type: "relation",
              relationConfig: { targetTable: "people", cardinality: "one" },
            },
            {
              key: "attendee",
              label: "Attendee",
              type: "relation",
              relationConfig: { targetTable: "people", cardinality: "one" },
            },
          ],
        },
      ],
    };
    expect(enumerateInboundRelations(twoFieldSchema, "people")).toEqual([
      { tableKey: "meetings", fieldKey: "organizer" },
      { tableKey: "meetings", fieldKey: "attendee" },
    ]);
  });

  it("normalizes the target key so an un-normalized caller still matches", () => {
    expect(enumerateInboundRelations(schema, "Clients")).toEqual([
      { tableKey: "jobs", fieldKey: "client" },
      { tableKey: "invoices", fieldKey: "client" },
    ]);
  });

  it("is the SAME implementation re-exported from records.ts", () => {
    expect(reExported).toBe(enumerateInboundRelations);
  });
});
