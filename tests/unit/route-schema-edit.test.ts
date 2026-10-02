import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";

/**
 * Unit coverage for `POST /api/schema/edit` (Story 5.1 add a column, 5.2 add a
 * table, 5.3 add a view, 5.5 hide a column / safe handling of unsupported ops)
 * WITHOUT a live DB, LLM, or auth provider. Locks the frozen I/O & Edge-Case
 * Matrix rows that live in the handler (the pure validator/transform are covered in
 * schema-add-field.test.ts / schema-add-table.test.ts), end-to-end through the REAL
 * `requireAdmin` + `resolveUserOrgMembership` (only the caller identity, the admin
 * client, the RLS org lookup, the schema read, the Gemini call, and the guarded
 * `addField`/`addTable`/`addView`/`setFieldVisibility` are mocked):
 *   - unauthenticated                        → 401, no LLM, no write;
 *   - malformed body                         → 400, no LLM, no write;
 *   - Member (non-admin) of the target org   → 403, no LLM, no write;
 *   - Admin of a DIFFERENT org than `slug`   → 403, no LLM, no write;
 *   - applied add_field                      → 200 { kind: 'applied', tableKey, fieldKey }, field write ran;
 *   - applied add_table                      → 200 { kind: 'applied', tableKey, no fieldKey }, table write ran;
 *   - needs_clarification                    → 200 { kind: 'clarify' }, NO write;
 *   - out_of_scope                           → 200 { kind: 'declined' }, NO write;
 *   - validator rejection (addFieldFailed)   → 200 { kind: 'rejected' }, translated copy, no raw leak;
 *   - LLM timeout/failure                    → 200 { kind: 'degraded' }, NO write, nothing leaked.
 *
 * Mirrors `route-schema-fields.test.ts`. `next-intl/server` is mocked to echo the
 * copy KEY so assistant text is assertable without the catalog.
 */

const getCurrentUser = vi.fn();
const addField = vi.fn();
const addTable = vi.fn();
const addView = vi.fn();
const removeView = vi.fn();
const setFieldVisibility = vi.fn();
const getSchema = vi.fn();
const callGeminiWithTimeout = vi.fn();

type MaybeSingle = { data: unknown; error: unknown };
let membershipRead: MaybeSingle;
let adminOrgRead: MaybeSingle;
let rlsOrgRead: MaybeSingle;

function makeAdminClient() {
  return {
    from(table: string) {
      if (table === "organizations") {
        return {
          select: () => ({
            eq: () => ({ maybeSingle: async () => adminOrgRead }),
          }),
        };
      }
      return {
        select: () => ({
          eq: () => ({
            order: () => ({
              limit: () => ({ maybeSingle: async () => membershipRead }),
            }),
          }),
        }),
      };
    },
  };
}

function makeRlsClient() {
  return {
    from() {
      return {
        select: () => ({
          eq: () => ({ maybeSingle: async () => rlsOrgRead }),
        }),
      };
    },
  };
}

vi.mock("@/lib/auth/session", () => ({ getCurrentUser }));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => makeAdminClient(),
}));
vi.mock("@/lib/supabase/server", () => ({
  createServerSupabaseClient: () => makeRlsClient(),
}));
vi.mock("next/headers", () => ({ cookies: async () => ({}) }));
vi.mock("@/lib/data/schema-mutate", () => ({
  addField,
  addTable,
  addView,
  removeView,
  setFieldVisibility,
}));
vi.mock("@/lib/data/records", () => ({ getSchema }));
vi.mock("@/lib/gemini/client", () => ({ callGeminiWithTimeout }));
vi.mock("@/lib/observability/report", () => ({
  reportError: vi.fn(),
  reportRejection: vi.fn(),
}));
vi.mock("next-intl/server", () => ({
  getTranslations: async () => (key: string) => key,
}));

function postReq(body: unknown): NextRequest {
  return { json: async () => body } as unknown as NextRequest;
}

const validBody = { slug: "acme", message: "add a warranty date to Jobs" };

beforeEach(() => {
  vi.clearAllMocks();
  getCurrentUser.mockResolvedValue({ id: "user-1", email: "admin@example.ca" });
  membershipRead = {
    data: { organization_id: "org-1", role: "admin" },
    error: null,
  };
  adminOrgRead = { data: { slug: "acme" }, error: null };
  rlsOrgRead = {
    data: { id: "org-1", subscription_status: "trial", trial_expires_at: null },
    error: null,
  };
  getSchema.mockResolvedValue({
    data: {
      tables: [
        {
          key: "jobs",
          label: "Jobs",
          fields: [
            { key: "status", label: "Status", type: "text" },
            { key: "notes", label: "Notes", type: "text" },
          ],
        },
      ],
      views: [
        {
          key: "unpaid_jobs",
          label: "Unpaid jobs",
          sourceTableKey: "jobs",
          filters: [{ field: "status", operator: "equals", value: "unpaid" }],
          sort: null,
        },
      ],
    },
    error: null,
  });
  callGeminiWithTimeout.mockResolvedValue({
    kind: "add_field",
    tableKey: "jobs",
    label: "Warranty date",
    type: "date",
  });
  addField.mockResolvedValue({
    data: { tableKey: "jobs", fieldKey: "warranty_date" },
    error: null,
  });
  addTable.mockResolvedValue({
    data: { tableKey: "employee_timesheets" },
    error: null,
  });
  addView.mockResolvedValue({
    data: { viewKey: "unpaid_jobs" },
    error: null,
  });
  removeView.mockResolvedValue({
    data: {
      view: {
        key: "unpaid_jobs",
        label: "Unpaid jobs",
        sourceTableKey: "jobs",
        filters: [{ field: "status", operator: "equals", value: "unpaid" }],
        sort: null,
      },
    },
    error: null,
  });
  setFieldVisibility.mockResolvedValue({
    data: { tableKey: "jobs", fieldKey: "notes", hidden: true },
    error: null,
  });
});

describe("POST /api/schema/edit", () => {
  it("applied: valid Admin add_field → 200 applied, guarded field write ran", async () => {
    const { POST } = await import("@/app/api/schema/edit/route");
    const res = await POST(postReq(validBody));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.error).toBeNull();
    expect(body.data.kind).toBe("applied");
    expect(body.data.tableKey).toBe("jobs");
    expect(body.data.fieldKey).toBe("warranty_date");
    // Undo of an add-column HIDES it; the client gates its Undo on this direction.
    expect(body.data.undo).toBe("hide");
    expect(addField).toHaveBeenCalledTimes(1);
    expect(addTable).not.toHaveBeenCalled();
    const call = addField.mock.calls[0];
    expect(call[0]).toEqual(
      expect.objectContaining({ actorId: "user-1", orgId: "org-1" }),
    );
    expect(call[1]).toBe("jobs");
    expect(call[2]).toEqual({ label: "Warranty date", type: "date" });
  });

  it("applied: valid Admin add_table → 200 applied (tableKey, no fieldKey), table write ran", async () => {
    const { POST } = await import("@/app/api/schema/edit/route");
    callGeminiWithTimeout.mockResolvedValue({
      kind: "add_table",
      label: "Employee timesheets",
      fields: [
        { label: "Employee name", type: "text" },
        { label: "Hours worked", type: "number" },
      ],
    });

    const res = await POST(
      postReq({ slug: "acme", message: "add a table for employee timesheets" }),
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.error).toBeNull();
    expect(body.data.kind).toBe("applied");
    expect(body.data.tableKey).toBe("employee_timesheets");
    // No fieldKey / no undo on a table add → the client shows no Undo.
    expect(body.data.fieldKey).toBeUndefined();
    expect(body.data.undo).toBeUndefined();
    expect(addTable).toHaveBeenCalledTimes(1);
    expect(addField).not.toHaveBeenCalled();
    const call = addTable.mock.calls[0];
    expect(call[0]).toEqual(
      expect.objectContaining({ actorId: "user-1", orgId: "org-1" }),
    );
    expect(call[1]).toEqual({
      label: "Employee timesheets",
      fields: [
        { label: "Employee name", type: "text" },
        { label: "Hours worked", type: "number" },
      ],
    });
  });

  it("applied: valid Admin add_view → 200 applied (viewKey, no fieldKey), view write ran", async () => {
    const { POST } = await import("@/app/api/schema/edit/route");
    callGeminiWithTimeout.mockResolvedValue({
      kind: "add_view",
      label: "Unpaid jobs",
      sourceTableKey: "jobs",
      filters: [{ field: "status", operator: "equals", value: "unpaid" }],
      sort: { field: "status", direction: "asc" },
    });

    const res = await POST(
      postReq({ slug: "acme", message: "show me unpaid jobs" }),
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.error).toBeNull();
    expect(body.data.kind).toBe("applied");
    expect(body.data.viewKey).toBe("unpaid_jobs");
    // Story 5.6: an add-view now carries undo:"remove" + the viewKey so the chat
    // bubble offers an Undo that removes the just-added view. No fieldKey.
    expect(body.data.fieldKey).toBeUndefined();
    expect(body.data.undo).toBe("remove");
    expect(addView).toHaveBeenCalledTimes(1);
    expect(addField).not.toHaveBeenCalled();
    expect(addTable).not.toHaveBeenCalled();
    const call = addView.mock.calls[0];
    expect(call[0]).toEqual(
      expect.objectContaining({ actorId: "user-1", orgId: "org-1" }),
    );
    expect(call[1]).toEqual({
      label: "Unpaid jobs",
      sourceTableKey: "jobs",
      filters: [
        { field: "status", operator: "equals", value: "unpaid", value2: undefined },
      ],
      sort: { field: "status", direction: "asc" },
    });
  });

  it("rejected: a shapeless add_view (missing label / source / non-array filters) → 200 rejected, addView NOT called", async () => {
    const { POST } = await import("@/app/api/schema/edit/route");

    // Missing sourceTableKey.
    callGeminiWithTimeout.mockResolvedValue({
      kind: "add_view",
      label: "A view",
      filters: [],
      sort: null,
    });
    let res = await POST(postReq({ slug: "acme", message: "a view" }));
    expect(res.status).toBe(200);
    expect((await res.json()).data.kind).toBe("rejected");

    // Non-array filters.
    callGeminiWithTimeout.mockResolvedValue({
      kind: "add_view",
      label: "A view",
      sourceTableKey: "jobs",
      filters: "nope",
      sort: null,
    });
    res = await POST(postReq({ slug: "acme", message: "a view of jobs" }));
    expect(res.status).toBe(200);
    expect((await res.json()).data.kind).toBe("rejected");

    expect(addView).not.toHaveBeenCalled();
  });

  it("rejected: an add_view validator rejection → 200 rejected with fixed copy, no raw leak", async () => {
    const { AppError } = await import("@/types/api");
    const { POST } = await import("@/app/api/schema/edit/route");
    callGeminiWithTimeout.mockResolvedValue({
      kind: "add_view",
      label: "Empty",
      sourceTableKey: "jobs",
      filters: [],
      sort: null,
    });
    addView.mockRejectedValue(new AppError(400, "addViewFailed"));

    const res = await POST(
      postReq({ slug: "acme", message: "a degenerate view" }),
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.kind).toBe("rejected");
    expect(body.data.assistantText).toBe("rejection");
    expect(body.data.assistantText).not.toContain("addViewFailed");
    expect(addField).not.toHaveBeenCalled();
  });

  it("rejected: a shapeless add_table (missing label / non-array fields) → 200 rejected, addTable NOT called", async () => {
    const { POST } = await import("@/app/api/schema/edit/route");

    // Missing label.
    callGeminiWithTimeout.mockResolvedValue({
      kind: "add_table",
      fields: [{ label: "Title", type: "text" }],
    });
    let res = await POST(postReq({ slug: "acme", message: "add a table" }));
    expect(res.status).toBe(200);
    expect((await res.json()).data.kind).toBe("rejected");

    // Non-array fields.
    callGeminiWithTimeout.mockResolvedValue({
      kind: "add_table",
      label: "Timesheets",
      fields: "nope",
    });
    res = await POST(postReq({ slug: "acme", message: "add a timesheets table" }));
    expect(res.status).toBe(200);
    expect((await res.json()).data.kind).toBe("rejected");

    // The shape guard runs before the mutate layer — addTable is never called.
    expect(addTable).not.toHaveBeenCalled();
  });

  it("rejected: an add_table validator rejection → 200 rejected with fixed copy, no raw leak, no field write", async () => {
    const { AppError } = await import("@/types/api");
    const { POST } = await import("@/app/api/schema/edit/route");
    callGeminiWithTimeout.mockResolvedValue({
      kind: "add_table",
      label: "drop",
      fields: [{ label: "Title", type: "text" }],
    });
    addTable.mockRejectedValue(new AppError(400, "addTableFailed"));

    const res = await POST(
      postReq({ slug: "acme", message: "add a table called drop" }),
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.kind).toBe("rejected");
    expect(body.data.assistantText).toBe("rejection");
    expect(body.data.assistantText).not.toContain("addTableFailed");
    expect(addField).not.toHaveBeenCalled();
  });

  it("rejected: an out-of-allowlist kind → 200 rejected, no write, reportRejection logged", async () => {
    const { reportRejection } = await import("@/lib/observability/report");
    vi.mocked(reportRejection).mockClear();
    const { POST } = await import("@/app/api/schema/edit/route");
    // A kind the model should never emit (and the enum forbids) — the explicit
    // allowlist fence must reject it before any dispatch or write.
    callGeminiWithTimeout.mockResolvedValue({
      kind: "delete_table",
      tableKey: "jobs",
    });

    const res = await POST(
      postReq({ slug: "acme", message: "delete the jobs table" }),
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.kind).toBe("rejected");
    expect(body.data.assistantText).toBe("rejection");
    expect(body.data.assistantText).not.toContain("delete_table");
    expect(addField).not.toHaveBeenCalled();
    expect(addTable).not.toHaveBeenCalled();
    expect(addView).not.toHaveBeenCalled();
    // Logged with the org id + raw output (FR45).
    expect(reportRejection).toHaveBeenCalledTimes(1);
    expect(vi.mocked(reportRejection).mock.calls[0][1]).toEqual(
      expect.objectContaining({ id: "org-1" }),
    );
  });

  it("rejected: raw SQL in a permitted op's output → 200 rejected, no write, reportRejection logged", async () => {
    const { reportRejection } = await import("@/lib/observability/report");
    vi.mocked(reportRejection).mockClear();
    const { POST } = await import("@/app/api/schema/edit/route");
    // A well-formed add_field whose output smuggles raw SQL — the raw-SQL discard
    // guard must fire before the write.
    callGeminiWithTimeout.mockResolvedValue({
      kind: "add_field",
      tableKey: "jobs",
      label: "Notes",
      type: "text",
      smuggled: "DROP TABLE records;",
    });

    const res = await POST(
      postReq({ slug: "acme", message: "add notes to jobs" }),
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.kind).toBe("rejected");
    expect(body.data.assistantText).toBe("rejection");
    expect(body.data.assistantText).not.toContain("DROP");
    expect(addField).not.toHaveBeenCalled();
    expect(reportRejection).toHaveBeenCalled();
  });

  it("applied: hide_field → 200 applied (undo: show), setFieldVisibility(true) ran, no destructive write", async () => {
    const { POST } = await import("@/app/api/schema/edit/route");
    callGeminiWithTimeout.mockResolvedValue({
      kind: "hide_field",
      tableKey: "jobs",
      fieldKey: "notes",
    });

    const res = await POST(
      postReq({ slug: "acme", message: "delete the Notes column from Jobs" }),
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.error).toBeNull();
    expect(body.data.kind).toBe("applied");
    expect(body.data.tableKey).toBe("jobs");
    expect(body.data.fieldKey).toBe("notes");
    // A hide offers a show-again Undo.
    expect(body.data.undo).toBe("show");
    // The reassuring, non-technical copy names the column + table.
    expect(body.data.assistantText).toBe("columnHidden");
    // The hide is a metadata-only visibility flip — no add op ran.
    expect(setFieldVisibility).toHaveBeenCalledTimes(1);
    expect(addField).not.toHaveBeenCalled();
    expect(addTable).not.toHaveBeenCalled();
    expect(addView).not.toHaveBeenCalled();
    const call = setFieldVisibility.mock.calls[0];
    expect(call[0]).toEqual(
      expect.objectContaining({ actorId: "user-1", orgId: "org-1" }),
    );
    expect(call[1]).toBe("jobs");
    expect(call[2]).toBe("notes");
    // hidden=true — the hide direction, never a delete.
    expect(call[3]).toBe(true);
  });

  it("rejected: a shapeless hide_field (missing tableKey/fieldKey) → 200 rejected, no write", async () => {
    const { POST } = await import("@/app/api/schema/edit/route");

    callGeminiWithTimeout.mockResolvedValue({ kind: "hide_field", tableKey: "jobs" });
    let res = await POST(postReq({ slug: "acme", message: "remove a column" }));
    expect(res.status).toBe(200);
    expect((await res.json()).data.kind).toBe("rejected");

    callGeminiWithTimeout.mockResolvedValue({ kind: "hide_field", fieldKey: "notes" });
    res = await POST(postReq({ slug: "acme", message: "remove notes" }));
    expect(res.status).toBe(200);
    expect((await res.json()).data.kind).toBe("rejected");

    expect(setFieldVisibility).not.toHaveBeenCalled();
  });

  it("declined: hide_field on a field NOT in the visible summary (unknown key) → 200 declined, NO mutator call", async () => {
    const { POST } = await import("@/app/api/schema/edit/route");
    callGeminiWithTimeout.mockResolvedValue({
      kind: "hide_field",
      tableKey: "jobs",
      fieldKey: "ghost",
    });

    const res = await POST(
      postReq({ slug: "acme", message: "delete the ghost column from Jobs" }),
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    // A key the model was never shown is not a hideable target: reassure, write
    // nothing, and never reach the mutator.
    expect(body.data.kind).toBe("declined");
    expect(body.data.assistantText).toBe("declineFallback");
    expect(setFieldVisibility).not.toHaveBeenCalled();
  });

  it("declined: hide_field targeting a relation / already-hidden column (not in the visible-scalar summary) → 200 declined, NO mutator call", async () => {
    const { POST } = await import("@/app/api/schema/edit/route");
    // The schema has a hidden column and a relation column; the route's summary
    // exposes only visible SCALAR fields, so neither is a hideable target.
    getSchema.mockResolvedValue({
      data: {
        tables: [
          {
            key: "jobs",
            label: "Jobs",
            fields: [
              { key: "status", label: "Status", type: "text" },
              { key: "archived_notes", label: "Archived notes", type: "text", hidden: true },
              { key: "client", label: "Client", type: "relation" },
            ],
          },
        ],
      },
      error: null,
    });

    for (const fieldKey of ["archived_notes", "client"]) {
      callGeminiWithTimeout.mockResolvedValue({
        kind: "hide_field",
        tableKey: "jobs",
        fieldKey,
      });
      const res = await POST(
        postReq({ slug: "acme", message: `delete the ${fieldKey} column` }),
      );
      expect(res.status).toBe(200);
      expect((await res.json()).data.kind).toBe("declined");
    }
    expect(setFieldVisibility).not.toHaveBeenCalled();
  });

  it("declined: hide_field of an in-summary field but the mutator 400s (stale/race) → 200 declined, reassuring, no raw leak", async () => {
    const { AppError } = await import("@/types/api");
    const { POST } = await import("@/app/api/schema/edit/route");
    callGeminiWithTimeout.mockResolvedValue({
      kind: "hide_field",
      tableKey: "jobs",
      fieldKey: "notes",
    });
    // The field is in the summary, but the mutator still 400s (e.g. concurrently
    // removed). The catch maps it to a graceful decline, never an error or raw detail.
    setFieldVisibility.mockRejectedValue(new AppError(400, "genericError"));

    const res = await POST(
      postReq({ slug: "acme", message: "delete the Notes column from Jobs" }),
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.kind).toBe("declined");
    expect(body.data.assistantText).toBe("declineFallback");
    expect(body.data.assistantText).not.toContain("genericError");
  });

  it("degraded: hide_field when the mutator throws a 5xx → 200 degraded, no raw detail leaked", async () => {
    const { AppError } = await import("@/types/api");
    const { POST } = await import("@/app/api/schema/edit/route");
    callGeminiWithTimeout.mockResolvedValue({
      kind: "hide_field",
      tableKey: "jobs",
      fieldKey: "notes",
    });
    setFieldVisibility.mockRejectedValue(
      new AppError(500, "writeFailed", "boom raw detail"),
    );

    const res = await POST(
      postReq({ slug: "acme", message: "delete the Notes column from Jobs" }),
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.kind).toBe("degraded");
    expect(body.data.assistantText).toBe("degraded");
    expect(body.data.assistantText).not.toContain("boom");
  });

  it("rejected: raw SQL in a hide_field output → 200 rejected, no write, reportRejection logged", async () => {
    const { reportRejection } = await import("@/lib/observability/report");
    vi.mocked(reportRejection).mockClear();
    const { POST } = await import("@/app/api/schema/edit/route");
    callGeminiWithTimeout.mockResolvedValue({
      kind: "hide_field",
      tableKey: "jobs",
      fieldKey: "notes",
      smuggled: "DROP TABLE records;",
    });

    const res = await POST(
      postReq({ slug: "acme", message: "delete notes from jobs" }),
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.kind).toBe("rejected");
    expect(body.data.assistantText).toBe("rejection");
    expect(body.data.assistantText).not.toContain("DROP");
    expect(setFieldVisibility).not.toHaveBeenCalled();
    expect(reportRejection).toHaveBeenCalled();
  });

  it("applied: remove_view (in-summary key) → 200 applied naming the view, removeView ran, no other write", async () => {
    const { POST } = await import("@/app/api/schema/edit/route");
    callGeminiWithTimeout.mockResolvedValue({
      kind: "remove_view",
      viewKey: "unpaid_jobs",
    });

    const res = await POST(
      postReq({ slug: "acme", message: "remove the Unpaid jobs view" }),
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.error).toBeNull();
    expect(body.data.kind).toBe("applied");
    expect(body.data.viewKey).toBe("unpaid_jobs");
    // The success copy names the view (never a raw key).
    expect(body.data.assistantText).toBe("viewRemoved");
    expect(removeView).toHaveBeenCalledTimes(1);
    const call = removeView.mock.calls[0];
    expect(call[0]).toEqual(
      expect.objectContaining({ actorId: "user-1", orgId: "org-1" }),
    );
    expect(call[1]).toBe("unpaid_jobs");
    expect(addField).not.toHaveBeenCalled();
    expect(addTable).not.toHaveBeenCalled();
    expect(addView).not.toHaveBeenCalled();
    expect(setFieldVisibility).not.toHaveBeenCalled();
  });

  it("rejected: a shapeless remove_view (missing viewKey) → 200 rejected, removeView NOT called", async () => {
    const { POST } = await import("@/app/api/schema/edit/route");
    callGeminiWithTimeout.mockResolvedValue({ kind: "remove_view" });

    const res = await POST(postReq({ slug: "acme", message: "remove a view" }));

    expect(res.status).toBe(200);
    expect((await res.json()).data.kind).toBe("rejected");
    expect(removeView).not.toHaveBeenCalled();
  });

  it("declined: remove_view with an out-of-summary (stale/hallucinated) key → 200 declined, NO mutator call", async () => {
    const { POST } = await import("@/app/api/schema/edit/route");
    callGeminiWithTimeout.mockResolvedValue({
      kind: "remove_view",
      viewKey: "ghost_view",
    });

    const res = await POST(
      postReq({ slug: "acme", message: "remove the ghost view" }),
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.kind).toBe("declined");
    expect(body.data.assistantText).toBe("declineFallback");
    expect(removeView).not.toHaveBeenCalled();
  });

  it("declined: remove_view of an in-summary view but the mutator 400s (stale/race) → 200 declined, no raw leak", async () => {
    const { AppError } = await import("@/types/api");
    const { POST } = await import("@/app/api/schema/edit/route");
    callGeminiWithTimeout.mockResolvedValue({
      kind: "remove_view",
      viewKey: "unpaid_jobs",
    });
    removeView.mockRejectedValue(new AppError(400, "removeViewFailed"));

    const res = await POST(
      postReq({ slug: "acme", message: "remove the Unpaid jobs view" }),
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.kind).toBe("declined");
    expect(body.data.assistantText).toBe("declineFallback");
  });

  it("degraded: remove_view when the mutator throws a 5xx → 200 degraded, no raw detail leaked", async () => {
    const { AppError } = await import("@/types/api");
    const { POST } = await import("@/app/api/schema/edit/route");
    callGeminiWithTimeout.mockResolvedValue({
      kind: "remove_view",
      viewKey: "unpaid_jobs",
    });
    removeView.mockRejectedValue(new AppError(500, "writeFailed", "boom raw detail"));

    const res = await POST(
      postReq({ slug: "acme", message: "remove the Unpaid jobs view" }),
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.kind).toBe("degraded");
    expect(body.data.assistantText).toBe("degraded");
    expect(body.data.assistantText).not.toContain("boom");
  });

  it("rejected: raw SQL in a remove_view output → 200 rejected, no write, reportRejection logged", async () => {
    const { reportRejection } = await import("@/lib/observability/report");
    vi.mocked(reportRejection).mockClear();
    const { POST } = await import("@/app/api/schema/edit/route");
    callGeminiWithTimeout.mockResolvedValue({
      kind: "remove_view",
      viewKey: "unpaid_jobs",
      smuggled: "DROP TABLE records;",
    });

    const res = await POST(
      postReq({ slug: "acme", message: "remove the unpaid view" }),
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.kind).toBe("rejected");
    expect(body.data.assistantText).toBe("rejection");
    expect(body.data.assistantText).not.toContain("DROP");
    expect(removeView).not.toHaveBeenCalled();
    expect(reportRejection).toHaveBeenCalled();
  });

  it("declined: delete-a-table stays out_of_scope → 200 declined, NO write", async () => {
    const { POST } = await import("@/app/api/schema/edit/route");
    callGeminiWithTimeout.mockResolvedValue({
      kind: "out_of_scope",
      reply: "To keep your data safe, I can't delete a whole table.",
    });

    const res = await POST(
      postReq({ slug: "acme", message: "delete the Jobs table" }),
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.kind).toBe("declined");
    expect(setFieldVisibility).not.toHaveBeenCalled();
    expect(addField).not.toHaveBeenCalled();
    expect(addTable).not.toHaveBeenCalled();
    expect(addView).not.toHaveBeenCalled();
  });

  it("declined: rename stays out_of_scope → 200 declined, NO write", async () => {
    const { POST } = await import("@/app/api/schema/edit/route");
    callGeminiWithTimeout.mockResolvedValue({
      kind: "out_of_scope",
      reply: "I can't rename columns yet.",
    });

    const res = await POST(
      postReq({ slug: "acme", message: "rename Notes to Comments" }),
    );

    expect(res.status).toBe(200);
    expect((await res.json()).data.kind).toBe("declined");
    expect(setFieldVisibility).not.toHaveBeenCalled();
  });

  it("401 unauthorized when there is no session, no LLM call, no write", async () => {
    const { POST } = await import("@/app/api/schema/edit/route");
    getCurrentUser.mockResolvedValue(null);

    const res = await POST(postReq(validBody));

    expect(res.status).toBe(401);
    expect((await res.json()).error).toBe("unauthorized");
    expect(callGeminiWithTimeout).not.toHaveBeenCalled();
    expect(addField).not.toHaveBeenCalled();
  });

  it("400 on a malformed body (missing message), no LLM, no write", async () => {
    const { POST } = await import("@/app/api/schema/edit/route");
    const res = await POST(postReq({ slug: "acme" }));

    expect(res.status).toBe(400);
    expect(callGeminiWithTimeout).not.toHaveBeenCalled();
    expect(addField).not.toHaveBeenCalled();
  });

  it("403 when the caller is a Member (not Admin), no LLM, no write", async () => {
    const { POST } = await import("@/app/api/schema/edit/route");
    membershipRead = {
      data: { organization_id: "org-1", role: "member" },
      error: null,
    };

    const res = await POST(postReq(validBody));

    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe("forbidden");
    expect(callGeminiWithTimeout).not.toHaveBeenCalled();
    expect(addField).not.toHaveBeenCalled();
  });

  it("403 when the caller is Admin of a DIFFERENT org than the slug", async () => {
    const { POST } = await import("@/app/api/schema/edit/route");
    adminOrgRead = { data: { slug: "other-org" }, error: null };

    const res = await POST(postReq(validBody));

    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe("forbidden");
    expect(callGeminiWithTimeout).not.toHaveBeenCalled();
    expect(addField).not.toHaveBeenCalled();
  });

  it("clarify: needs_clarification → 200 clarify, NO write", async () => {
    const { POST } = await import("@/app/api/schema/edit/route");
    callGeminiWithTimeout.mockResolvedValue({
      kind: "needs_clarification",
      question: "Which table should Price go on - Jobs or Clients?",
    });

    const res = await POST(postReq({ slug: "acme", message: "add a price field" }));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.kind).toBe("clarify");
    expect(body.data.assistantText).toContain("Which table");
    expect(addField).not.toHaveBeenCalled();
  });

  it("declined: out_of_scope → 200 declined, NO write", async () => {
    const { POST } = await import("@/app/api/schema/edit/route");
    callGeminiWithTimeout.mockResolvedValue({
      kind: "out_of_scope",
      reply: "I can only add a column right now.",
    });

    const res = await POST(
      postReq({ slug: "acme", message: "delete the status column" }),
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.kind).toBe("declined");
    expect(addField).not.toHaveBeenCalled();
  });

  it("rejected: validator rejection → 200 rejected with fixed copy, no raw leak", async () => {
    const { AppError } = await import("@/types/api");
    const { POST } = await import("@/app/api/schema/edit/route");
    addField.mockRejectedValue(new AppError(400, "addFieldFailed"));

    const res = await POST(postReq(validBody));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.kind).toBe("rejected");
    expect(body.data.assistantText).toBe("rejection");
    expect(body.data.assistantText).not.toContain("addFieldFailed");
  });

  it("degraded: LLM timeout → 200 degraded, NO write, nothing leaked", async () => {
    const { POST } = await import("@/app/api/schema/edit/route");
    callGeminiWithTimeout.mockRejectedValue(new Error("Gemini timeout"));

    const res = await POST(postReq(validBody));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.kind).toBe("degraded");
    expect(body.data.assistantText).toBe("degraded");
    expect(addField).not.toHaveBeenCalled();
  });

  it("degraded: a write 5xx degrades gracefully (CRUD unaffected)", async () => {
    const { AppError } = await import("@/types/api");
    const { POST } = await import("@/app/api/schema/edit/route");
    addField.mockRejectedValue(new AppError(500, "writeFailed", "boom sql"));

    const res = await POST(postReq(validBody));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.kind).toBe("degraded");
    expect(body.data.assistantText).not.toContain("boom");
  });
});
