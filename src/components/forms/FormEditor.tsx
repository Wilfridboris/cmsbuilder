"use client";

import { useId, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Check, Loader2, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { ConfirmActionDialog } from "@/components/invoices/ConfirmActionDialog";
import { FormPublishShare } from "@/components/forms/FormPublishShare";
import {
  renameForm,
  updateFormSlug,
  deleteForm,
  FormApiError,
} from "@/lib/data/forms-client";
import type { PublishabilityReason } from "@/lib/forms/publishability";

/**
 * FormEditor (Epic 14, Stories 14.1 + 14.3) — the Admin-only form editor. Independent
 * sections, each with its own pending/error state:
 *   - Rename   : edit the title (slug is NOT auto-changed; allowed in any state);
 *   - Slug     : edit the public slug while UNPUBLISHED (the control locks with an
 *                unpublish hint once published — the public URL freezes on publish);
 *   - Target   : the heuristic-chosen target table, shown READ-ONLY (reassignment is 14.4);
 *   - Publish + Share : the publish toggle and share surface ({@link FormPublishShare});
 *   - Delete   : confirmed via the shared ConfirmActionDialog (destructive), never a
 *                native confirm(); on success routes back to the list.
 *
 * Published state is lifted here so the slug lock and the publish toggle stay in sync:
 * `FormPublishShare` owns the toggle but reports changes up via `onPublishedChange`.
 *
 * Each save shows a spinner + disables its control while in flight (React 19
 * `useTransition`) and surfaces a non-technical inline error in a `role="alert"` region.
 * All copy resolves through the `Forms` namespace.
 */

/** Error codes the editor maps to a translated message; anything else → generic. */
const ERROR_KEYS = new Set([
  "titleRequired",
  "slugTaken",
  "slugInvalid",
  "slugLocked",
  "notFound",
  "forbidden",
  "unauthorized",
  "writeFailed",
  "readOnly",
  "genericError",
]);

function resolveError(t: (key: string) => string, code: string): string {
  const short = code.replace(/^Forms\.error\./, "");
  return ERROR_KEYS.has(short) ? t(`error.${short}`) : t("error.genericError");
}

export function FormEditor({
  slug,
  formId,
  initialTitle,
  initialSlug,
  targetTableKey,
  initialPublished,
  publishable,
  publishReason,
}: {
  slug: string;
  formId: string;
  initialTitle: string;
  initialSlug: string;
  targetTableKey: string | null;
  initialPublished: boolean;
  publishable: boolean;
  publishReason: PublishabilityReason;
}) {
  const t = useTranslations("Forms");
  const router = useRouter();

  const [title, setTitle] = useState(initialTitle);
  const [formSlug, setFormSlug] = useState(initialSlug);
  // The slug actually PERSISTED on the server (initial, then whatever a successful slug
  // save normalized to). The share surface builds its URL from this — never from the live
  // `formSlug` input, which may hold an unsaved edit that would 404.
  const [savedSlug, setSavedSlug] = useState(initialSlug);
  // Lifted so the slug control can lock while the publish toggle (owned by
  // FormPublishShare) is on. Kept in sync via onPublishedChange.
  const [published, setPublished] = useState(initialPublished);

  const [titleError, setTitleError] = useState<string | null>(null);
  const [slugError, setSlugError] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const [titleSaved, setTitleSaved] = useState(false);
  const [slugSaved, setSlugSaved] = useState(false);

  const [renaming, startRename] = useTransition();
  const [savingSlug, startSlugSave] = useTransition();
  const [deleting, startDelete] = useTransition();
  const [confirmOpen, setConfirmOpen] = useState(false);

  const titleErrorId = useId();
  const slugErrorId = useId();
  const slugLockId = useId();

  function handleRename(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = title.trim();
    setTitleSaved(false);
    if (trimmed === "") {
      setTitleError(t("error.titleRequired"));
      return;
    }
    setTitleError(null);
    startRename(async () => {
      try {
        await renameForm(slug, formId, trimmed);
        setTitle(trimmed);
        setTitleSaved(true);
      } catch (err) {
        const code = err instanceof FormApiError ? err.code : "genericError";
        setTitleError(resolveError(t, code));
      }
    });
  }

  function handleSlug(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    // Defense in depth: the control is disabled when published, but a published form's
    // URL is frozen — the server would reject with slugLocked regardless.
    if (published) {
      return;
    }
    const trimmed = formSlug.trim();
    setSlugSaved(false);
    if (trimmed === "") {
      setSlugError(t("error.slugInvalid"));
      return;
    }
    setSlugError(null);
    startSlugSave(async () => {
      try {
        const result = await updateFormSlug(slug, formId, trimmed);
        // The server returns the NORMALIZED slug — reflect it in both the input and the
        // persisted-slug value the share surface uses, so the canonical kebab value
        // actually persisted is what Copy/QR/Preview point at.
        setFormSlug(result.slug);
        setSavedSlug(result.slug);
        setSlugSaved(true);
      } catch (err) {
        const code = err instanceof FormApiError ? err.code : "genericError";
        setSlugError(resolveError(t, code));
      }
    });
  }

  function handleDelete() {
    setDeleteError(null);
    startDelete(async () => {
      try {
        await deleteForm(slug, formId);
        setConfirmOpen(false);
        router.push(`/${slug}/forms`);
        router.refresh();
      } catch (err) {
        const code = err instanceof FormApiError ? err.code : "genericError";
        setDeleteError(resolveError(t, code));
        setConfirmOpen(false);
      }
    });
  }

  return (
    <section className="flex flex-col gap-6">
      <header className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold tracking-tight text-balance">
          {t("editorTitle")}
        </h1>
        <p className="max-w-prose text-sm text-muted-foreground text-pretty">
          {t("editorSubtitle")}
        </p>
      </header>

      {/* Rename */}
      <Card>
        <CardHeader>
          <CardTitle>{t("titleLabel")}</CardTitle>
          <CardDescription>{t("titleHelp")}</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleRename} className="flex flex-col gap-3">
            <Label htmlFor="editor-title" className="sr-only">
              {t("titleLabel")}
            </Label>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
              <Input
                id="editor-title"
                value={title}
                disabled={renaming}
                aria-invalid={titleError ? true : undefined}
                aria-describedby={titleError ? titleErrorId : undefined}
                onChange={(event) => {
                  setTitle(event.target.value);
                  setTitleSaved(false);
                }}
                className="flex-1"
              />
              <Button type="submit" className="min-h-12 gap-2" disabled={renaming}>
                {renaming ? (
                  <Loader2 aria-hidden="true" className="size-4 animate-spin" />
                ) : null}
                {renaming ? t("saving") : t("saveTitle")}
              </Button>
            </div>
            {titleError ? (
              <p id={titleErrorId} role="alert" className="text-sm text-destructive">
                {titleError}
              </p>
            ) : titleSaved ? (
              <p role="status" className="flex items-center gap-1 text-sm text-muted-foreground">
                <Check aria-hidden="true" className="size-4" />
                {t("saved")}
              </p>
            ) : null}
          </form>
        </CardContent>
      </Card>

      {/* Slug */}
      <Card>
        <CardHeader>
          <CardTitle>{t("slugLabel")}</CardTitle>
          <CardDescription>{t("slugHelp")}</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSlug} className="flex flex-col gap-3">
            <Label htmlFor="editor-slug" className="sr-only">
              {t("slugLabel")}
            </Label>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
              <Input
                id="editor-slug"
                value={formSlug}
                disabled={savingSlug || published}
                aria-invalid={slugError ? true : undefined}
                aria-describedby={
                  slugError ? slugErrorId : published ? slugLockId : undefined
                }
                onChange={(event) => {
                  setFormSlug(event.target.value);
                  setSlugSaved(false);
                }}
                className="flex-1 font-mono"
              />
              <Button
                type="submit"
                className="min-h-12 gap-2"
                disabled={savingSlug || published}
              >
                {savingSlug ? (
                  <Loader2 aria-hidden="true" className="size-4 animate-spin" />
                ) : null}
                {savingSlug ? t("saving") : t("saveSlug")}
              </Button>
            </div>
            {published ? (
              <p id={slugLockId} className="text-sm text-muted-foreground text-pretty">
                {t("slugLockedHint")}
              </p>
            ) : null}
            {slugError ? (
              <p id={slugErrorId} role="alert" className="text-sm text-destructive">
                {slugError}
              </p>
            ) : slugSaved ? (
              <p role="status" className="flex items-center gap-1 text-sm text-muted-foreground">
                <Check aria-hidden="true" className="size-4" />
                {t("saved")}
              </p>
            ) : null}
          </form>
        </CardContent>
      </Card>

      {/* Target table (read-only — reassignment is Story 14.4) */}
      <Card>
        <CardHeader>
          <CardTitle>{t("targetLabel")}</CardTitle>
          <CardDescription>{t("targetHelp")}</CardDescription>
        </CardHeader>
        <CardContent>
          {targetTableKey ? (
            <Badge variant="outline" className="font-mono text-sm">
              {targetTableKey}
            </Badge>
          ) : (
            <p className="text-sm text-muted-foreground text-pretty">
              {t("targetNone")}
            </p>
          )}
        </CardContent>
      </Card>

      {/* Publish + Share (Story 14.3) */}
      <FormPublishShare
        slug={slug}
        formId={formId}
        orgSlug={slug}
        formSlug={savedSlug}
        initialPublished={initialPublished}
        publishable={publishable}
        publishReason={publishReason}
        onPublishedChange={setPublished}
      />

      {/* Delete */}
      <Card className="border-destructive/40">
        <CardHeader>
          <CardTitle>{t("deleteTitle")}</CardTitle>
          <CardDescription>{t("deleteHelp")}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <Button
            type="button"
            variant="destructive"
            className="min-h-12 w-fit gap-2"
            disabled={deleting}
            onClick={() => setConfirmOpen(true)}
          >
            <Trash2 aria-hidden="true" className="size-4" />
            {t("delete")}
          </Button>
          {deleteError ? (
            <p role="alert" className="text-sm text-destructive">
              {deleteError}
            </p>
          ) : null}
        </CardContent>
      </Card>

      <ConfirmActionDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        onConfirm={handleDelete}
        pending={deleting}
        title={t("deleteConfirmTitle")}
        body={t("deleteConfirmBody")}
        confirmLabel={t("delete")}
        pendingLabel={t("deleting")}
        cancelLabel={t("cancel")}
        icon={Trash2}
        destructive
      />
    </section>
  );
}
