"use client";

import { useId, useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { Check, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { updateFormIntroText, FormApiError } from "@/lib/data/forms-client";
import { resolveFormError } from "@/lib/forms/error-copy";

/**
 * FormIntroCard (Epic 14, Story 14.6; extracted from FormEditor per the Epic 14 retro
 * finding F5) — the owner-authored intro/info message rendered above the public form's
 * fields. Owns its own pending/error/saved state exactly as the sibling cards do; editable
 * while published (the intro never changes where responses land). Save is enabled only
 * when the draft differs from what is persisted (clearing counts as a change). The server
 * is authoritative on the trim-and-null-if-blank rule; the trim here only gates the request.
 * The extraction is behavior- and appearance-preserving.
 */

/** Server error codes this card maps to a translated message; anything else → generic. */
const ERROR_KEYS = new Set([
  "introTooLong",
  "notFound",
  "forbidden",
  "unauthorized",
  "writeFailed",
  "readOnly",
  "genericError",
]);

export function FormIntroCard({
  slug,
  formId,
  initialIntroText,
}: {
  slug: string;
  formId: string;
  initialIntroText: string | null;
}) {
  const t = useTranslations("Forms");

  const [introText, setIntroText] = useState(initialIntroText ?? "");
  const [savedIntro, setSavedIntro] = useState(initialIntroText ?? "");
  const [introError, setIntroError] = useState<string | null>(null);
  const [introSaved, setIntroSaved] = useState(false);
  const [savingIntro, startIntroSave] = useTransition();

  const introFieldId = useId();
  const introErrorId = useId();

  function handleIntro(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIntroSaved(false);
    // Trim for the no-op check so re-saving unchanged whitespace doesn't write. The server
    // is authoritative on the trim-and-null-if-blank rule; this only gates the request.
    if (introText.trim() === savedIntro.trim()) {
      return;
    }
    setIntroError(null);
    startIntroSave(async () => {
      try {
        await updateFormIntroText(slug, formId, introText);
        setSavedIntro(introText);
        setIntroSaved(true);
      } catch (err) {
        const code = err instanceof FormApiError ? err.code : "genericError";
        setIntroError(resolveFormError(t, code, ERROR_KEYS));
      }
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("introTitle")}</CardTitle>
        <CardDescription>{t("introHelp")}</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleIntro} className="flex flex-col gap-3">
          <Label htmlFor={introFieldId} className="sr-only">
            {t("introLabel")}
          </Label>
          <Textarea
            id={introFieldId}
            value={introText}
            disabled={savingIntro}
            maxLength={500}
            rows={4}
            placeholder={t("introPlaceholder")}
            aria-invalid={introError ? true : undefined}
            aria-describedby={introError ? introErrorId : undefined}
            onChange={(event) => {
              setIntroText(event.target.value);
              setIntroSaved(false);
            }}
          />
          <div className="flex">
            <Button
              type="submit"
              className="min-h-12 gap-2"
              disabled={savingIntro || introText.trim() === savedIntro.trim()}
            >
              {savingIntro ? (
                <Loader2 aria-hidden="true" className="size-4 animate-spin" />
              ) : null}
              {savingIntro ? t("saving") : t("saveIntro")}
            </Button>
          </div>
          {introError ? (
            <p
              id={introErrorId}
              role="alert"
              className="text-sm text-destructive"
            >
              {introError}
            </p>
          ) : introSaved ? (
            <p
              role="status"
              className="flex items-center gap-1 text-sm text-muted-foreground"
            >
              <Check aria-hidden="true" className="size-4" />
              {t("saved")}
            </p>
          ) : null}
        </form>
      </CardContent>
    </Card>
  );
}
