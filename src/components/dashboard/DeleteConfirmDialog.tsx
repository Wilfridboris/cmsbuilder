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

/**
 * DeleteConfirmDialog (Story 3.2) — the Radix `Dialog` gating a soft-delete.
 *
 * Only confirming triggers the optimistic delete (via the caller's
 * `useDeleteRecord`); cancel / Esc / overlay close it with NO write. Radix gives
 * the frozen a11y contract for free (focus trap, Esc, focus return). Confirm +
 * cancel are ≥48px targets; all copy resolves through `SlugDashboard`. There is
 * no restore/undo affordance (out of scope).
 */

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
};

export function DeleteConfirmDialog({
  open,
  tableLabel,
  onConfirm,
  onCancel,
  pending,
}: DeleteConfirmDialogProps) {
  const t = useTranslations("SlugDashboard");

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
