import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";

import {
  parseSpreadsheet,
  ParseError,
  SAMPLE_ROW_CAP,
} from "@/lib/import/parse";

/**
 * Unit coverage for the pure spreadsheet parser (Story 4.1) — every row of the
 * frozen I/O & Edge-Case Matrix that lives in `parseSpreadsheet` rather than the
 * route:
 *   - Valid CSV                → { columns, rows, sheetName }, header row detected;
 *   - Valid single-sheet xlsx  → same shape, parsed via xlsx;
 *   - Multi-sheet xlsx         → sheetNames + no preview when no sheet chosen;
 *                                the chosen sheet then parses to a preview;
 *   - Empty file (0 bytes)     → ParseError("Import.error.empty");
 *   - Header row, no data      → ParseError("Import.error.empty");
 *   - Unreadable / not a sheet → ParseError("Import.error.unreadable");
 *   - Sample-row cap           → parser returns ALL rows; the route slices to
 *                                SAMPLE_ROW_CAP, so verify the cap constant + a
 *                                full-row return here.
 *
 * The parser is framework-free, so this needs no HTTP/auth harness — it drives
 * bytes straight in. Excel fixtures are built in-memory with the same `xlsx` lib
 * the parser reads with.
 */

/** Build an .xlsx buffer from named sheets, each an array-of-arrays (AOA). */
function makeXlsxBuffer(sheets: Record<string, unknown[][]>): Buffer {
  const wb = XLSX.utils.book_new();
  for (const [name, aoa] of Object.entries(sheets)) {
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), name);
  }
  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
}

describe("parseSpreadsheet — CSV", () => {
  it("parses a valid CSV: first row is headers, rest are data rows", () => {
    const csv = "Name,Email,Amount\nAda,ada@x.ca,10\nGrace,grace@x.ca,20\n";
    const result = parseSpreadsheet(Buffer.from(csv), "customers.csv");

    expect(result.sheetNames).toBeUndefined();
    expect(result.columns).toEqual(["Name", "Email", "Amount"]);
    expect(result.sheetName).toBe("customers");
    expect(result.rows).toHaveLength(2);
    expect(result.rows[0]).toEqual({
      Name: "Ada",
      Email: "ada@x.ca",
      Amount: "10",
    });
    expect(result.rows[1].Name).toBe("Grace");
  });

  it("uses the filename stem (no extension, no path) as the sheetName", () => {
    const csv = "A\n1\n";
    const result = parseSpreadsheet(Buffer.from(csv), "/tmp/reports/2024.csv");
    expect(result.sheetName).toBe("2024");
  });

  it("strips a UTF-8 BOM from the first header", () => {
    const csv = "﻿Name,Age\nAda,36\n";
    const result = parseSpreadsheet(Buffer.from(csv), "x.csv");
    expect(result.columns).toEqual(["Name", "Age"]);
  });

  it("disambiguates blank and duplicate headers into distinct keys", () => {
    const csv = "Name,,Name\na,b,c\n";
    const result = parseSpreadsheet(Buffer.from(csv), "x.csv");
    expect(result.columns).toEqual(["Name", "Column 2", "Name (2)"]);
    expect(result.rows[0]).toEqual({
      Name: "a",
      "Column 2": "b",
      "Name (2)": "c",
    });
  });

  it("throws empty for a header row with no data rows", () => {
    const csv = "Name,Email\n";
    expect(() => parseSpreadsheet(Buffer.from(csv), "x.csv")).toThrow(
      ParseError,
    );
    try {
      parseSpreadsheet(Buffer.from(csv), "x.csv");
    } catch (err) {
      expect((err as ParseError).key).toBe("Import.error.empty");
    }
  });

  it("throws empty for a 0-byte buffer", () => {
    try {
      parseSpreadsheet(Buffer.from(""), "x.csv");
      throw new Error("expected throw");
    } catch (err) {
      expect(err).toBeInstanceOf(ParseError);
      expect((err as ParseError).key).toBe("Import.error.empty");
    }
  });

  it("returns ALL data rows (route applies the SAMPLE_ROW_CAP slice)", () => {
    const lines = ["Val"];
    for (let i = 0; i < SAMPLE_ROW_CAP + 5; i++) lines.push(String(i));
    const result = parseSpreadsheet(Buffer.from(lines.join("\n")), "x.csv");
    expect(result.rows).toHaveLength(SAMPLE_ROW_CAP + 5);
    // The route slices; confirm the cap is the frozen 10.
    expect(SAMPLE_ROW_CAP).toBe(10);
  });
});

describe("parseSpreadsheet — Excel", () => {
  it("parses a valid single-sheet workbook like a CSV", () => {
    const buf = makeXlsxBuffer({
      Sheet1: [
        ["Name", "Amount"],
        ["Ada", 10],
        ["Grace", 20],
      ],
    });
    const result = parseSpreadsheet(buf, "book.xlsx");

    expect(result.sheetNames).toBeUndefined();
    expect(result.columns).toEqual(["Name", "Amount"]);
    expect(result.sheetName).toBe("Sheet1");
    expect(result.rows).toHaveLength(2);
    expect(result.rows[0]).toEqual({ Name: "Ada", Amount: "10" });
  });

  it("coerces a date cell to an ISO string, not a serial number", () => {
    const buf = makeXlsxBuffer({
      Sheet1: [
        ["Name", "Invoiced"],
        ["Ada", new Date(Date.UTC(2021, 0, 1))],
      ],
    });
    const result = parseSpreadsheet(buf, "book.xlsx");

    expect(result.columns).toEqual(["Name", "Invoiced"]);
    // The preview must show a real date, never a raw serial like "44197".
    expect(result.rows[0].Invoiced).not.toMatch(/^\d+$/);
    expect(result.rows[0].Invoiced).toContain("2021-01-01");
  });

  it("returns sheetNames + no preview for a multi-sheet workbook with no chosen sheet", () => {
    const buf = makeXlsxBuffer({
      Customers: [["Name"], ["Ada"]],
      Invoices: [["Total"], ["99"]],
    });
    const result = parseSpreadsheet(buf, "book.xlsx");

    expect(result.sheetNames).toEqual(["Customers", "Invoices"]);
    expect(result.columns).toEqual([]);
    expect(result.rows).toEqual([]);
    expect(result.sheetName).toBe("");
  });

  it("parses the chosen sheet of a multi-sheet workbook", () => {
    const buf = makeXlsxBuffer({
      Customers: [["Name"], ["Ada"]],
      Invoices: [["Total"], ["99"], ["100"]],
    });
    const result = parseSpreadsheet(buf, "book.xlsx", "Invoices");

    expect(result.sheetNames).toBeUndefined();
    expect(result.sheetName).toBe("Invoices");
    expect(result.columns).toEqual(["Total"]);
    expect(result.rows).toEqual([{ Total: "99" }, { Total: "100" }]);
  });

  it("throws unreadable when the chosen sheet is not in the workbook", () => {
    const buf = makeXlsxBuffer({
      Customers: [["Name"], ["Ada"]],
      Invoices: [["Total"], ["99"]],
    });
    try {
      parseSpreadsheet(buf, "book.xlsx", "Nope");
      throw new Error("expected throw");
    } catch (err) {
      expect(err).toBeInstanceOf(ParseError);
      expect((err as ParseError).key).toBe("Import.error.unreadable");
    }
  });

  it("throws empty for a single-sheet workbook whose only sheet has just a header", () => {
    const buf = makeXlsxBuffer({ Sheet1: [["Name", "Email"]] });
    try {
      parseSpreadsheet(buf, "book.xlsx");
      throw new Error("expected throw");
    } catch (err) {
      expect((err as ParseError).key).toBe("Import.error.empty");
    }
  });
});

describe("parseSpreadsheet — unreadable / unsupported", () => {
  it("throws unreadable for a non-spreadsheet extension", () => {
    try {
      parseSpreadsheet(Buffer.from("%PDF-1.4"), "doc.pdf");
      throw new Error("expected throw");
    } catch (err) {
      expect(err).toBeInstanceOf(ParseError);
      expect((err as ParseError).key).toBe("Import.error.unreadable");
    }
  });

  it("throws unreadable for corrupt bytes with an .xlsx extension", () => {
    const corrupt = Buffer.from([0x00, 0x01, 0x02, 0x03, 0xff, 0xfe]);
    try {
      parseSpreadsheet(corrupt, "book.xlsx");
      throw new Error("expected throw");
    } catch (err) {
      expect(err).toBeInstanceOf(ParseError);
      // Corrupt xlsx bytes surface as empty (no sheets) or unreadable (read
      // throws); both are translated, non-technical keys — never a raw error.
      expect(["Import.error.unreadable", "Import.error.empty"]).toContain(
        (err as ParseError).key,
      );
    }
  });
});
