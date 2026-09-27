"use client";

import { useId, useState } from "react";
import { useTranslations } from "next-intl";
import { Link2, Loader2 } from "lucide-react";

import type { TableDefinition } from "@/types/db";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { RecordApiError } from "@/lib/data/records-client";

/**
 * AddRelationFieldControl (Story 3.7) — the Admin-only "add relationship field"
 * control. A popover form in the toolbar: pick a TARGET table (any other visible
 * table in the org) and enter the new field's label. On submit it POSTs
 * `{ slug, tableKey, label, targetTable }` to `/api/schema/fields` — the server
 * re-derives the definition and runs the focused relation-field validator, so a
 * client can never post an arbitrary schema.
 *
 * On success it calls `onSuccess`, which runs `router.refresh()` so the server
 * component re-reads the schema and the new relation column appears in every view.
 * There is no client-side optimistic schema cache (schema is a server prop — a
 * rare admin op). Only rendered by `RecordsView` when `role === "admin"`; the
 * server route's `requireAdmin` is the real security boundary. Mirrors
 * `ColumnVisibilityControl`.
 */

async function postRelationField(
  slug: string,
  tableKey: string,
  label: string,
  targetTable: string,
): Promise<void> {
  let res: Response;
  try {
    res = await fetch("/api/schema/fields", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ slug, tableKey, label, targetTable }),
    });
  } catch {
    throw new RecordApiError("genericError");
  }

  let body: { error: string | null } | null = null;
  try {
    body = (await res.json()) as { error: string | null };
  } catch {
    throw new RecordApiError("genericError");
  }
  if (!res.ok || body?.error) {
    throw new RecordApiError(body?.error ?? "genericError");
  }
}

type AddRelationFieldControlProps = {
  /** Route slug — scopes the API call. */
  slug: string;
  /** The table the new relation field is added to. */
  activeTable: TableDefinition;
  /** All visible tables in the org — the target-table choices. */
  tables: TableDefinition[];
  /**
   * Called after a successful add. `RecordsView` wires this to `router.refresh()`
   * so the server re-renders with the new field.
   */
  onSuccess: () => void;
  /** Called with a translated message when the add fails (nothing changes). */
  onError: (message: string) => void;
};

export function AddRelationFieldControl({
  slug,
  activeTable,
  tables,
  onSuccess,
  onError,
}: AddRelationFieldControlProps) {
  const t = useTranslations("SlugDashboard");
  const headingId = useId();
  const labelInputId = useId();
  const targetSelectId = useId();
  const [open, setOpen] = useState(false);
  const [label, setLabel] = useState("");
  const [targetTable, setTargetTable] = useState("");
  const [pending, setPending] = useState(false);

  // A relation may target any visible table in the org (including self-reference,
  // which the validator allows). The active table is a legal target too.
  const targetChoices = tables;

  const resolveErrorMessage = (err: unknown): string => {
    const code = err instanceof RecordApiError ? err.code : "genericError";
    switch (code) {
      case "unauthorized":
      case "forbidden":
        return t("addFieldForbidden");
      default:
        return t("addFieldFailed");
    }
  };

  const reset = () => {
    setLabel("");
    setTargetTable("");
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (pending) return;
    if (label.trim() === "" || targetTable === "") return;
    setPending(true);
    try {
      await postRelationField(slug, activeTable.key, label.trim(), targetTable);
      reset();
      setOpen(false);
      onSuccess();
    } catch (err) {
      onError(resolveErrorMessage(err));
    } finally {
      setPending(false);
    }
  };

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        if (!pending) {
          setOpen(next);
          if (!next) reset();
        }
      }}
    >
      <PopoverTrigger asChild>
        <Button type="button" variant="outline" className="h-12 min-h-12 gap-2">
          <Link2 aria-hidden="true" className="size-4" />
          {t("addRelationField")}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-0" aria-labelledby={headingId}>
        <div className="border-b border-border px-4 py-3">
          <p id={headingId} className="text-sm font-medium text-foreground">
            {t("addRelationField")}
          </p>
        </div>
        <form onSubmit={handleSubmit} className="flex flex-col gap-3 p-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={targetSelectId} className="text-muted-foreground">
              {t("addRelationTargetLabel")}
            </Label>
            <select
              id={targetSelectId}
              value={targetTable}
              disabled={pending}
              onChange={(event) => setTargetTable(event.target.value)}
              className="min-h-12 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50"
            >
              <option value="" disabled>
                {t("addRelationTargetPlaceholder")}
              </option>
              {targetChoices.map((table) => (
                <option key={table.key} value={table.key}>
                  {table.label}
                </option>
              ))}
            </select>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor={labelInputId} className="text-muted-foreground">
              {t("addRelationFieldLabel")}
            </Label>
            <Input
              id={labelInputId}
              value={label}
              disabled={pending}
              onChange={(event) => setLabel(event.target.value)}
              className="min-h-12"
            />
          </div>

          <Button
            type="submit"
            disabled={pending || label.trim() === "" || targetTable === ""}
            className="min-h-12 gap-2"
          >
            {pending ? (
              <Loader2 aria-hidden="true" className="size-4 animate-spin" />
            ) : null}
            {t("addRelationSubmit")}
          </Button>
        </form>
      </PopoverContent>
    </Popover>
  );
}
