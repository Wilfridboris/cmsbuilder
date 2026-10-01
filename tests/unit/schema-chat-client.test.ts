import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  postAddFieldChat,
  postUndoHideColumn,
  SchemaChatError,
} from "@/lib/data/schema-chat-client";

/**
 * Unit coverage for the conversational chat client wrappers (Story 5.1). Mocks
 * `global.fetch` only — no network. Locks the frozen I/O & Edge-Case Matrix row the
 * route tests cannot reach: "Undo a just-added column" (the chat's Undo targets the
 * just-added field through the existing append-only `/api/schema/columns` hide path
 * with `hidden: true`). Also covers `postAddFieldChat` success / transport-failure
 * mapping so a raw error, stack, or SQL never reaches the UI.
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

describe("postUndoHideColumn (Story 5.1 — Undo a just-added column)", () => {
  it("POSTs the just-added field to the column-hide path with hidden: true", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ data: { hidden: true }, error: null }));

    await expect(
      postUndoHideColumn("acme", "jobs", "warranty_date"),
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

  it("throws SchemaChatError carrying the server error code on a failed hide", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ data: null, error: "forbidden" }, false, 403),
    );

    await expect(
      postUndoHideColumn("acme", "jobs", "warranty_date"),
    ).rejects.toMatchObject({ name: "SchemaChatError", code: "forbidden" });
  });

  it("throws SchemaChatError('genericError') on a network failure (nothing leaked)", async () => {
    fetchMock.mockRejectedValue(new Error("network down"));

    await expect(
      postUndoHideColumn("acme", "jobs", "warranty_date"),
    ).rejects.toMatchObject({ name: "SchemaChatError", code: "genericError" });
  });
});

describe("postAddFieldChat (Story 5.1)", () => {
  it("returns the typed result envelope data on success", async () => {
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

    const result = await postAddFieldChat({
      slug: "acme",
      message: "add a warranty date to Jobs",
      currentTableKey: "jobs",
    });

    expect(result.kind).toBe("applied");
    expect(result.fieldKey).toBe("warranty_date");
    const [, init] = fetchMock.mock.calls[0];
    expect(JSON.parse(init.body as string)).toMatchObject({
      slug: "acme",
      message: "add a warranty date to Jobs",
      currentTableKey: "jobs",
    });
  });

  it("throws SchemaChatError with the server code on a transport/auth failure", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ data: null, error: "forbidden" }, false, 403),
    );

    await expect(
      postAddFieldChat({ slug: "acme", message: "add a column" }),
    ).rejects.toMatchObject({ name: "SchemaChatError", code: "forbidden" });
  });

  it("maps a network failure to SchemaChatError('genericError')", async () => {
    fetchMock.mockRejectedValue(new Error("offline"));

    await expect(
      postAddFieldChat({ slug: "acme", message: "add a column" }),
    ).rejects.toBeInstanceOf(SchemaChatError);
  });
});
