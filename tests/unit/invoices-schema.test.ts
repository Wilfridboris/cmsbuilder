import { describe, expect, it } from "vitest";

import {
  draftBodySchema,
  listQuerySchema,
  getQuerySchema,
  toWritableDraft,
  firstInvoiceErrorKey,
  INVOICE_LANGUAGES,
} from "@/app/api/invoices/schemas";

/**
 * Pure validation coverage for Story 12.2's invoice draft body (no HTTP harness):
 * every frozen matrix row that lives in the schema — description required, amount
 * invalid (non-numeric / negative), >=1 line required, language enum, and the
 * customerRecordId uuid shape — plus the writable mapper and the error-key
 * extractor. These lock the KEYs the route maps to matrix statuses.
 */

const LINE = { description: "Consulting", quantity: 2, unitPrice: 50 };
const VALID = { slug: "acme", lineItems: [LINE] };

function parse(input: Record<string, unknown>) {
  const result = draftBodySchema.safeParse(input);
  return {
    success: result.success,
    data: result.success ? result.data : undefined,
    firstKey: result.success ? undefined : firstInvoiceErrorKey(result.error),
  };
}

describe("draftBodySchema — happy path + defaults", () => {
  it("accepts a minimal standalone draft and defaults language to 'en'", () => {
    const { success, data } = parse(VALID);
    expect(success).toBe(true);
    expect(data?.language).toBe("en");
    expect(data?.customerRecordId).toBeUndefined();
    expect(data?.version).toBeUndefined();
    expect(data?.lineItems).toHaveLength(1);
  });

  it("collapses a blank province to undefined", () => {
    const { data } = parse({ ...VALID, province: "   " });
    expect(data?.province).toBeUndefined();
  });

  it("accepts a version on an update", () => {
    const { data } = parse({ ...VALID, version: 3 });
    expect(data?.version).toBe(3);
  });
});

describe("draftBodySchema — line item validation", () => {
  it("rejects a blank description with descriptionRequired", () => {
    const { success, firstKey } = parse({
      ...VALID,
      lineItems: [{ description: "   ", quantity: 1, unitPrice: 1 }],
    });
    expect(success).toBe(false);
    expect(firstKey).toBe("Invoice.error.descriptionRequired");
  });

  it("rejects a negative quantity with amountInvalid", () => {
    const { success, firstKey } = parse({
      ...VALID,
      lineItems: [{ description: "X", quantity: -1, unitPrice: 1 }],
    });
    expect(success).toBe(false);
    expect(firstKey).toBe("Invoice.error.amountInvalid");
  });

  it("rejects a negative unit price with amountInvalid", () => {
    const { success, firstKey } = parse({
      ...VALID,
      lineItems: [{ description: "X", quantity: 1, unitPrice: -5 }],
    });
    expect(success).toBe(false);
    expect(firstKey).toBe("Invoice.error.amountInvalid");
  });

  it("rejects a non-numeric quantity with amountInvalid", () => {
    const { success, firstKey } = parse({
      ...VALID,
      lineItems: [{ description: "X", quantity: "two", unitPrice: 1 }],
    });
    expect(success).toBe(false);
    expect(firstKey).toBe("Invoice.error.amountInvalid");
  });

  it("accepts zero quantity/price (a valid, if empty, line)", () => {
    const { success } = parse({
      ...VALID,
      lineItems: [{ description: "X", quantity: 0, unitPrice: 0 }],
    });
    expect(success).toBe(true);
  });
});

describe("draftBodySchema — at least one line", () => {
  it("rejects a draft with zero line items with lineItemsRequired", () => {
    const { success, firstKey } = parse({ ...VALID, lineItems: [] });
    expect(success).toBe(false);
    expect(firstKey).toBe("Invoice.error.lineItemsRequired");
  });
});

describe("draftBodySchema — language + customerRecordId shape", () => {
  it("accepts every language in the vocabulary and rejects others", () => {
    for (const language of INVOICE_LANGUAGES) {
      expect(parse({ ...VALID, language }).success).toBe(true);
    }
    expect(parse({ ...VALID, language: "es" }).success).toBe(false);
  });

  it("accepts a uuid customerRecordId", () => {
    const { success, data } = parse({
      ...VALID,
      customerRecordId: "11111111-1111-4111-8111-111111111111",
    });
    expect(success).toBe(true);
    expect(data?.customerRecordId).toBe("11111111-1111-4111-8111-111111111111");
  });

  it("rejects a non-uuid customerRecordId with customerRecordInvalid", () => {
    const { success, firstKey } = parse({ ...VALID, customerRecordId: "nope" });
    expect(success).toBe(false);
    expect(firstKey).toBe("Invoice.error.customerRecordInvalid");
  });
});

describe("query schemas", () => {
  it("require a non-empty slug", () => {
    expect(listQuerySchema.safeParse({ slug: "acme" }).success).toBe(true);
    expect(listQuerySchema.safeParse({ slug: "" }).success).toBe(false);
    expect(getQuerySchema.safeParse({ slug: null }).success).toBe(false);
  });
});

describe("firstInvoiceErrorKey", () => {
  it("maps a non-Invoice Zod default (bad slug) to genericError", () => {
    const result = draftBodySchema.safeParse({ slug: "", lineItems: [LINE] });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(firstInvoiceErrorKey(result.error)).toBe("genericError");
    }
  });
});

describe("toWritableDraft", () => {
  it("maps a linked draft to the write shape (amount computed later)", () => {
    const parsed = draftBodySchema.parse({
      ...VALID,
      customerRecordId: "11111111-1111-4111-8111-111111111111",
      province: "ON",
      version: 2,
    });
    const writable = toWritableDraft(parsed);
    expect(writable.customerRecordId).toBe(
      "11111111-1111-4111-8111-111111111111",
    );
    expect(writable.province).toBe("ON");
    expect(writable.language).toBe("en");
    expect(writable.version).toBe(2);
    expect(writable.lineItems).toEqual([
      { description: "Consulting", quantity: 2, unitPrice: 50 },
    ]);
    // No `amount` on the writable shape — the mutation layer computes it (I2).
    expect(writable.lineItems[0]).not.toHaveProperty("amount");
  });

  it("maps a standalone draft with null customer / province / version", () => {
    const parsed = draftBodySchema.parse(VALID);
    const writable = toWritableDraft(parsed);
    expect(writable.customerRecordId).toBeNull();
    expect(writable.province).toBeNull();
    expect(writable.version).toBeNull();
  });
});
