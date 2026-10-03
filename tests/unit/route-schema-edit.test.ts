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
const addSelectOption = vi.fn();
const renameSelectOption = vi.fn();
const archiveSelectOption = vi.fn();
const getSchema = vi.fn();
const callGeminiWithTimeout = vi.fn();
// Default: echo the key (most assertions compare the bare key). Individual tests
// override with `mockImplementationOnce` to observe the interpolation arguments.
const getTranslations = vi.fn(async () => (key: string) => key);

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
  addSelectOption,
  renameSelectOption,
  archiveSelectOption,
}));
vi.mock("@/lib/data/records", () => ({ getSchema }));
vi.mock("@/lib/gemini/client", () => ({ callGeminiWithTimeout }));
vi.mock("@/lib/observability/report", () => ({
  reportError: vi.fn(),
  reportRejection: vi.fn(),
}));
vi.mock("next-intl/server", () => ({ getTranslations }));

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
  addSelectOption.mockResolvedValue({
    data: {
      tableKey: "invoices",
      fieldKey: "status",
      value: "partial",
      label: "Partial",
    },
    error: null,
  });
  renameSelectOption.mockResolvedValue({
    data: {
      tableKey: "invoices",
      fieldKey: "status",
      value: "paid",
      label: "Settled",
    },
    error: null,
  });
  archiveSelectOption.mockResolvedValue({
    data: { tableKey: "invoices", fieldKey: "status", value: "paid" },
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

  it("applied: add_field type:select forwards options into AddFieldInput → 200 applied (Story 13.3)", async () => {
    const { POST } = await import("@/app/api/schema/edit/route");
    // The model named a fixed set of choices, so it emits type:'select' + options.
    callGeminiWithTimeout.mockResolvedValue({
      kind: "add_field",
      tableKey: "jobs",
      label: "Status",
      type: "select",
      options: [
        { label: "Paid", value: "paid" },
        { label: "Unpaid", value: "unpaid" },
        { label: "Rejected", value: "rejected" },
      ],
    });
    addField.mockResolvedValue({
      data: { tableKey: "jobs", fieldKey: "status" },
      error: null,
    });

    const res = await POST(
      postReq({
        slug: "acme",
        message: "add a status field with Paid, Unpaid, Rejected to Jobs",
      }),
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.error).toBeNull();
    expect(body.data.kind).toBe("applied");
    expect(body.data.tableKey).toBe("jobs");
    expect(body.data.fieldKey).toBe("status");
    expect(body.data.undo).toBe("hide");
    expect(addField).toHaveBeenCalledTimes(1);
    const call = addField.mock.calls[0];
    expect(call[1]).toBe("jobs");
    // The select options are threaded verbatim into AddFieldInput so the
    // already-ready validateSelectOptions/addField path (Story 13.1) persists them.
    expect(call[2]).toEqual({
      label: "Status",
      type: "select",
      options: [
        { label: "Paid", value: "paid" },
        { label: "Unpaid", value: "unpaid" },
        { label: "Rejected", value: "rejected" },
      ],
    });
  });

  it("rejected: add_field type:select with malformed options → 200 rejected, fixed copy, no raw leak (Story 13.3)", async () => {
    const { AppError } = await import("@/types/api");
    const { POST } = await import("@/app/api/schema/edit/route");
    // Duplicate values — the Story 13.1 validator rejects via addField's 400.
    callGeminiWithTimeout.mockResolvedValue({
      kind: "add_field",
      tableKey: "jobs",
      label: "Status",
      type: "select",
      options: [
        { label: "Paid", value: "paid" },
        { label: "Paid", value: "paid" },
      ],
    });
    addField.mockRejectedValue(new AppError(400, "addFieldFailed"));

    const res = await POST(
      postReq({ slug: "acme", message: "add a status with Paid, Paid to Jobs" }),
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.error).toBeNull();
    expect(body.data.kind).toBe("rejected");
    expect(body.data.assistantText).toBe("rejection");
    expect(body.data.assistantText).not.toContain("addFieldFailed");
    // The options still reached the guarded mutator (which is where validation
    // lives); the handler itself never short-circuits a select.
    expect(addField).toHaveBeenCalledTimes(1);
    expect(addField.mock.calls[0][2]).toEqual(
      expect.objectContaining({ type: "select" }),
    );
  });

  it("applied: valid Admin add_table → 200 applied (tableKey, undo:hide-table, no fieldKey), table write ran", async () => {
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
    // Story 5.7: the add-table result carries undo:"hide-table" + the new tableKey
    // so the chat bubble offers an Undo that hides the just-added table. No fieldKey.
    expect(body.data.fieldKey).toBeUndefined();
    expect(body.data.undo).toBe("hide-table");
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

  // --- Story 5.7: hide_table (the safe answer to "delete the Jobs table") -----
  // A two-visible-table schema so canHideTable is true (hiding does not empty the
  // dashboard). Only the schema read differs from the default single-table one.
  function twoTableSchemaRead() {
    return {
      data: {
        tables: [
          {
            key: "jobs",
            label: "Jobs",
            fields: [{ key: "status", label: "Status", type: "text" }],
          },
          {
            key: "clients",
            label: "Clients",
            fields: [{ key: "name", label: "Name", type: "text" }],
          },
        ],
        views: [],
      },
      error: null,
    };
  }

  it("confirm: hide_table for an in-summary table (>1 visible) → 200 confirm offer, NO mutation", async () => {
    const { POST } = await import("@/app/api/schema/edit/route");
    getSchema.mockResolvedValue(twoTableSchemaRead());
    callGeminiWithTimeout.mockResolvedValue({
      kind: "hide_table",
      tableKey: "jobs",
    });

    const res = await POST(
      postReq({ slug: "acme", message: "delete the Jobs table" }),
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.error).toBeNull();
    expect(body.data.kind).toBe("confirm");
    expect(body.data.confirm).toBe("hide-table");
    expect(body.data.tableKey).toBe("jobs");
    expect(body.data.label).toBe("Jobs");
    expect(body.data.assistantText).toBe("tableHideOffer");
    // The route NEVER mutates on hide_table — the write runs only on the button
    // click via the direct /api/schema/tables path.
    expect(addTable).not.toHaveBeenCalled();
    expect(setFieldVisibility).not.toHaveBeenCalled();
    expect(removeView).not.toHaveBeenCalled();
  });

  it("declined: hide_table for an out-of-summary (stale/hallucinated) table → 200 declined, NO mutation", async () => {
    const { POST } = await import("@/app/api/schema/edit/route");
    getSchema.mockResolvedValue(twoTableSchemaRead());
    callGeminiWithTimeout.mockResolvedValue({
      kind: "hide_table",
      tableKey: "ghost_table",
    });

    const res = await POST(
      postReq({ slug: "acme", message: "delete the Suppliers table" }),
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.kind).toBe("declined");
    expect(body.data.assistantText).toBe("declineFallback");
    expect(body.data.assistantText).not.toContain("ghost_table");
  });

  it("declined: hide_table of the LAST visible table → 200 declined (tableHideLast), NO mutation", async () => {
    const { POST } = await import("@/app/api/schema/edit/route");
    // Default schema has exactly one visible table (jobs) → canHideTable is false.
    callGeminiWithTimeout.mockResolvedValue({
      kind: "hide_table",
      tableKey: "jobs",
    });

    const res = await POST(
      postReq({ slug: "acme", message: "delete the Jobs table" }),
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.kind).toBe("declined");
    expect(body.data.assistantText).toBe("tableHideLast");
  });

  it("rejected: a shapeless hide_table (missing tableKey) → 200 rejected, NO mutation", async () => {
    const { POST } = await import("@/app/api/schema/edit/route");
    getSchema.mockResolvedValue(twoTableSchemaRead());
    callGeminiWithTimeout.mockResolvedValue({ kind: "hide_table" });

    const res = await POST(
      postReq({ slug: "acme", message: "delete a table" }),
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.kind).toBe("rejected");
    expect(body.data.assistantText).toBe("rejection");
  });

  it("rejected: raw SQL in a hide_table output → 200 rejected, NO mutation, reportRejection logged", async () => {
    const { reportRejection } = await import("@/lib/observability/report");
    vi.mocked(reportRejection).mockClear();
    const { POST } = await import("@/app/api/schema/edit/route");
    getSchema.mockResolvedValue(twoTableSchemaRead());
    callGeminiWithTimeout.mockResolvedValue({
      kind: "hide_table",
      tableKey: "jobs",
      smuggled: "DROP TABLE records;",
    });

    const res = await POST(
      postReq({ slug: "acme", message: "delete the Jobs table" }),
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.kind).toBe("rejected");
    expect(body.data.assistantText).toBe("rejection");
    expect(body.data.assistantText).not.toContain("DROP");
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

  // --- Story 13.4: the three select value-management chat handlers ------------
  // A schema whose Invoices table carries a `select` status field so the route's
  // summary surfaces its current options and a value op resolves to a real field.
  function selectSchemaRead() {
    return {
      data: {
        tables: [
          {
            key: "invoices",
            label: "Invoices",
            fields: [
              {
                key: "status",
                label: "Status",
                type: "select",
                options: [
                  { value: "paid", label: "Paid" },
                  { value: "unpaid", label: "Unpaid" },
                ],
              },
            ],
          },
        ],
        views: [],
      },
      error: null,
    };
  }

  it("surfaces a select field's options in the prompt's table summary (Story 13.4)", async () => {
    getSchema.mockResolvedValue(selectSchemaRead());
    const { buildEditorPrompt } = await import("@/lib/gemini/prompts");
    const buildSpy = vi.spyOn(
      await import("@/lib/gemini/prompts"),
      "buildEditorPrompt",
    );
    const { POST } = await import("@/app/api/schema/edit/route");
    callGeminiWithTimeout.mockResolvedValue({
      kind: "needs_clarification",
      question: "Which table?",
    });

    await POST(postReq({ slug: "acme", message: "add a value" }));

    // The route built the prompt with the invoices select field carrying its
    // current options, so the model can target one by value.
    const call = buildSpy.mock.calls[0];
    const invoices = call[1].tables.find((t) => t.key === "invoices");
    const status = invoices?.fields?.find((f) => f.key === "status");
    expect(status?.options).toEqual([
      { value: "paid", label: "Paid" },
      { value: "unpaid", label: "Unpaid" },
    ]);
    // And the serialized prompt string includes the value=Label rendering.
    const prompt = buildEditorPrompt(call[0], call[1]);
    expect(prompt).toContain("paid=Paid");
    expect(prompt).toContain("unpaid=Unpaid");
    buildSpy.mockRestore();
  });

  it("applied: add_select_option → 200 applied, addSelectOption ran, no other write", async () => {
    getSchema.mockResolvedValue(selectSchemaRead());
    const { POST } = await import("@/app/api/schema/edit/route");
    callGeminiWithTimeout.mockResolvedValue({
      kind: "add_select_option",
      tableKey: "invoices",
      fieldKey: "status",
      label: "Partial",
    });

    const res = await POST(
      postReq({ slug: "acme", message: "add Partial to the Invoices status" }),
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.error).toBeNull();
    expect(body.data.kind).toBe("applied");
    expect(body.data.tableKey).toBe("invoices");
    expect(body.data.fieldKey).toBe("status");
    expect(body.data.assistantText).toBe("successValueAdded");
    expect(addSelectOption).toHaveBeenCalledTimes(1);
    const call = addSelectOption.mock.calls[0];
    expect(call[0]).toEqual(
      expect.objectContaining({ actorId: "user-1", orgId: "org-1" }),
    );
    expect(call[1]).toBe("invoices");
    expect(call[2]).toBe("status");
    expect(call[3]).toEqual({ label: "Partial" });
    expect(addField).not.toHaveBeenCalled();
    expect(renameSelectOption).not.toHaveBeenCalled();
    expect(archiveSelectOption).not.toHaveBeenCalled();
  });

  it("rejected: a shapeless add_select_option (missing label) → 200 rejected, mutator NOT called", async () => {
    const { POST } = await import("@/app/api/schema/edit/route");
    callGeminiWithTimeout.mockResolvedValue({
      kind: "add_select_option",
      tableKey: "invoices",
      fieldKey: "status",
    });

    const res = await POST(postReq({ slug: "acme", message: "add a value" }));

    expect(res.status).toBe(200);
    expect((await res.json()).data.kind).toBe("rejected");
    expect(addSelectOption).not.toHaveBeenCalled();
  });

  it("rejected: an add_select_option validator rejection → 200 rejected, fixed copy, no raw leak", async () => {
    const { AppError } = await import("@/types/api");
    const { POST } = await import("@/app/api/schema/edit/route");
    callGeminiWithTimeout.mockResolvedValue({
      kind: "add_select_option",
      tableKey: "invoices",
      fieldKey: "status",
      label: "Paid",
    });
    addSelectOption.mockRejectedValue(new AppError(400, "selectOptionOpFailed"));

    const res = await POST(
      postReq({ slug: "acme", message: "add Paid to Invoices status" }),
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.kind).toBe("rejected");
    expect(body.data.assistantText).toBe("rejection");
    expect(body.data.assistantText).not.toContain("selectOptionOpFailed");
  });

  it("applied: rename_select_option → 200 applied, renameSelectOption ran", async () => {
    getSchema.mockResolvedValue(selectSchemaRead());
    const { POST } = await import("@/app/api/schema/edit/route");
    callGeminiWithTimeout.mockResolvedValue({
      kind: "rename_select_option",
      tableKey: "invoices",
      fieldKey: "status",
      optionValue: "paid",
      label: "Settled",
    });

    const res = await POST(
      postReq({ slug: "acme", message: "rename Paid to Settled on Invoices status" }),
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.error).toBeNull();
    expect(body.data.kind).toBe("applied");
    expect(body.data.assistantText).toBe("successValueRenamed");
    expect(renameSelectOption).toHaveBeenCalledTimes(1);
    const call = renameSelectOption.mock.calls[0];
    expect(call[1]).toBe("invoices");
    expect(call[2]).toBe("status");
    expect(call[3]).toEqual({ value: "paid", label: "Settled" });
    expect(addSelectOption).not.toHaveBeenCalled();
    expect(archiveSelectOption).not.toHaveBeenCalled();
  });

  it("rejected: a shapeless rename_select_option (missing optionValue) → 200 rejected, mutator NOT called", async () => {
    const { POST } = await import("@/app/api/schema/edit/route");
    callGeminiWithTimeout.mockResolvedValue({
      kind: "rename_select_option",
      tableKey: "invoices",
      fieldKey: "status",
      label: "Settled",
    });

    const res = await POST(postReq({ slug: "acme", message: "rename a value" }));

    expect(res.status).toBe(200);
    expect((await res.json()).data.kind).toBe("rejected");
    expect(renameSelectOption).not.toHaveBeenCalled();
  });

  it("applied: archive_select_option → 200 applied, archiveSelectOption ran", async () => {
    getSchema.mockResolvedValue(selectSchemaRead());
    const { POST } = await import("@/app/api/schema/edit/route");
    callGeminiWithTimeout.mockResolvedValue({
      kind: "archive_select_option",
      tableKey: "invoices",
      fieldKey: "status",
      optionValue: "paid",
    });

    const res = await POST(
      postReq({ slug: "acme", message: "remove the Paid status from Invoices" }),
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.error).toBeNull();
    expect(body.data.kind).toBe("applied");
    expect(body.data.assistantText).toBe("successValueArchived");
    expect(archiveSelectOption).toHaveBeenCalledTimes(1);
    const call = archiveSelectOption.mock.calls[0];
    expect(call[1]).toBe("invoices");
    expect(call[2]).toBe("status");
    expect(call[3]).toEqual({ value: "paid" });
    expect(addSelectOption).not.toHaveBeenCalled();
    expect(renameSelectOption).not.toHaveBeenCalled();
  });

  it("rejected: an archive_select_option validator rejection (last active) → 200 rejected, no raw leak", async () => {
    const { AppError } = await import("@/types/api");
    const { POST } = await import("@/app/api/schema/edit/route");
    callGeminiWithTimeout.mockResolvedValue({
      kind: "archive_select_option",
      tableKey: "invoices",
      fieldKey: "status",
      optionValue: "paid",
    });
    archiveSelectOption.mockRejectedValue(new AppError(400, "selectOptionOpFailed"));

    const res = await POST(
      postReq({ slug: "acme", message: "remove the Paid status" }),
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.kind).toBe("rejected");
    expect(body.data.assistantText).toBe("rejection");
    expect(body.data.assistantText).not.toContain("selectOptionOpFailed");
  });

  it("rejected: raw SQL in a select-value op output → 200 rejected, no write, reportRejection logged", async () => {
    const { reportRejection } = await import("@/lib/observability/report");
    vi.mocked(reportRejection).mockClear();
    const { POST } = await import("@/app/api/schema/edit/route");
    callGeminiWithTimeout.mockResolvedValue({
      kind: "add_select_option",
      tableKey: "invoices",
      fieldKey: "status",
      label: "Partial",
      smuggled: "DROP TABLE records;",
    });

    const res = await POST(
      postReq({ slug: "acme", message: "add Partial to Invoices status" }),
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.kind).toBe("rejected");
    expect(body.data.assistantText).toBe("rejection");
    expect(body.data.assistantText).not.toContain("DROP");
    expect(addSelectOption).not.toHaveBeenCalled();
    expect(reportRejection).toHaveBeenCalled();
  });

  // --- Story 13.4: success-message argument resolution -----------------------
  // The handlers resolve human labels (never raw tokens/keys) into the owner-
  // facing confirmation: the field's label from the summary, and — for archive —
  // the option's label via a token->label lookup. The default translator mock
  // echoes only the key, so these tests override it once to observe the actual
  // {value, field} interpolation args and prove the resolution runs.
  const interpolatingT = async () => (key: string, args?: Record<string, unknown>) =>
    `${key}|value=${args?.value ?? ""}|field=${args?.field ?? ""}`;

  it("add_select_option resolves the field LABEL (Status, not the raw key) into the success copy", async () => {
    getSchema.mockResolvedValue(selectSchemaRead());
    getTranslations.mockImplementationOnce(interpolatingT);
    const { POST } = await import("@/app/api/schema/edit/route");
    callGeminiWithTimeout.mockResolvedValue({
      kind: "add_select_option",
      tableKey: "invoices",
      fieldKey: "status",
      label: "Partial",
    });

    const res = await POST(
      postReq({ slug: "acme", message: "add Partial to the Invoices status" }),
    );

    const body = await res.json();
    expect(body.data.kind).toBe("applied");
    expect(body.data.assistantText).toBe("successValueAdded|value=Partial|field=Status");
    expect(body.data.assistantText).not.toContain("field=status");
  });

  it("rename_select_option resolves the field LABEL into the success copy", async () => {
    getSchema.mockResolvedValue(selectSchemaRead());
    getTranslations.mockImplementationOnce(interpolatingT);
    const { POST } = await import("@/app/api/schema/edit/route");
    callGeminiWithTimeout.mockResolvedValue({
      kind: "rename_select_option",
      tableKey: "invoices",
      fieldKey: "status",
      optionValue: "paid",
      label: "Settled",
    });

    const res = await POST(
      postReq({ slug: "acme", message: "rename Paid to Settled on Invoices status" }),
    );

    const body = await res.json();
    expect(body.data.kind).toBe("applied");
    expect(body.data.assistantText).toBe(
      "successValueRenamed|value=Settled|field=Status",
    );
    expect(body.data.assistantText).not.toContain("field=status");
  });

  it("archive_select_option resolves the option LABEL (Paid, not the raw 'paid' token) and the field LABEL", async () => {
    getSchema.mockResolvedValue(selectSchemaRead());
    getTranslations.mockImplementationOnce(interpolatingT);
    const { POST } = await import("@/app/api/schema/edit/route");
    callGeminiWithTimeout.mockResolvedValue({
      kind: "archive_select_option",
      tableKey: "invoices",
      fieldKey: "status",
      optionValue: "paid",
    });

    const res = await POST(
      postReq({ slug: "acme", message: "remove the Paid status from Invoices" }),
    );

    const body = await res.json();
    expect(body.data.kind).toBe("applied");
    // The archived value renders as its human label, never the stored token.
    expect(body.data.assistantText).toBe("successValueArchived|value=Paid|field=Status");
    expect(body.data.assistantText).not.toContain("value=paid");
    expect(body.data.assistantText).not.toContain("field=status");
  });
});
