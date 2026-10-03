import { Inbox, Send } from "lucide-react";
import { useTranslations } from "next-intl";

import type { FieldDefinition } from "@/types/db";
import { inputModeFor } from "@/lib/forms/field-input";
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
 * IntakeForm (Story 6.1) — the presentational body of the public intake form at
 * `/forms/{slug}`.
 *
 * Mobile-first, accessible, session-free: one labelled, type-matched input per
 * eligible non-relation field (`htmlFor`/`id` association, never placeholder-only),
 * plus a present-but-UNWIRED submit button (its click handler is Story 6.2). All
 * chrome copy comes from the `IntakeForm` next-intl namespace; per-field labels come
 * from the schema (`field.label`). No submission logic, validation, or form state —
 * all deferred to 6.2.
 *
 * This component is deliberately NOT `AddRecordForm` (dashboard-coupled): it reuses
 * only the pure field-input helpers (`inputModeFor`) and the session-free UI
 * primitives. Relation fields never reach here (filtered out by `intakeFields` /
 * `selectIntakeTable` upstream), so this surface has no relation branch at all.
 *
 * Rendered by both the live form state and the friendly "unavailable" state — the
 * `Unavailable` export shares the same centered card shell so an unknown slug or an
 * org with nothing to collect degrades to calm copy, never an error screen.
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
  /** The business name, shown as the card eyebrow. */
  orgName: string;
  /** The eligible, non-relation fields to render as inputs, in definition order. */
  fields: FieldDefinition[];
};

export function IntakeForm({ orgName, fields }: IntakeFormProps) {
  const t = useTranslations("IntakeForm");

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
        {/* The form is intentionally UNWIRED in 6.1: no `action`/`onSubmit`, and the
            submit is `type="button"` so nothing can be submitted before 6.2. */}
        <form className="flex flex-col gap-5">
          {fields.map((field) => (
            <IntakeField key={field.key} field={field} boolLabels={t} />
          ))}
        </form>
      </CardContent>

      <CardFooter>
        <Button
          type="button"
          size="lg"
          className="min-h-12 w-full gap-2"
        >
          <Send aria-hidden="true" className="size-4" />
          <span>{t("submit")}</span>
        </Button>
      </CardFooter>
    </FormShell>
  );
}

/** A translator scoped to the `IntakeForm` namespace (the only caller passes it). */
type IntakeTranslator = ReturnType<typeof useTranslations<"IntakeForm">>;

/** One labelled, type-matched field: a `<Label>` above its input, associated by id. */
function IntakeField({
  field,
  boolLabels,
}: {
  field: FieldDefinition;
  boolLabels: IntakeTranslator;
}) {
  const id = `intake-${field.key}`;

  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor={id} className="text-sm font-medium">
        {field.label}
      </Label>
      {field.type === "boolean" ? (
        <BooleanChoice
          id={id}
          label={field.label}
          yesLabel={boolLabels("yes")}
          noLabel={boolLabels("no")}
        />
      ) : (
        <Input
          id={id}
          name={field.key}
          type={HTML_INPUT_TYPE[field.type] ?? "text"}
          inputMode={inputModeFor(field.type)}
          className="min-h-12"
        />
      )}
    </div>
  );
}

/**
 * A two-option Yes/No segmented control for a `boolean` field, mirroring the
 * dashboard `BooleanToggle` pattern (`role="radiogroup"`, ≥48px options). Unwired in
 * 6.1: the options carry no selection state or handler — 6.2 owns form state. The
 * group is associated to its field via the `<Label htmlFor>` pointing at `id`.
 */
function BooleanChoice({
  id,
  label,
  yesLabel,
  noLabel,
}: {
  id: string;
  label: string;
  yesLabel: string;
  noLabel: string;
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
          aria-checked={false}
          className={cn(
            "min-h-12 min-w-12 bg-background px-4 text-sm text-foreground transition-colors",
            "hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset",
          )}
        >
          {option.text}
        </button>
      ))}
    </div>
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
 * chrome, an entrance animation, and the `Card` primitive at `max-w-lg`. Both the
 * live form and the unavailable state render inside it so they read as one surface.
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
