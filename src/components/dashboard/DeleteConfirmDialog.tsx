"use client";

import { useTranslations } from "next-intl";
import { Loader2, Trash2 } from "lucide-react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { REFERENCE_COUNT_CAP } from "@/lib/data/records-client";

/**
 * DeleteConfirmDialog (Story 3.2, extended by Story 3.8) — the Radix `Dialog`
 * gating a soft-delete.
 *
 * Only confirming triggers the optimistic delete (via the caller's
 * `useDeleteRecord`); cancel / Esc / overlay close it with NO write. Radix gives
 * the frozen a11y contract for free (focus trap, Esc, focus return). Confirm +
 * cancel are ≥48px targets; all copy resolves through `SlugDashboard`. There is
 * no restore/undo affordance (out of scope).
 *
 * Story 3.8 adds the referenced-record warning: when the record is referenced by
 * other rows the dialog shows the count (capped "500+") plus an archived note so
 * the user understands the referencing rows keep the id and will render as
 * "archived" after the soft-delete. While the count is loading it shows a skeleton;
 * if the count fetch failed it shows a neutral "couldn't verify references" note —
 * either way the destructive confirm stays available (a failure never blocks the
 * delete).
 */

/**
 * The reference-count region's state (Story 3.8), derived purely from the three
 * count props so the branch selection is testable without rendering the
 * portal-mounted dialog body (the repo test env is `node`, and Radix Dialog
 * content renders only client-side). `loading` and `error` take precedence over
 * the count; a `null`/zero count shows nothing; a positive count warns, marking
 * `capped` when it has hit `REFERENCE_COUNT_CAP` ("500+").
 */
export type DeleteReferenceState =
  | { kind: "loading" }
  | { kind: "error" }
  | { kind: "none" }
  | { kind: "warning"; count: number; capped: boolean };

export function deleteReferenceState(
  referenceCount: number | null,
  referenceCountLoading: boolean,
  referenceCountError: boolean,
): DeleteReferenceState {
  if (referenceCountLoading) return { kind: "loading" };
  if (referenceCountError) return { kind: "error" };
  if (referenceCount === null || referenceCount <= 0) return { kind: "none" };
  return {
    kind: "warning",
    count: referenceCount,
    capped: referenceCount >= REFERENCE_COUNT_CAP,
  };
}

type DeleteConfirmDialogProps = {
  /** Open when a record is queued for deletion; `null` closes the dialog. */
  open: boolean;
  /** The active table's label, woven into the confirmation body. */
  tableLabel: string;
  /** Confirm handler — runs the soft-delete. */
  onConfirm: () => void;
  /** Close/cancel handler — no write. */
  onCancel: () => void;
  pending: boolean;
  /**
   * The count of rows that reference this record (Story 3.8), or `null` when it is
   * not yet known (loading) or unavailable (error). `REFERENCE_COUNT_CAP` means
   * "at least that many" and renders capped ("500+").
   */
  referenceCount: number | null;
  /** True while the reference count is being fetched → show a skeleton. */
  referenceCountLoading: boolean;
  /** True when the count fetch failed → show the neutral fallback note. */
  referenceCountError: boolean;
};

export function DeleteConfirmDialog({
  open,
  tableLabel,
  onConfirm,
  onCancel,
  pending,
  referenceCount,
  referenceCountLoading,
  referenceCountError,
}: DeleteConfirmDialogProps) {
  const t = useTranslations("SlugDashboard");

  const refState = deleteReferenceState(
    referenceCount,
    referenceCountLoading,
    referenceCountError,
  );

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && !pending) {
          onCancel();
        }
      }}
    >
      <DialogContent closeLabel={t("close")} className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-balance">{t("deleteTitle")}</DialogTitle>
          <DialogDescription className="text-pretty">
            {t("deleteBody", { table: tableLabel })}
          </DialogDescription>
        </DialogHeader>

        {/* Reference-count states (Story 3.8), selected by `deleteReferenceState`.
            Counting → skeleton; error → neutral fallback; warning → count + capped
            note + archived note; none → nothing extra (the generic body suffices). */}
        {refState.kind === "loading" ? (
          <div className="flex flex-col gap-2" aria-hidden="true">
            <Skeleton className="h-4 w-3/4" />
            <span className="sr-only">{t("deleteReferenceCounting")}</span>
          </div>
        ) : refState.kind === "error" ? (
          <p role="status" className="text-sm text-muted-foreground text-pretty">
            {t("deleteReferenceUnavailable")}
          </p>
        ) : refState.kind === "warning" ? (
          <div
            role="status"
            className="flex flex-col gap-1 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-foreground"
          >
            <p className="font-medium text-pretty">
              {t("deleteReferenceWarning", { count: refState.count })}
            </p>
            {refState.capped ? (
              <p className="text-xs text-muted-foreground text-pretty">
                {t("deleteReferenceCapNote", { count: REFERENCE_COUNT_CAP })}
              </p>
            ) : null}
            <p className="text-xs text-muted-foreground text-pretty">
              {t("deleteReferenceArchivedNote")}
            </p>
          </div>
        ) : null}

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={onCancel}
            disabled={pending}
            className="min-h-12"
          >
            {t("deleteCancel")}
          </Button>
          <Button
            type="button"
            variant="destructive"
            onClick={onConfirm}
            disabled={pending}
            className="min-h-12 gap-2"
          >
            {pending ? (
              <Loader2 aria-hidden="true" className="size-4 animate-spin" />
            ) : (
              <Trash2 aria-hidden="true" className="size-4" />
            )}
            <span>{t("deleteConfirm")}</span>
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
