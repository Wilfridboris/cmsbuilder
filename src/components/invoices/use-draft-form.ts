"use client";

import { useEffect, useState } from "react";
import { computeInvoiceTotals, type InvoiceTotals } from "@/lib/invoicing/tax";
import { InvoiceApiError } from "@/lib/data/invoices-client";

/**
 * useDraftForm (retro A3) — the shared orchestration hook behind both
 * `InvoiceDraftForm` and `CreditNoteDraftForm`, which were ~85% duplicated.
 *
 * It owns the concerns that were identical between the two forms: the load/save
 * lifecycle state (`loading` / `status` / `error` / `version`), the editable line
 * `rows` plus their add/remove/update helpers (min-1-row guard), the live `totals`
 * (from the SAME canonical `computeInvoiceTotals`), the issue/discard dialog state,
 * and generic `runSave` / `runDiscard` / `runIssue` runners that apply the shared
 * error-code → message mapping.
 *
 * It is config-injected rather than branching internally: each form passes its own
 * client ops (the credit note's `invoiceId`-scoped calls vs the invoice's flat
 * calls), its `buildInput`, its extra error codes, and its redirect callbacks. The
 * form-specific state (customer object / picker, due-date, prefill) stays in the
 * form shells.
 */

/** One editable line-item row (all strings for controlled inputs). */
export type LineRow = {
  key: string;
  description: string;
  quantity: string;
  unitPrice: string;
};

/** Parse a controlled numeric string; NaN/empty degrades to 0 for display math. */
export function toNumber(value: string): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

/**
 * The error codes both forms map to a translated inline message. Each form extends
 * this base set with its own extra code(s) (`dateInvalid` for invoices,
 * `creditExceedsInvoice` / `notIssued` for credit notes).
 */
export const BASE_ERROR_KEYS = [
  "descriptionRequired",
  "amountInvalid",
  "lineItemsRequired",
  "customerRecordInvalid",
  "legalIdentityMissing",
  "taxWithoutRegistration",
  "taxSplit",
  "totalsMismatch",
  "versionConflict",
  "notDraft",
  "notFound",
  "forbidden",
  "unauthorized",
  "loadFailed",
  "writeFailed",
  "genericError",
] as const;

/**
 * Map a raw server error code to a translated inline message: a code in the allowed
 * set resolves to its own message, anything else (including `null` or an unknown
 * code) falls back to `genericError` so a raw error never reaches the user. Pure and
 * exported for unit testing (the hook itself is not unit-testable in the node env).
 */
export function mapErrorCode(
  code: string | null,
  errorKeys: ReadonlySet<string>,
  translate: (shortKey: string) => string,
): string {
  const short = code ? code.replace(/^Invoice\.error\./, "") : null;
  return short && errorKeys.has(short)
    ? translate(short)
    : translate("genericError");
}

let rowSeq = 0;

/**
 * A fresh empty row. `keyPrefix` differentiates invoice (`row-`) vs credit-note
 * (`cn-row-`) keys so the two forms keep their historical key namespaces (matters
 * only for the test-visible markup; React only needs uniqueness within a list).
 */
export function newRow(keyPrefix: string): LineRow {
  rowSeq += 1;
  return {
    key: `${keyPrefix}${rowSeq}`,
    description: "",
    quantity: "1",
    unitPrice: "0",
  };
}

/** Build a row from loaded/prefilled data, minting a fresh unique key. */
export function makeRow(
  keyPrefix: string,
  data: { description: string; quantity: number | string; unitPrice: number | string },
): LineRow {
  rowSeq += 1;
  return {
    key: `${keyPrefix}${rowSeq}`,
    description: data.description,
    quantity: String(data.quantity),
    unitPrice: String(data.unitPrice),
  };
}

export type DraftStatus = "idle" | "saving" | "saved";

/** A loaded draft's shared fields, mapped by the form from its API payload. */
export type LoadedDraft = {
  version: number;
  rows: LineRow[];
};

export type UseDraftFormConfig = {
  /** null = create; non-null = edit an existing draft. */
  isEdit: boolean;
  /** Row key prefix (`"row-"` for invoices, `"cn-row-"` for credit notes). */
  keyPrefix: string;
  /** Initial rows (create-mode prefill, else a single blank row). */
  initialRows: LineRow[];
  /** Place-of-supply province (owned by the form; drives the live tax line). */
  province: string;
  /** Whether GST/HST is effective as of today (drives the live tax preview). */
  taxRegistered: boolean;
  /** Extra error codes this form maps beyond {@link BASE_ERROR_KEYS}. */
  extraErrorKeys?: readonly string[];
  /** Resolve a raw code to a translated message via the form's translator. */
  translateError: (shortKey: string) => string;

  /** Load an existing draft (edit mode only); map the payload to shared fields. */
  load: () => Promise<LoadedDraft>;
  /** Build the draft input the create/update ops submit. */
  buildInput: () => unknown;
  /** Create a new draft; resolves once the redirect is scheduled. */
  create: (input: unknown) => Promise<void>;
  /** Update an existing draft; returns the new version. */
  update: (input: unknown) => Promise<{ version: number }>;
  /** Discard the draft; resolves once the redirect is scheduled. */
  discard: () => Promise<void>;
  /** Issue the draft with the given version; resolves once redirect is scheduled. */
  issue: (version: number) => Promise<void>;
};

export function useDraftForm(config: UseDraftFormConfig) {
  const {
    isEdit,
    keyPrefix,
    initialRows,
    province,
    taxRegistered,
    extraErrorKeys,
    translateError,
    load,
    buildInput,
    create,
    update,
    discard,
    issue,
  } = config;

  const [loading, setLoading] = useState(isEdit);
  const [status, setStatus] = useState<DraftStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [version, setVersion] = useState<number | null>(null);
  const [rows, setRows] = useState<LineRow[]>(initialRows);

  const [discardOpen, setDiscardOpen] = useState(false);
  const [discarding, setDiscarding] = useState(false);
  const [issueOpen, setIssueOpen] = useState(false);
  const [issuing, setIssuing] = useState(false);

  const errorKeys = new Set<string>([...BASE_ERROR_KEYS, ...(extraErrorKeys ?? [])]);

  const resolveError = (code: string | null): string =>
    mapErrorCode(code, errorKeys, translateError);

  // Load an existing draft when editing. `load` is captured per render but its
  // dependencies (slug/ids) are stable for the form's lifetime, matching the prior
  // forms' single-shot load effect.
  useEffect(() => {
    if (!isEdit) {
      return;
    }
    let active = true;
    (async () => {
      try {
        const loaded = await load();
        if (!active) return;
        setVersion(loaded.version);
        setRows(loaded.rows.length > 0 ? loaded.rows : [newRow(keyPrefix)]);
      } catch (err) {
        if (!active) return;
        const code = err instanceof InvoiceApiError ? err.code : "loadFailed";
        setError(resolveError(code));
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isEdit]);

  const clearFeedback = () => {
    if (error) setError(null);
    if (status === "saved") setStatus("idle");
  };

  const updateRow = (key: string, patch: Partial<LineRow>) => {
    setRows((prev) => prev.map((r) => (r.key === key ? { ...r, ...patch } : r)));
    clearFeedback();
  };

  const addRow = () => {
    setRows((prev) => [...prev, newRow(keyPrefix)]);
    clearFeedback();
  };

  const removeRow = (key: string) => {
    setRows((prev) => (prev.length > 1 ? prev.filter((r) => r.key !== key) : prev));
    clearFeedback();
  };

  // Live totals from the SAME canonical function the server stores from (I2/I3).
  const totals: InvoiceTotals = computeInvoiceTotals({
    lineItems: rows.map((r) => ({
      quantity: toNumber(r.quantity),
      unitPrice: toNumber(r.unitPrice),
    })),
    province,
    taxApplies: taxRegistered,
  });

  const runSave = async (event: React.FormEvent) => {
    event.preventDefault();
    setStatus("saving");
    setError(null);
    try {
      const input = buildInput();
      if (isEdit) {
        const result = await update(input);
        setVersion(result.version);
        setStatus("saved");
      } else {
        await create(input);
        // Create schedules a redirect to the new draft's edit page; keep the
        // form in a non-idle state until navigation replaces it.
        return;
      }
    } catch (err) {
      const code = err instanceof InvoiceApiError ? err.code : null;
      setError(resolveError(code));
      setStatus("idle");
    }
  };

  const runDiscard = async () => {
    setDiscarding(true);
    setError(null);
    try {
      await discard();
    } catch (err) {
      const code = err instanceof InvoiceApiError ? err.code : null;
      setError(resolveError(code));
      setDiscarding(false);
      setDiscardOpen(false);
    }
  };

  const runIssue = async () => {
    if (version === null) return;
    setIssuing(true);
    setError(null);
    try {
      await issue(version);
    } catch (err) {
      const code = err instanceof InvoiceApiError ? err.code : null;
      setError(resolveError(code));
      setIssuing(false);
      setIssueOpen(false);
    }
  };

  return {
    // lifecycle state
    loading,
    status,
    error,
    version,
    // rows + totals
    rows,
    addRow,
    removeRow,
    updateRow,
    totals,
    // feedback
    clearFeedback,
    // dialog state
    discardOpen,
    setDiscardOpen,
    discarding,
    issueOpen,
    setIssueOpen,
    issuing,
    // runners
    runSave,
    runDiscard,
    runIssue,
  };
}
