"use client";

import { useCallback, useId, useState } from "react";
import { useTranslations } from "next-intl";
import { Check, Info, Pencil, Trash2, X } from "lucide-react";

import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

/**
 * OverrideControl (Story 1.7) — the inline schema explainability + one-tap
 * override affordance.
 *
 * A single reusable Popover used for BOTH a generated table (in the tablist)
 * and a generated field (column header + record detail). It reveals the item's
 * one-line `reason` (produced by the Story 1.4 generation call / 1.5 fallback)
 * and offers, in one tap each:
 *   - Rename — an inline `Input` that edits only the `label` (never the `key`),
 *     Enter commits, empty/blank is rejected with a translated inline message
 *     (reusing the RecordDetail edit idiom).
 *   - Remove — sets the append-only `hidden` flag in the session-only schema
 *     copy. Disabled (with a translated explanation) when removal isn't allowed
 *     (e.g. the last visible table), so the dashboard never empties.
 *
 * Overrides mutate a client-side, session-only schema copy owned by
 * `DemoDashboard` — no DB write, no API, no migration; they reflect immediately
 * through the existing `!hidden` render filters. All strings resolve through
 * next-intl (`Explainability` + reused `Dashboard.save`/`cancel`); every ARIA
 * label is derived from the item's `label`. Radix `Popover` gives keyboard
 * operation + focus return to the trigger for free (Esc closes).
 */

type OverrideControlProps = {
  /** The current human-facing label of the table/field. */
  label: string;
  /** The plain-language reason, when the item has one. */
  reason?: string;
  /** Translated ARIA label for the info trigger (e.g. "Why {item} was added"). */
  infoLabel: string;
  /** Translated ARIA label for the rename action (per target). */
  renameLabel: string;
  /** Translated ARIA label for the remove action (per target). */
  removeLabel: string;
  /** Commit a rename (new, non-empty label). */
  onRename: (label: string) => void;
  /** Remove the item (set `hidden: true`). */
  onRemove: () => void;
  /**
   * When set, Remove is disabled and this translated string explains why
   * (e.g. the last-visible-table guard). When undefined, Remove is enabled.
   */
  removeDisabledReason?: string;
  /** Extra classes for the trigger (e.g. sizing within a table header). */
  className?: string;
};

export function OverrideControl({
  label,
  reason,
  infoLabel,
  renameLabel,
  removeLabel,
  onRename,
  onRemove,
  removeDisabledReason,
  className,
}: OverrideControlProps) {
  const t = useTranslations("Explainability");
  const [open, setOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);

  const closeAll = useCallback(() => {
    setRenaming(false);
    setOpen(false);
  }, []);

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setRenaming(false);
      }}
    >
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label={infoLabel}
          className={cn(
            "size-12 shrink-0 text-muted-foreground hover:text-foreground",
            className,
          )}
        >
          <Info aria-hidden="true" className="size-4" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="flex flex-col gap-3">
        {reason ? (
          <div className="flex flex-col gap-1.5">
            <p className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
              <Info aria-hidden="true" className="size-3.5" />
              {t("reasonHeading")}
            </p>
            <p className="text-sm leading-relaxed text-foreground text-pretty">
              {reason}
            </p>
          </div>
        ) : null}

        {renaming ? (
          <RenameForm
            label={label}
            onCancel={() => setRenaming(false)}
            onCommit={(next) => {
              onRename(next);
              closeAll();
            }}
          />
        ) : (
          <div
            className={cn(
              "flex flex-col gap-2",
              reason && "border-t border-border pt-3",
            )}
          >
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="min-h-12 justify-start gap-2"
              aria-label={renameLabel}
              onClick={() => setRenaming(true)}
            >
              <Pencil aria-hidden="true" className="size-4" />
              <span>{t("rename")}</span>
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={removeDisabledReason !== undefined}
              className="min-h-12 justify-start gap-2 text-destructive hover:bg-destructive/10 hover:text-destructive"
              aria-label={removeLabel}
              onClick={() => {
                onRemove();
                closeAll();
              }}
            >
              <Trash2 aria-hidden="true" className="size-4" />
              <span>{t("remove")}</span>
            </Button>
            {removeDisabledReason ? (
              <p className="text-xs text-muted-foreground text-pretty">
                {removeDisabledReason}
              </p>
            ) : null}
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}

/**
 * Inline rename form — mirrors the RecordDetail edit idiom: a focused, selected
 * `Input`, Enter commits, empty/blank is rejected with a translated inline
 * message (no commit). Only the `label` changes; the `key` is never touched.
 */
function RenameForm({
  label,
  onCancel,
  onCommit,
}: {
  label: string;
  onCancel: () => void;
  onCommit: (label: string) => void;
}) {
  const t = useTranslations("Explainability");
  const tDashboard = useTranslations("Dashboard");
  const [draft, setDraft] = useState(label);
  const [error, setError] = useState<string | null>(null);
  // Unique per instance so the error id / aria-describedby never collide across
  // the many OverrideControl rename forms.
  const errorId = useId();

  // Focus + select via a callback ref (avoids `autoFocus`, per the a11y rule);
  // focus here is scoped to an explicit "rename" action, not page load.
  const focusInput = useCallback((node: HTMLInputElement | null) => {
    if (node) {
      node.focus();
      node.select();
    }
  }, []);

  const commit = () => {
    const trimmed = draft.trim();
    if (trimmed === "") {
      setError(t("renameEmpty"));
      return;
    }
    onCommit(trimmed);
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <Input
          ref={focusInput}
          value={draft}
          aria-label={t("rename")}
          aria-invalid={error !== null}
          aria-describedby={error ? errorId : undefined}
          placeholder={t("renamePlaceholder")}
          onChange={(event) => {
            setDraft(event.target.value);
            if (error) setError(null);
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              commit();
            }
          }}
          className="min-h-12"
        />
        <div className="flex shrink-0 items-center gap-1">
          <Button
            type="button"
            size="icon"
            className="size-12"
            onClick={commit}
            aria-label={tDashboard("save")}
          >
            <Check aria-hidden="true" className="size-4" />
          </Button>
          <Button
            type="button"
            size="icon"
            variant="outline"
            className="size-12"
            onClick={onCancel}
            aria-label={tDashboard("cancel")}
          >
            <X aria-hidden="true" className="size-4" />
          </Button>
        </div>
      </div>
      {error ? (
        <p
          id={errorId}
          role="alert"
          className="text-xs text-destructive"
        >
          {error}
        </p>
      ) : null}
    </div>
  );
}
