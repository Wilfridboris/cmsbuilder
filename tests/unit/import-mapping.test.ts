import { describe, expect, it } from "vitest";

import type { SchemaDefinition } from "@/types/db";
import type { RawMappingOutput } from "@/lib/import/mapping";
import {
  buildMappingPrompt,
  MAPPING_CONFIDENCE_THRESHOLD,
  MAPPING_RESPONSE_SCHEMA,
  sanitizeProposal,
} from "@/lib/import/mapping";

/**
 * Unit coverage for the pure mapping helpers (Story 4.2). `sanitizeProposal` is
 * the trust boundary — a Gemini hallucination must never reach the client as a
 * real mapping — so it is exercised across the whole I/O matrix: confident match,
 * low-confidence flag, null target, hallucinated target downgrade, empty schema,
 * a source column the model omitted, confidence clamping, and preserved duplicate
 * targets. `buildMappingPrompt` is checked for its structural shape (columns,
 * sample values, non-hidden target schema; no DDL).
 */

const SCHEMA: SchemaDefinition = {
  tables: [
    {
      key: "clients",
      label: "Clients",
      fields: [
        { key: "name", label: "Name", type: "text" },
        { key: "email", label: "Email", type: "email" },
        { key: "secret", label: "Secret", type: "text", hidden: true },
      ],
    },
    {
      key: "hidden_table",
      label: "Hidden",
      hidden: true,
      fields: [{ key: "x", label: "X", type: "text" }],
    },
  ],
};

describe("sanitizeProposal", () => {
  it("keeps a confident, resolvable match with its target and reason", () => {
    const raw: RawMappingOutput = {
      mappings: [
        {
          sourceColumn: "Full Name",
          targetTable: "clients",
          targetField: "name",
          confidence: 0.95,
          reason: "Column looks like a person's name.",
        },
      ],
    };
    const result = sanitizeProposal(raw, SCHEMA, ["Full Name"], 12);
    expect(result.rowCount).toBe(12);
    expect(result.mappings).toEqual([
      {
        sourceColumn: "Full Name",
        target: { table: "clients", field: "name" },
        confidence: 0.95,
        reason: "Column looks like a person's name.",
      },
    ]);
    expect(result.unmapped).toEqual([]);
  });

  it("keeps a below-threshold match but flags it as unmapped", () => {
    const raw: RawMappingOutput = {
      mappings: [
        {
          sourceColumn: "Contact",
          targetTable: "clients",
          targetField: "email",
          confidence: 0.4,
          reason: "Might be an email.",
        },
      ],
    };
    const result = sanitizeProposal(raw, SCHEMA, ["Contact"], 3);
    expect(result.mappings[0].target).toEqual({
      table: "clients",
      field: "email",
    });
    expect(result.mappings[0].confidence).toBe(0.4);
    expect(result.unmapped).toEqual(["Contact"]);
  });

  it("treats the threshold itself as mapped (>= threshold not flagged)", () => {
    const raw: RawMappingOutput = {
      mappings: [
        {
          sourceColumn: "Name",
          targetTable: "clients",
          targetField: "name",
          confidence: MAPPING_CONFIDENCE_THRESHOLD,
          reason: "ok",
        },
      ],
    };
    const result = sanitizeProposal(raw, SCHEMA, ["Name"], 1);
    expect(result.unmapped).toEqual([]);
  });

  it("keeps an explicit null target as unmapped", () => {
    const raw: RawMappingOutput = {
      mappings: [
        {
          sourceColumn: "Notes",
          targetTable: null,
          targetField: null,
          confidence: 0.9,
          reason: "Nothing fits.",
        },
      ],
    };
    const result = sanitizeProposal(raw, SCHEMA, ["Notes"], 5);
    expect(result.mappings[0].target).toBeNull();
    expect(result.unmapped).toEqual(["Notes"]);
  });

  it("downgrades a hallucinated target (table/field not in schema) to null", () => {
    const raw: RawMappingOutput = {
      mappings: [
        {
          sourceColumn: "Amount",
          targetTable: "invoices",
          targetField: "total",
          confidence: 0.99,
          reason: "Looks like a total.",
        },
      ],
    };
    const result = sanitizeProposal(raw, SCHEMA, ["Amount"], 5);
    expect(result.mappings[0].target).toBeNull();
    expect(result.unmapped).toEqual(["Amount"]);
  });

  it("downgrades a target that resolves only to a HIDDEN field to null", () => {
    const raw: RawMappingOutput = {
      mappings: [
        {
          sourceColumn: "S",
          targetTable: "clients",
          targetField: "secret",
          confidence: 0.99,
          reason: "matches hidden",
        },
      ],
    };
    const result = sanitizeProposal(raw, SCHEMA, ["S"], 1);
    expect(result.mappings[0].target).toBeNull();
    expect(result.unmapped).toEqual(["S"]);
  });

  it("with an empty schema, all columns are null and unmapped", () => {
    const raw: RawMappingOutput = {
      mappings: [
        {
          sourceColumn: "A",
          targetTable: "clients",
          targetField: "name",
          confidence: 0.9,
          reason: "x",
        },
      ],
    };
    const result = sanitizeProposal(raw, { tables: [] }, ["A", "B"], 2);
    expect(result.mappings.map((m) => m.target)).toEqual([null, null]);
    expect(result.unmapped).toEqual(["A", "B"]);
  });

  it("fills a source column the model omitted as an unmapped null", () => {
    const raw: RawMappingOutput = {
      mappings: [
        {
          sourceColumn: "Name",
          targetTable: "clients",
          targetField: "name",
          confidence: 0.9,
          reason: "x",
        },
      ],
    };
    const result = sanitizeProposal(raw, SCHEMA, ["Name", "Extra"], 4);
    expect(result.mappings).toHaveLength(2);
    const extra = result.mappings.find((m) => m.sourceColumn === "Extra");
    expect(extra?.target).toBeNull();
    expect(extra?.confidence).toBe(0);
    expect(result.unmapped).toContain("Extra");
  });

  it("emits exactly one entry per source column in order", () => {
    const result = sanitizeProposal(
      { mappings: [] },
      SCHEMA,
      ["One", "Two", "Three"],
      0,
    );
    expect(result.mappings.map((m) => m.sourceColumn)).toEqual([
      "One",
      "Two",
      "Three",
    ]);
  });

  it("clamps confidence into [0, 1] and coerces non-numbers to 0", () => {
    const raw: RawMappingOutput = {
      mappings: [
        {
          sourceColumn: "Over",
          targetTable: "clients",
          targetField: "name",
          confidence: 5,
          reason: "x",
        },
        {
          sourceColumn: "Under",
          targetTable: "clients",
          targetField: "name",
          confidence: -2,
          reason: "x",
        },
        {
          sourceColumn: "NaN",
          targetTable: "clients",
          targetField: "name",
          confidence: "not-a-number",
          reason: "x",
        },
      ],
    };
    const result = sanitizeProposal(raw, SCHEMA, ["Over", "Under", "NaN"], 1);
    const byCol = Object.fromEntries(
      result.mappings.map((m) => [m.sourceColumn, m.confidence]),
    );
    expect(byCol["Over"]).toBe(1);
    expect(byCol["Under"]).toBe(0);
    expect(byCol["NaN"]).toBe(0);
  });

  it("resolves an un-normalized target key (case/label) to the real field key", () => {
    const raw: RawMappingOutput = {
      mappings: [
        {
          sourceColumn: "Name",
          targetTable: "Clients",
          targetField: "Name",
          confidence: 0.9,
          reason: "x",
        },
      ],
    };
    const result = sanitizeProposal(raw, SCHEMA, ["Name"], 1);
    expect(result.mappings[0].target).toEqual({
      table: "clients",
      field: "name",
    });
  });

  it("preserves duplicate targets (two columns → same field), no dedup", () => {
    const raw: RawMappingOutput = {
      mappings: [
        {
          sourceColumn: "Name A",
          targetTable: "clients",
          targetField: "name",
          confidence: 0.9,
          reason: "x",
        },
        {
          sourceColumn: "Name B",
          targetTable: "clients",
          targetField: "name",
          confidence: 0.9,
          reason: "y",
        },
      ],
    };
    const result = sanitizeProposal(raw, SCHEMA, ["Name A", "Name B"], 2);
    expect(result.mappings[0].target).toEqual({
      table: "clients",
      field: "name",
    });
    expect(result.mappings[1].target).toEqual({
      table: "clients",
      field: "name",
    });
    expect(result.unmapped).toEqual([]);
  });

  it("tolerates null/undefined raw output (all columns unmapped)", () => {
    const result = sanitizeProposal(null, SCHEMA, ["A"], 1);
    expect(result.mappings[0].target).toBeNull();
    expect(result.unmapped).toEqual(["A"]);
  });

  it("downgrades when only one of table/field is present", () => {
    const raw: RawMappingOutput = {
      mappings: [
        {
          sourceColumn: "Half",
          targetTable: "clients",
          targetField: null,
          confidence: 0.9,
          reason: "x",
        },
      ],
    };
    const result = sanitizeProposal(raw, SCHEMA, ["Half"], 1);
    expect(result.mappings[0].target).toBeNull();
    expect(result.unmapped).toEqual(["Half"]);
  });
});

describe("buildMappingPrompt", () => {
  const columns = ["Full Name", "Email Address"];
  const sampleRows = [
    { "Full Name": "Ada Lovelace", "Email Address": "ada@x.ca" },
    { "Full Name": "Grace Hopper", "Email Address": "" },
  ];

  it("includes each source column name and its sample values", () => {
    const prompt = buildMappingPrompt(columns, sampleRows, SCHEMA);
    expect(prompt).toContain("Full Name");
    expect(prompt).toContain("Email Address");
    expect(prompt).toContain("Ada Lovelace");
    expect(prompt).toContain("ada@x.ca");
  });

  it("includes only non-hidden target tables and fields", () => {
    const prompt = buildMappingPrompt(columns, sampleRows, SCHEMA);
    expect(prompt).toContain("clients");
    expect(prompt).toContain("name");
    expect(prompt).toContain("email");
    // Hidden field and hidden table must not be offered as targets.
    expect(prompt).not.toContain("secret");
    expect(prompt).not.toContain("hidden_table");
  });

  it("bounds sample values per column to at most 5", () => {
    const wideRows = Array.from({ length: 10 }, (_, i) => ({
      Col: `v${i}`,
    }));
    const prompt = buildMappingPrompt(["Col"], wideRows, SCHEMA);
    expect(prompt).toContain("v0");
    expect(prompt).toContain("v4");
    expect(prompt).not.toContain("v5");
  });

  it("instructs the model never to invent tables/fields and to output no SQL", () => {
    const prompt = buildMappingPrompt(columns, sampleRows, SCHEMA);
    expect(prompt).toMatch(/never invent/i);
    expect(prompt).toMatch(/SQL/);
  });

  it("defaults to an English reason instruction when no locale is passed (4.2 unchanged)", () => {
    const prompt = buildMappingPrompt(columns, sampleRows, SCHEMA);
    expect(prompt).toContain("Write every \"reason\" in English.");
  });

  it("instructs a French reason when the fr locale is passed", () => {
    const prompt = buildMappingPrompt(columns, sampleRows, SCHEMA, "fr");
    expect(prompt).toContain("Write every \"reason\" in French.");
    expect(prompt).not.toContain("Write every \"reason\" in English.");
  });
});

describe("MAPPING_RESPONSE_SCHEMA", () => {
  it("shapes a mappings array with nullable target table/field", () => {
    const items = MAPPING_RESPONSE_SCHEMA.properties.mappings.items;
    expect(items.properties.sourceColumn).toBeDefined();
    expect(items.properties.targetTable.nullable).toBe(true);
    expect(items.properties.targetField.nullable).toBe(true);
    expect(items.properties.confidence).toBeDefined();
    expect(items.properties.reason).toBeDefined();
  });
});
