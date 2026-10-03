"use client";

import { useId, useRef, useState } from "react";
import { CheckCircle2, Inbox, Loader2, Send } from "lucide-react";
import { useTranslations } from "next-intl";

import type { FieldDefinition } from "@/types/db";
import type { ApiResponse } from "@/types/api";
import { coerceAddValue, inputModeFor } from "@/lib/forms/field-input";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/**
 * IntakeForm (Stories 6.1 + 6.2) — the interactive public intake form at
 * `/forms/{slug}`.
 *
 * Mobile-first, accessible, session-free: one labelled, type-matched input per
 * eligible non-relation field (`htmlFor`/`id` association, never placeholder-only),
 * plus a wired submit. 6.2 makes it interactive: it owns per-field draft + error +
 * submitting + confirmed state, validates on submit (format via `coerceAddValue`,
 * plus "at least one field filled"), POSTs the coerced values to `/api/intake/{slug}`
 * with a stable per-instance `idempotencyKey`, and on a 200 replaces the card body
 * with a warm, owner-named confirmation. A submit failure shows a non-blocking inline
 * `role="alert"` and leaves the filled form intact so the visitor can retry.
 *
 * All chrome copy comes from the `IntakeForm` next-intl namespace; per-field labels
 * come from the schema (`field.label`). Validation is format-only — the schema carries
 * no `required` flag, so a blank field is simply omitted (never a per-field "required").
 *
 * This component is deliberately NOT `AddRecordForm` (dashboard-coupled): it reuses
 * only the pure field-input helpers (`coerceAddValue`, `inputModeFor`) and the
 * session-free UI primitives. Relation fields never reach here (filtered out by
 * `intakeFields` / `selectIntakeTable` upstream), so this surface has no relation
 * branch at all — and the server write path drops any that slip into the payload.
 */

/**
 * Local HTML input-type map (mirrors the dashboard `HTML_INPUT_TYPE` reference, which
 * is NOT imported — it is dashboard-coupled). `relation` never reaches this surface;
 * everything unmapped (text/number/currency) falls back to a plain text input, with
 * `inputModeFor` supplying the mobile keyboard hint.
 */
const HTML_INPUT_TYPE: Partial<Record<FieldDefinition["type"], string>> = {
  email: "email",
  phone: "tel",
  date: "date",
  datetime: "datetime-local",
};

type IntakeFormProps = {
  /** The route slug — the POST target (`/api/intake/{slug}`). */
  slug: string;
  /** The business name, shown as the card eyebrow and named in the confirmation. */
  orgName: string;
  /** The eligible, non-relation fields to render as inputs, in definition order. */
  fields: FieldDefinition[];
};

/** A per-field draft map: scalars hold the raw string, booleans "true"/"false". */
type Draft = Record<string, string>;

/** A blank draft: scalars start empty, booleans default to the "false" choice. */
function blankDraft(fields: FieldDefinition[]): Draft {
  const draft: Draft = {};
  for (const field of fields) {
    draft[field.key] = field.type === "boolean" ? "false" : "";
  }
  return draft;
}

export function IntakeForm({ slug, orgName, fields }: IntakeFormProps) {
  const t = useTranslations("IntakeForm");
  const idBase = useId();

  const [draft, setDraft] = useState<Draft>(() => blankDraft(fields));
  const [fieldErrors, setFieldErrors] = useState<Record<string, boolean>>({});
  const [formError, setFormError] = useState<"emptyForm" | "submitError" | null>(
    null,
  );
  const [pending, setPending] = useState(false);
  const [confirmed, setConfirmed] = useState(false);

  // A stable per-form-instance idempotency key: a retried submit (after a network
  // failure) dedupes to a single logical write server-side. `useRef` so it survives
  // re-renders without regenerating.
  const idempotencyKey = useRef<string>(crypto.randomUUID());

  const setValue = (key: string, value: string) => {
    setDraft((prev) => ({ ...prev, [key]: value }));
    // Clearing a field's error on the next edit keeps the error from lingering.
    if (fieldErrors[key]) {
      setFieldErrors((prev) => ({ ...prev, [key]: false }));
    }
    if (formError) {
      setFormError(null);
    }
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (pending) {
      return;
    }

    // Validate + coerce every field into the client payload (same shape the server
    // re-derives). Blanks are omitted; a bad number/currency is an inline error.
    const values: Record<string, unknown> = {};
    const nextErrors: Record<string, boolean> = {};

    for (const field of fields) {
      if (field.type === "boolean") {
        values[field.key] = draft[field.key] === "true";
        continue;
      }
      const result = coerceAddValue(field.type, draft[field.key] ?? "");
      if (result.kind === "error") {
        nextErrors[field.key] = true;
      } else if (result.kind === "ok") {
        values[field.key] = result.value;
      }
      // `omit` → not added.
    }

    if (Object.keys(nextErrors).length > 0) {
      setFieldErrors(nextErrors);
      return;
    }
    setFieldErrors({});

    // "At least one field filled" — booleans always carry a value, so a form with any
    // boolean field can never be empty; a scalar-only form that is all-blank is.
    if (Object.keys(values).length === 0) {
      setFormError("emptyForm");
      return;
    }

    setFormError(null);
    setPending(true);
    try {
      const res = await fetch(`/api/intake/${encodeURIComponent(slug)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ values, idempotencyKey: idempotencyKey.current }),
      });
      let body: ApiResponse<{ ok: true }>;
      try {
        body = (await res.json()) as ApiResponse<{ ok: true }>;
      } catch {
        throw new Error("parse");
      }
      if (!res.ok || body.error !== null || body.data === null) {
        throw new Error("submit");
      }
      setConfirmed(true);
    } catch {
      // Non-blocking: keep the filled form so the visitor can retry (the same
      // idempotency key makes a retry dedupe server-side).
      setFormError("submitError");
    } finally {
      setPending(false);
    }
  };

  if (confirmed) {
    return <Confirmation owner={orgName} />;
  }

  return (
    <FormShell>
      <CardHeader>
        <p className="text-sm font-medium text-muted-foreground">{orgName}</p>
        <h1 className="text-2xl font-semibold tracking-tight text-balance">
          {t("heading")}
        </h1>
        <p className="text-sm text-muted-foreground text-pretty">
          {t("subtitle")}
        </p>
      </CardHeader>

      <CardContent>
        <form
          id={`${idBase}-form`}
          onSubmit={handleSubmit}
          className="flex flex-col gap-5"
        >
          {fields.map((field) => (
            <IntakeField
              key={field.key}
              field={field}
              value={draft[field.key] ?? ""}
              hasError={Boolean(fieldErrors[field.key])}
              errorMessage={t("invalidNumber")}
              onChange={(value) => setValue(field.key, value)}
              disabled={pending}
              boolLabels={t}
            />
          ))}
        </form>
      </CardContent>

      <CardFooter className="flex-col items-stretch gap-3">
        <Button
          type="submit"
          form={`${idBase}-form`}
          size="lg"
          disabled={pending}
          className="min-h-12 w-full gap-2 disabled:pointer-events-none disabled:opacity-50"
        >
          {pending ? (
            <Loader2 aria-hidden="true" className="size-4 animate-spin" />
          ) : (
            <Send aria-hidden="true" className="size-4" />
          )}
          <span>{pending ? t("sending") : t("submit")}</span>
        </Button>
        {formError ? (
          <p role="alert" className="text-sm text-destructive text-pretty">
            {t(formError)}
          </p>
        ) : null}
      </CardFooter>
    </FormShell>
  );
}

/** A translator scoped to the `IntakeForm` namespace (the only caller passes it). */
type IntakeTranslator = ReturnType<typeof useTranslations<"IntakeForm">>;

/** One labelled, type-matched field: a `<Label>` above its input, associated by id. */
function IntakeField({
  field,
  value,
  hasError,
  errorMessage,
  onChange,
  disabled,
  boolLabels,
}: {
  field: FieldDefinition;
  value: string;
  hasError: boolean;
  errorMessage: string;
  onChange: (value: string) => void;
  disabled: boolean;
  boolLabels: IntakeTranslator;
}) {
  const id = `intake-${field.key}`;
  const errorId = `${id}-error`;

  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor={id} className="text-sm font-medium">
        {field.label}
      </Label>
      {field.type === "boolean" ? (
        <BooleanChoice
          id={id}
          label={field.label}
          value={value === "true"}
          onChange={(next) => onChange(next ? "true" : "false")}
          yesLabel={boolLabels("yes")}
          noLabel={boolLabels("no")}
          disabled={disabled}
        />
      ) : (
        <Input
          id={id}
          name={field.key}
          type={HTML_INPUT_TYPE[field.type] ?? "text"}
          inputMode={inputModeFor(field.type)}
          value={value}
          disabled={disabled}
          aria-invalid={hasError}
          aria-describedby={hasError ? errorId : undefined}
          onChange={(event) => onChange(event.target.value)}
          className="min-h-12"
        />
      )}
      {hasError ? (
        <p id={errorId} role="alert" className="text-xs text-destructive">
          {errorMessage}
        </p>
      ) : null}
    </div>
  );
}

/**
 * A two-option Yes/No segmented control for a `boolean` field, mirroring the
 * dashboard `BooleanToggle` pattern (`role="radiogroup"`, ≥48px options). Wired in
 * 6.2: the selected option carries `aria-checked` and a filled look via semantic
 * tokens; clicking toggles the field's boolean (and clears any error upstream). The
 * group is associated to its field via the `<Label htmlFor>` pointing at `id`.
 */
function BooleanChoice({
  id,
  label,
  value,
  onChange,
  yesLabel,
  noLabel,
  disabled,
}: {
  id: string;
  label: string;
  value: boolean;
  onChange: (next: boolean) => void;
  yesLabel: string;
  noLabel: string;
  disabled: boolean;
}) {
  return (
    <div
      id={id}
      role="radiogroup"
      aria-label={label}
      className="flex w-fit overflow-hidden rounded-md border border-input"
    >
      {[
        { value: true, text: yesLabel },
        { value: false, text: noLabel },
      ].map((option) => (
        <button
          key={String(option.value)}
          type="button"
          role="radio"
          aria-checked={value === option.value}
          disabled={disabled}
          onClick={() => onChange(option.value)}
          className={cn(
            "min-h-12 min-w-12 px-4 text-sm transition-colors",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset",
            "disabled:pointer-events-none disabled:opacity-50",
            value === option.value
              ? "bg-primary text-primary-foreground"
              : "bg-background text-foreground hover:bg-accent",
          )}
        >
          {option.text}
        </button>
      ))}
    </div>
  );
}

/**
 * The warm post-submit confirmation (Story 6.2) that REPLACES the form body on a 200.
 * Same centered card shell, a muted decorative icon, and owner-named copy from the
 * `IntakeForm` namespace. Mounts with a gentle fade. Never error styling, no em-dash.
 */
function Confirmation({ owner }: { owner: string }) {
  const t = useTranslations("IntakeForm");

  return (
    <FormShell>
      <CardHeader className="items-center text-center animate-in fade-in duration-500">
        <CheckCircle2
          aria-hidden="true"
          className="size-10 text-muted-foreground"
        />
        <h1 className="text-2xl font-semibold tracking-tight text-balance">
          {t("confirmationHeading")}
        </h1>
        <p className="text-sm text-muted-foreground text-pretty">
          {t("confirmationBody", { owner })}
        </p>
      </CardHeader>
    </FormShell>
  );
}

/**
 * The friendly "form not available" state (Story 6.1) — shown for an unknown slug or
 * an org with no renderable intake fields. Same centered card shell as the live form,
 * a muted decorative icon, and calm translated copy. Never error styling or a stack
 * (the app's "degrade to friendly copy, never an error screen" rule).
 */
export function Unavailable() {
  const t = useTranslations("IntakeForm");

  return (
    <FormShell>
      <CardHeader className="items-center text-center">
        <Inbox
          aria-hidden="true"
          className="size-10 text-muted-foreground"
        />
        <h1 className="text-2xl font-semibold tracking-tight text-balance">
          {t("unavailableHeading")}
        </h1>
        <p className="text-sm text-muted-foreground text-pretty">
          {t("unavailableBody")}
        </p>
      </CardHeader>
    </FormShell>
  );
}

/**
 * The shared page shell: a full-height centered single column with no dashboard
 * chrome, an entrance animation, and the `Card` primitive at `max-w-lg`. The live
 * form, the confirmation, and the unavailable state all render inside it so they read
 * as one surface.
 */
function FormShell({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-4 py-10 sm:py-16">
      <Card className="w-full max-w-lg animate-in fade-in slide-in-from-bottom-2 duration-500">
        {children}
      </Card>
    </main>
  );
}
