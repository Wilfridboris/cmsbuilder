"use client";

import { useId, useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { Loader2, Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { createForm, FormApiError } from "@/lib/data/forms-client";
import { resolveFormError } from "@/lib/forms/error-copy";

/**
 * CreateFormDialog (Epic 14, Story 14.1) — the Admin-only "create a form" entry point.
 * Opens a `Dialog` with a single required title field; on submit it POSTs to
 * `/api/forms`, shows a spinner and disables the submit while in flight (React 19
 * `useTransition`), surfaces an inline non-technical error under the field on failure,
 * and on success closes the dialog and calls `onCreated` so the list refreshes. The
 * slug + target table are derived server-side (not shown here).
 *
 * `emptyState` renders a secondary trigger used inside the empty-state card (so both the
 * header and the empty card can open the same dialog).
 */

/** Server error codes this dialog maps to a translated message; anything else → generic. */
const ERROR_KEYS = new Set([
  "titleRequired",
  "forbidden",
  "unauthorized",
  "writeFailed",
  "readOnly",
  "genericError",
]);

export function CreateFormDialog({
  slug,
  onCreated,
  emptyState = false,
}: {
  slug: string;
  /** Called after a successful create so the parent list refreshes. */
  onCreated: () => void | Promise<void>;
  /** Render the empty-state trigger variant. */
  emptyState?: boolean;
}) {
  const t = useTranslations("Forms");
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const errorId = useId();

  function handleOpenChange(next: boolean) {
    setOpen(next);
    if (!next) {
      // Reset the field + error when the dialog closes so a reopen starts clean.
      setTitle("");
      setError(null);
    }
  }

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = title.trim();
    if (trimmed === "") {
      setError(t("error.titleRequired"));
      return;
    }
    setError(null);
    startTransition(async () => {
      try {
        await createForm(slug, trimmed);
        await onCreated();
        handleOpenChange(false);
      } catch (err) {
        const code = err instanceof FormApiError ? err.code : "genericError";
        setError(resolveFormError(t, code, ERROR_KEYS));
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button
          type="button"
          variant={emptyState ? "outline" : "default"}
          className="min-h-12 gap-2"
        >
          <Plus aria-hidden="true" className="size-4" />
          {t("newForm")}
        </Button>
      </DialogTrigger>
      <DialogContent closeLabel={t("cancel")}>
        <form onSubmit={handleSubmit} className="flex flex-col gap-6">
          <DialogHeader>
            <DialogTitle>{t("createTitle")}</DialogTitle>
            <DialogDescription>{t("createSubtitle")}</DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-2">
            <Label htmlFor="form-title">{t("titleLabel")}</Label>
            <Input
              id="form-title"
              name="title"
              value={title}
              required
              disabled={pending}
              placeholder={t("titlePlaceholder")}
              aria-invalid={error ? true : undefined}
              aria-describedby={error ? errorId : undefined}
              onChange={(event) => setTitle(event.target.value)}
            />
            {error ? (
              <p id={errorId} role="alert" className="text-sm text-destructive">
                {error}
              </p>
            ) : null}
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              className="min-h-12"
              disabled={pending}
              onClick={() => handleOpenChange(false)}
            >
              {t("cancel")}
            </Button>
            <Button type="submit" className="min-h-12 gap-2" disabled={pending}>
              {pending ? (
                <Loader2 aria-hidden="true" className="size-4 animate-spin" />
              ) : (
                <Plus aria-hidden="true" className="size-4" />
              )}
              {pending ? t("creating") : t("create")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
