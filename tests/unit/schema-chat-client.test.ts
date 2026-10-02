import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  postEditorChat,
  postRemoveView,
  postRestoreView,
  postSetColumnVisibility,
  SchemaChatError,
} from "@/lib/data/schema-chat-client";
import type { ViewDefinition } from "@/types/db";

/**
 * Unit coverage for the conversational chat client wrappers (Story 5.1, 5.2, 5.5).
 * Mocks `global.fetch` only — no network. Locks the frozen I/O & Edge-Case Matrix
 * rows the route tests cannot reach: the chat's visibility Undo targets a field
 * through the existing append-only `/api/schema/columns` path — `hidden: true` to
 * undo an ADD (Story 5.1), `hidden: false` to undo a HIDE / show-again (Story 5.5).
 * Also covers `postEditorChat` success / transport-failure mapping (posting to
 * `/api/schema/edit`) so a raw error, stack, or SQL never reaches the UI.
 */

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return {
    ok,
    status,
    json: async () => body,
  } as unknown as Response;
}

describe("postSetColumnVisibility (Story 5.1 Undo add, Story 5.5 show-again)", () => {
  it("POSTs hidden: true to the column path (undo of an add-column)", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ data: { hidden: true }, error: null }));

    await expect(
      postSetColumnVisibility("acme", "jobs", "warranty_date", true),
    ).resolves.toBeUndefined();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/schema/columns");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toEqual({
      slug: "acme",
      tableKey: "jobs",
      fieldKey: "warranty_date",
      hidden: true,
    });
  });

  it("POSTs hidden: false to the column path (show-again Undo of a hide)", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ data: { hidden: false }, error: null }));

    await expect(
      postSetColumnVisibility("acme", "jobs", "notes", false),
    ).resolves.toBeUndefined();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/schema/columns");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toEqual({
      slug: "acme",
      tableKey: "jobs",
      fieldKey: "notes",
      hidden: false,
    });
  });

  it("throws SchemaChatError carrying the server error code on a failed write", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ data: null, error: "forbidden" }, false, 403),
    );

    await expect(
      postSetColumnVisibility("acme", "jobs", "warranty_date", true),
    ).rejects.toMatchObject({ name: "SchemaChatError", code: "forbidden" });
  });

  it("throws SchemaChatError('genericError') on a network failure (nothing leaked)", async () => {
    fetchMock.mockRejectedValue(new Error("network down"));

    await expect(
      postSetColumnVisibility("acme", "jobs", "warranty_date", true),
    ).rejects.toMatchObject({ name: "SchemaChatError", code: "genericError" });
  });
});

describe("postEditorChat (Story 5.1, 5.2)", () => {
  it("returns the typed result envelope data on success and posts to /api/schema/edit", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        data: {
          kind: "applied",
          tableKey: "jobs",
          fieldKey: "warranty_date",
          label: "Warranty date",
          assistantText: "Done.",
        },
        error: null,
      }),
    );

    const result = await postEditorChat({
      slug: "acme",
      message: "add a warranty date to Jobs",
      currentTableKey: "jobs",
    });

    expect(result.kind).toBe("applied");
    expect(result.fieldKey).toBe("warranty_date");
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/schema/edit");
    expect(JSON.parse(init.body as string)).toMatchObject({
      slug: "acme",
      message: "add a warranty date to Jobs",
      currentTableKey: "jobs",
    });
  });

  it("returns an add-table applied result (tableKey, no fieldKey)", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        data: {
          kind: "applied",
          tableKey: "employee_timesheets",
          label: "Employee timesheets",
          assistantText: "Done. I created Employee timesheets.",
        },
        error: null,
      }),
    );

    const result = await postEditorChat({
      slug: "acme",
      message: "add a table for employee timesheets",
    });

    expect(result.kind).toBe("applied");
    expect(result.tableKey).toBe("employee_timesheets");
    expect(result.fieldKey).toBeUndefined();
  });

  it("returns an add-view applied result (viewKey, no fieldKey)", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        data: {
          kind: "applied",
          viewKey: "unpaid_invoices",
          label: "Unpaid invoices",
          assistantText: "Done. I created the Unpaid invoices view.",
        },
        error: null,
      }),
    );

    const result = await postEditorChat({
      slug: "acme",
      message: "show me unpaid invoices sorted by date",
    });

    expect(result.kind).toBe("applied");
    expect(result.viewKey).toBe("unpaid_invoices");
    expect(result.fieldKey).toBeUndefined();
    expect(result.tableKey).toBeUndefined();
  });

  it("throws SchemaChatError with the server code on a transport/auth failure", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ data: null, error: "forbidden" }, false, 403),
    );

    await expect(
      postEditorChat({ slug: "acme", message: "add a column" }),
    ).rejects.toMatchObject({ name: "SchemaChatError", code: "forbidden" });
  });

  it("maps a network failure to SchemaChatError('genericError')", async () => {
    fetchMock.mockRejectedValue(new Error("offline"));

    await expect(
      postEditorChat({ slug: "acme", message: "add a column" }),
    ).rejects.toBeInstanceOf(SchemaChatError);
  });
});

describe("postRemoveView / postRestoreView (Story 5.6)", () => {
  const view: ViewDefinition = {
    key: "unpaid_invoices",
    label: "Unpaid invoices",
    sourceTableKey: "invoices",
    filters: [{ field: "status", operator: "equals", value: "unpaid" }],
    sort: { field: "due_date", direction: "desc" },
  };

  it("postRemoveView POSTs action:remove + viewKey and returns the removed def", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ data: { action: "remove", view }, error: null }),
    );

    await expect(postRemoveView("acme", "unpaid_invoices")).resolves.toEqual(view);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/schema/views");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toEqual({
      slug: "acme",
      action: "remove",
      viewKey: "unpaid_invoices",
    });
  });

  it("postRestoreView POSTs action:restore + the view payload", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ data: { action: "restore", viewKey: "unpaid_invoices" }, error: null }),
    );

    await expect(postRestoreView("acme", view)).resolves.toBeUndefined();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/schema/views");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toEqual({
      slug: "acme",
      action: "restore",
      view: {
        label: "Unpaid invoices",
        sourceTableKey: "invoices",
        filters: [{ field: "status", operator: "equals", value: "unpaid" }],
        sort: { field: "due_date", direction: "desc" },
      },
    });
  });

  it("postRemoveView throws SchemaChatError with the server code on a forbidden write", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ data: null, error: "forbidden" }, false, 403),
    );

    await expect(postRemoveView("acme", "unpaid_invoices")).rejects.toMatchObject({
      name: "SchemaChatError",
      code: "forbidden",
    });
  });

  it("postRestoreView throws SchemaChatError('genericError') on a network failure", async () => {
    fetchMock.mockRejectedValue(new Error("network down"));

    await expect(postRestoreView("acme", view)).rejects.toMatchObject({
      name: "SchemaChatError",
      code: "genericError",
    });
  });
});
