"use client";

import { useId, useState } from "react";
import { useTranslations } from "next-intl";
import { Columns3, Eye, EyeOff, Loader2 } from "lucide-react";

import type { TableDefinition } from "@/types/db";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Switch } from "@/components/ui/switch";
import { RecordApiError } from "@/lib/data/records-client";
import { cn } from "@/lib/utils";

/**
 * ColumnVisibilityControl (Story 3.5) — the Admin-only "Columns" manager.
 *
 * A single popover in the toolbar row lists EVERY field of the active table
 * (including already-hidden ones), each with a show/hide toggle. Listing hidden
 * fields is deliberate: it makes unhide always reachable and works identically on
 * desktop and mobile (cards have no headers).
 *
 * A toggle POSTs the targeted patch `{ slug, tableKey, fieldKey, hidden }` to
 * `/api/schema/columns` (the server re-derives the definition — a client can
 * never post an arbitrary schema). On success it calls `onToggled`, which runs
 * `router.refresh()` so the server component re-reads the schema and the column
 * drops out of / reappears in every view. There is no client-side optimistic
 * schema cache (schema is a server prop, not TanStack state — a rare admin op).
 *
 * Only rendered by `RecordsView` when `role === "admin"`; the server route's
 * `requireAdmin` is the real security boundary.
 */

/** Toggle the visibility of one field, returning the server error code on failure. */
async function postFieldVisibility(
  slug: string,
  tableKey: string,
  fieldKey: string,
  hidden: boolean,
): Promise<void> {
  let res: Response;
  try {
    res = await fetch("/api/schema/columns", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ slug, tableKey, fieldKey, hidden }),
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

type ColumnVisibilityControlProps = {
  /** Route slug — scopes the API call. */
  slug: string;
  /** The active table, with its FULL fields (including hidden). */
  activeTable: TableDefinition;
  /**
   * Called after a successful toggle. `RecordsView` wires this to
   * `router.refresh()` so the server re-renders with the new visibility.
   */
  onToggled: () => void;
  /** Called with a translated message when a toggle fails (nothing changes). */
  onError: (message: string) => void;
};

export function ColumnVisibilityControl({
  slug,
  activeTable,
  onToggled,
  onError,
}: ColumnVisibilityControlProps) {
  const t = useTranslations("SlugDashboard");
  const headingId = useId();
  // The field key currently being written, so we can show a per-row pending
  // state and disable that one switch during its request.
  const [pendingKey, setPendingKey] = useState<string | null>(null);

  const resolveErrorMessage = (err: unknown): string => {
    const code = err instanceof RecordApiError ? err.code : "genericError";
    switch (code) {
      case "unauthorized":
        return t("columnsToggleForbidden");
      case "forbidden":
        return t("columnsToggleForbidden");
      case "writeFailed":
        return t("columnsToggleFailed");
      default:
        return t("columnsToggleFailed");
    }
  };

  const handleToggle = async (fieldKey: string, nextHidden: boolean) => {
    if (pendingKey) return;
    setPendingKey(fieldKey);
    try {
      await postFieldVisibility(slug, activeTable.key, fieldKey, nextHidden);
      onToggled();
    } catch (err) {
      onError(resolveErrorMessage(err));
    } finally {
      setPendingKey(null);
    }
  };

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          className="h-12 min-h-12 gap-2"
        >
          <Columns3 aria-hidden="true" className="size-4" />
          {t("columnsManager")}
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        className="w-80 p-0"
        aria-labelledby={headingId}
      >
        <div className="border-b border-border px-4 py-3">
          <p
            id={headingId}
            className="text-sm font-medium text-foreground"
          >
            {t("columnsManager")}
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground text-pretty">
            {t("columnsManagerBody")}
          </p>
        </div>
        <ul className="flex max-h-80 list-none flex-col overflow-y-auto p-0">
          {activeTable.fields.map((field) => {
            const isHidden = field.hidden === true;
            const isPending = pendingKey === field.key;
            const switchId = `${headingId}-${field.key}`;
            return (
              <li
                key={field.key}
                className="flex items-center justify-between gap-3 border-b border-border px-4 py-3 transition-colors last:border-b-0 hover:bg-muted/50"
              >
                <div className="flex min-w-0 flex-1 items-center gap-2">
                  {isHidden ? (
                    <EyeOff
                      aria-hidden="true"
                      className="size-4 shrink-0 text-muted-foreground"
                    />
                  ) : (
                    <Eye
                      aria-hidden="true"
                      className="size-4 shrink-0 text-muted-foreground"
                    />
                  )}
                  <label
                    htmlFor={switchId}
                    className={cn(
                      "min-w-0 flex-1 cursor-pointer truncate text-sm transition-colors",
                      isHidden ? "text-muted-foreground" : "text-foreground",
                    )}
                  >
                    {field.label}
                  </label>
                  {isHidden ? (
                    <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
                      {t("columnsHiddenBadge")}
                    </span>
                  ) : null}
                </div>
                <div className="flex size-12 shrink-0 items-center justify-center">
                  {isPending ? (
                    <Loader2
                      aria-hidden="true"
                      className="size-4 animate-spin text-muted-foreground"
                    />
                  ) : (
                    <Switch
                      id={switchId}
                      checked={!isHidden}
                      disabled={pendingKey !== null}
                      onCheckedChange={(checked) =>
                        handleToggle(field.key, !checked)
                      }
                      aria-label={
                        isHidden
                          ? t("columnsShowAria", { field: field.label })
                          : t("columnsHideAria", { field: field.label })
                      }
                    />
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      </PopoverContent>
    </Popover>
  );
}
