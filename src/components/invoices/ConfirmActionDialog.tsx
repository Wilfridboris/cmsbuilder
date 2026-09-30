"use client";

import type { ComponentType } from "react";
import { Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

/**
 * ConfirmActionDialog (retro A3) — the shared confirm-dialog pattern extracted from
 * `InvoiceDraftForm` and `CreditNoteDraftForm`, each of which held two structurally
 * identical copies (issue + discard).
 *
 * It renders a titled dialog with a body, a cancel button, and a confirm button that
 * shows a spinner and disables while `pending`. The confirm button carries an
 * action-specific `icon` (which is swapped for a spinner while pending) and an
 * optional `destructive` variant (the discard case). `open` / `onOpenChange` /
 * `onConfirm` are controlled by the caller. All labels are passed in so the shared
 * component stays free of any i18n namespace.
 */

export function ConfirmActionDialog({
  open,
  onOpenChange,
  onConfirm,
  pending,
  title,
  body,
  confirmLabel,
  pendingLabel,
  cancelLabel,
  icon: Icon,
  destructive = false,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
  /** While true the confirm button shows a spinner and is disabled. */
  pending: boolean;
  title: string;
  body: string;
  confirmLabel: string;
  /** Confirm label shown while pending (e.g. "Issuing…"). */
  pendingLabel: string;
  cancelLabel: string;
  /** The confirm button's idle icon (swapped for a spinner while pending). */
  icon: ComponentType<{ className?: string; "aria-hidden"?: boolean }>;
  /** Use the destructive button variant (the discard case). */
  destructive?: boolean;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent closeLabel={cancelLabel}>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{body}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            className="min-h-12"
            onClick={() => onOpenChange(false)}
          >
            {cancelLabel}
          </Button>
          <Button
            type="button"
            variant={destructive ? "destructive" : "default"}
            className="min-h-12 gap-2"
            disabled={pending}
            onClick={onConfirm}
          >
            {pending ? (
              <Loader2 aria-hidden="true" className="size-4 animate-spin" />
            ) : (
              <Icon aria-hidden={true} className="size-4" />
            )}
            {pending ? pendingLabel : confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
