"use client";

import { useId, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Check, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { updateFormTarget, FormApiError } from "@/lib/data/forms-client";
import { resolveFormError } from "@/lib/forms/error-copy";

/**
 * FormTargetCard (Epic 14, Story 14.4; extracted from FormEditor per the Epic 14 retro
 * finding F5) — the Admin picker of the org's visible tables with the stored target
 * pre-selected and a Save action. Locks with an unpublish hint once the form is published
 * (the target freezes on publish), mirroring the slug card. Owns its own
 * pending/error/saved state, exactly as the sibling cards ({@link FormFieldsEditor},
 * FormPublishShare) do — the appearance and behavior are unchanged by the extraction.
 *
 * A stale/hidden stored key matches no option, so the picker shows its placeholder until
 * the Admin picks a valid table. Save is enabled only when the selection differs from the
 * persisted value. On success it refreshes so the server-computed publish gate (which the
 * target drives) re-evaluates without a manual reload.
 */

/** Server error codes this card maps to a translated message; anything else → generic. */
const ERROR_KEYS = new Set([
  "targetInvalid",
  "targetLocked",
  "notFound",
  "forbidden",
  "unauthorized",
  "writeFailed",
  "readOnly",
  "genericError",
]);

export function FormTargetCard({
  slug,
  formId,
  tables,
  initialTargetKey,
  published,
}: {
  slug: string;
  formId: string;
  tables: { key: string; label: string }[];
  /** The stored target table key, or "" when none is set (or it is stale/hidden). */
  initialTargetKey: string;
  /** When true the control is disabled with an unpublish hint (target is frozen). */
  published: boolean;
}) {
  const t = useTranslations("Forms");
  const router = useRouter();

  const [targetKey, setTargetKey] = useState(initialTargetKey);
  const [savedTarget, setSavedTarget] = useState(initialTargetKey);
  const [targetError, setTargetError] = useState<string | null>(null);
  const [targetSaved, setTargetSaved] = useState(false);
  const [savingTarget, startTargetSave] = useTransition();

  const targetSelectId = useId();
  const targetErrorId = useId();
  const targetLockId = useId();

  function handleTarget(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    // Defense in depth: the control is disabled when published, but a published form's
    // target is frozen — the server would reject with targetLocked regardless.
    if (published) {
      return;
    }
    setTargetSaved(false);
    if (targetKey === "" || targetKey === savedTarget) {
      // Nothing to save (no selection, or the selection matches what's persisted).
      return;
    }
    setTargetError(null);
    startTargetSave(async () => {
      try {
        await updateFormTarget(slug, formId, targetKey);
        setSavedTarget(targetKey);
        setTargetSaved(true);
        // The target drives publishability (empty/invalid table -> not publishable). Refresh
        // the server-computed publish gate so the Publish card reflects the new target
        // without a manual reload (the matrix promises the editor re-evaluates).
        router.refresh();
      } catch (err) {
        const code = err instanceof FormApiError ? err.code : "genericError";
        setTargetError(resolveFormError(t, code, ERROR_KEYS));
      }
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("targetLabel")}</CardTitle>
        <CardDescription>{t("targetHelp")}</CardDescription>
      </CardHeader>
      <CardContent>
        {tables.length === 0 ? (
          <p className="text-sm text-muted-foreground text-pretty">
            {t("targetNone")}
          </p>
        ) : (
          <form onSubmit={handleTarget} className="flex flex-col gap-3">
            <Label htmlFor={targetSelectId} className="sr-only">
              {t("targetLabel")}
            </Label>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
              <Select
                value={targetKey === "" ? undefined : targetKey}
                disabled={savingTarget || published}
                onValueChange={(value) => {
                  setTargetKey(value);
                  setTargetSaved(false);
                }}
              >
                <SelectTrigger
                  id={targetSelectId}
                  className="min-h-12 flex-1"
                  aria-invalid={targetError ? true : undefined}
                  aria-describedby={
                    targetError
                      ? targetErrorId
                      : published
                        ? targetLockId
                        : undefined
                  }
                >
                  <SelectValue placeholder={t("targetPlaceholder")} />
                </SelectTrigger>
                <SelectContent>
                  {tables.map((table) => (
                    <SelectItem key={table.key} value={table.key}>
                      {table.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                type="submit"
                className="min-h-12 gap-2"
                disabled={
                  savingTarget ||
                  published ||
                  targetKey === "" ||
                  targetKey === savedTarget
                }
              >
                {savingTarget ? (
                  <Loader2 aria-hidden="true" className="size-4 animate-spin" />
                ) : null}
                {savingTarget ? t("saving") : t("saveTarget")}
              </Button>
            </div>
            {published ? (
              <p
                id={targetLockId}
                className="text-sm text-muted-foreground text-pretty"
              >
                {t("targetLockedHint")}
              </p>
            ) : null}
            {targetError ? (
              <p
                id={targetErrorId}
                role="alert"
                className="text-sm text-destructive"
              >
                {targetError}
              </p>
            ) : targetSaved ? (
              <p
                role="status"
                className="flex items-center gap-1 text-sm text-muted-foreground"
              >
                <Check aria-hidden="true" className="size-4" />
                {t("saved")}
              </p>
            ) : null}
          </form>
        )}
      </CardContent>
    </Card>
  );
}
