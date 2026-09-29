"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { CheckCircle2, ImageUp, Loader2, Save } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  ENTITY_TYPES,
  PROFILE_LANGUAGES,
} from "@/app/api/business-profile/schemas";
import type { BusinessEntityType, BusinessProfileLanguage } from "@/types/db";
import {
  BusinessProfileApiError,
  getBusinessProfile,
  saveBusinessProfile,
  uploadBusinessProfileLogo,
  type BusinessProfileInput,
} from "@/lib/data/business-profile-client";

/**
 * BusinessProfileForm (Story 12.1) — the Admin-only company-identity capture
 * surface under Settings. Loads the org's singleton profile via
 * `GET /api/business-profile`, saves it via `PUT`, and uploads the logo on its own
 * multipart route. Mirrors `InviteForm`'s proven patterns (`useId()` ARIA wiring,
 * inline `<p role="alert">` errors, motion gated by `useReducedMotion`) and adds
 * grouped `<fieldset>` sections so the long form stays scannable and accessible.
 *
 * All copy resolves through the `BusinessProfile` next-intl namespace (EN + FR).
 * Server error codes map to translated inline messages — a raw error never shows.
 * The page already gates non-Admins; the PUT/logo routes re-enforce Admin server-
 * side (frontend gating is never the sole gate).
 */

/** Server error codes this form maps to a translated inline message. */
const ERROR_KEYS = new Set([
  "legalNameRequired",
  "registrationPairRequired",
  "logoInvalid",
  "forbidden",
  "unauthorized",
  "loadFailed",
  "writeFailed",
  "genericError",
]);

/** Editable form state — all strings for controlled inputs; "" means empty. */
type FormState = {
  legalName: string;
  operatingName: string;
  entityType: BusinessEntityType | "";
  jurisdiction: string;
  gstHstNumber: string;
  gstHstEffectiveDate: string;
  businessAddress: string;
  mailingAddress: string;
  defaultPaymentTerms: string;
  defaultLanguage: BusinessProfileLanguage;
  etransferEmail: string;
  chequePayableTo: string;
  chequeAddress: string;
  cardLink: string;
};

const EMPTY_FORM: FormState = {
  legalName: "",
  operatingName: "",
  entityType: "",
  jurisdiction: "",
  gstHstNumber: "",
  gstHstEffectiveDate: "",
  businessAddress: "",
  mailingAddress: "",
  defaultPaymentTerms: "",
  defaultLanguage: "en",
  etransferEmail: "",
  chequePayableTo: "",
  chequeAddress: "",
  cardLink: "",
};

/** Map the editable state to the PUT input; "" collapses to undefined. */
function toInput(form: FormState): BusinessProfileInput {
  const blankToUndef = (v: string) => (v.trim() === "" ? undefined : v.trim());
  return {
    legalName: form.legalName.trim(),
    operatingName: blankToUndef(form.operatingName),
    entityType: form.entityType === "" ? undefined : form.entityType,
    jurisdiction: blankToUndef(form.jurisdiction),
    gstHstNumber: blankToUndef(form.gstHstNumber),
    gstHstEffectiveDate: blankToUndef(form.gstHstEffectiveDate),
    businessAddress: blankToUndef(form.businessAddress),
    mailingAddress: blankToUndef(form.mailingAddress),
    defaultPaymentTerms: blankToUndef(form.defaultPaymentTerms),
    defaultLanguage: form.defaultLanguage,
    paymentInstructions: {
      etransferEmail: blankToUndef(form.etransferEmail),
      chequePayableTo: blankToUndef(form.chequePayableTo),
      chequeAddress: blankToUndef(form.chequeAddress),
      cardLink: blankToUndef(form.cardLink),
    },
  };
}

const ENTITY_TYPE_LABEL_KEY: Record<BusinessEntityType, string> = {
  sole_proprietor: "entityTypeSoleProprietor",
  partnership: "entityTypePartnership",
  corporation: "entityTypeCorporation",
  nonprofit: "entityTypeNonprofit",
  other: "entityTypeOther",
};

export function BusinessProfileForm({ slug }: { slug: string }) {
  const t = useTranslations("BusinessProfile");
  const prefersReducedMotion = useReducedMotion();

  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState<"idle" | "saving" | "saved">("idle");
  const [error, setError] = useState<string | null>(null);
  // Which field(s) the current error points at, so only the offending input is
  // marked aria-invalid (never a valid field). null = a form-level error.
  const [errorField, setErrorField] = useState<"legalName" | "gstPair" | null>(
    null,
  );

  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const [logoUploading, setLogoUploading] = useState(false);
  const [logoError, setLogoError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const legalNameId = useId();
  const operatingNameId = useId();
  const entityTypeId = useId();
  const jurisdictionId = useId();
  const gstNumberId = useId();
  const gstDateId = useId();
  const businessAddressId = useId();
  const mailingAddressId = useId();
  const paymentTermsId = useId();
  const languageId = useId();
  const etransferId = useId();
  const chequeToId = useId();
  const chequeAddressId = useId();
  const cardLinkId = useId();
  const logoInputId = useId();
  const errorId = useId();
  const logoErrorId = useId();

  // The server returns either a short code (forbidden, writeFailed, ...) or a
  // frozen fully-qualified key (BusinessProfile.error.legalNameRequired) for the
  // schema/logo failures. Normalize to the short code before resolving so the
  // precise field message renders instead of a generic fallback.
  const shortCode = (code: string | null): string | null =>
    code ? code.replace(/^BusinessProfile\.error\./, "") : null;

  const resolveError = (code: string | null): string => {
    const short = shortCode(code);
    return short && ERROR_KEYS.has(short)
      ? t(`error.${short}`)
      : t("error.genericError");
  };

  // Load the org's saved profile (or an empty form when none exists yet).
  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const payload = await getBusinessProfile(slug);
        if (!active) return;
        if (payload) {
          const p = payload.profile;
          setForm({
            legalName: p.legal_name ?? "",
            operatingName: p.operating_name ?? "",
            entityType: p.entity_type ?? "",
            jurisdiction: p.jurisdiction ?? "",
            gstHstNumber: p.gst_hst_number ?? "",
            gstHstEffectiveDate: p.gst_hst_effective_date ?? "",
            businessAddress: p.business_address ?? "",
            mailingAddress: p.mailing_address ?? "",
            defaultPaymentTerms: p.default_payment_terms ?? "",
            defaultLanguage: p.default_language,
            etransferEmail: p.payment_etransfer_email ?? "",
            chequePayableTo: p.payment_cheque_payable_to ?? "",
            chequeAddress: p.payment_cheque_address ?? "",
            cardLink: p.payment_card_link ?? "",
          });
          setLogoUrl(payload.logoUrl);
        }
      } catch (err) {
        if (!active) return;
        const code = err instanceof BusinessProfileApiError ? err.code : null;
        setError(resolveError(code ?? "loadFailed"));
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug]);

  const update =
    <K extends keyof FormState>(key: K) =>
    (value: FormState[K]) => {
      setForm((f) => ({ ...f, [key]: value }));
      if (error) {
        setError(null);
        setErrorField(null);
      }
      if (status === "saved") setStatus("idle");
    };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setStatus("saving");
    setError(null);
    setErrorField(null);
    try {
      const payload = await saveBusinessProfile(slug, toInput(form));
      setLogoUrl(payload.logoUrl);
      setStatus("saved");
    } catch (err) {
      const code = err instanceof BusinessProfileApiError ? err.code : null;
      const short = shortCode(code);
      setError(resolveError(code));
      setErrorField(
        short === "legalNameRequired"
          ? "legalName"
          : short === "registrationPairRequired"
            ? "gstPair"
            : null,
      );
      setStatus("idle");
    }
  };

  const handleLogoChange = async (
    event: React.ChangeEvent<HTMLInputElement>,
  ) => {
    const file = event.target.files?.[0];
    // Reset the input so re-selecting the same file re-fires change.
    event.target.value = "";
    if (!file) return;
    setLogoUploading(true);
    setLogoError(null);
    try {
      const payload = await uploadBusinessProfileLogo(slug, file);
      setLogoUrl(payload.logoUrl);
    } catch (err) {
      const code = err instanceof BusinessProfileApiError ? err.code : null;
      setLogoError(resolveError(code ?? "logoInvalid"));
    } finally {
      setLogoUploading(false);
    }
  };

  const reveal = prefersReducedMotion
    ? { initial: { opacity: 0 }, animate: { opacity: 1 } }
    : { initial: { opacity: 0, y: 8 }, animate: { opacity: 1, y: 0 } };

  if (loading) {
    return (
      <section aria-busy="true" className="flex flex-col gap-6">
        <div className="h-7 w-48 animate-pulse rounded-md bg-muted" />
        <div className="h-4 w-full max-w-prose animate-pulse rounded-md bg-muted" />
        <div className="flex flex-col gap-4">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="h-12 w-full animate-pulse rounded-md bg-muted" />
          ))}
        </div>
        <span className="sr-only">{t("loading")}</span>
      </section>
    );
  }

  return (
    <motion.form
      {...reveal}
      transition={{ duration: 0.25 }}
      onSubmit={handleSubmit}
      className="flex flex-col gap-10"
    >
      <header className="flex flex-col gap-2">
        <h2 className="text-2xl font-semibold tracking-tight text-balance">
          {t("title")}
        </h2>
        <p className="max-w-prose text-sm text-muted-foreground text-pretty">
          {t("subtitle")}
        </p>
      </header>

      {/* Company identity */}
      <fieldset className="flex flex-col gap-5">
        <legend className="mb-1 text-sm font-semibold tracking-tight text-foreground">
          {t("identityHeading")}
        </legend>

        <Field
          id={legalNameId}
          label={t("legalNameLabel")}
          hint={t("legalNameHint")}
        >
          <Input
            id={legalNameId}
            required
            value={form.legalName}
            placeholder={t("legalNamePlaceholder")}
            autoComplete="organization"
            aria-invalid={errorField === "legalName"}
            aria-describedby={errorField === "legalName" ? errorId : undefined}
            onChange={(e) => update("legalName")(e.target.value)}
            className="min-h-12"
          />
        </Field>

        <Field
          id={operatingNameId}
          label={t("operatingNameLabel")}
          hint={t("operatingNameHint")}
        >
          <Input
            id={operatingNameId}
            value={form.operatingName}
            placeholder={t("operatingNamePlaceholder")}
            onChange={(e) => update("operatingName")(e.target.value)}
            className="min-h-12"
          />
        </Field>

        <div className="grid gap-5 sm:grid-cols-2">
          <Field id={entityTypeId} label={t("entityTypeLabel")}>
            <Select
              value={form.entityType === "" ? undefined : form.entityType}
              onValueChange={(v) => update("entityType")(v as BusinessEntityType)}
            >
              <SelectTrigger id={entityTypeId} className="min-h-12 w-full">
                <SelectValue placeholder={t("entityTypePlaceholder")} />
              </SelectTrigger>
              <SelectContent>
                {ENTITY_TYPES.map((value) => (
                  <SelectItem key={value} value={value}>
                    {t(ENTITY_TYPE_LABEL_KEY[value])}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>

          <Field
            id={jurisdictionId}
            label={t("jurisdictionLabel")}
            hint={t("jurisdictionHint")}
          >
            <Input
              id={jurisdictionId}
              value={form.jurisdiction}
              placeholder={t("jurisdictionPlaceholder")}
              onChange={(e) => update("jurisdiction")(e.target.value)}
              className="min-h-12"
            />
          </Field>
        </div>
      </fieldset>

      {/* Tax registration */}
      <fieldset className="flex flex-col gap-5">
        <legend className="mb-1 text-sm font-semibold tracking-tight text-foreground">
          {t("taxHeading")}
        </legend>
        <div className="grid gap-5 sm:grid-cols-2">
          <Field
            id={gstNumberId}
            label={t("gstHstNumberLabel")}
            hint={t("gstHstNumberHint")}
          >
            <Input
              id={gstNumberId}
              value={form.gstHstNumber}
              placeholder={t("gstHstNumberPlaceholder")}
              inputMode="text"
              aria-invalid={errorField === "gstPair"}
              aria-describedby={errorField === "gstPair" ? errorId : undefined}
              onChange={(e) => update("gstHstNumber")(e.target.value)}
              className="min-h-12"
            />
          </Field>

          <Field
            id={gstDateId}
            label={t("gstHstEffectiveDateLabel")}
            hint={t("gstHstEffectiveDateHint")}
          >
            <Input
              id={gstDateId}
              type="date"
              value={form.gstHstEffectiveDate}
              aria-invalid={errorField === "gstPair"}
              aria-describedby={errorField === "gstPair" ? errorId : undefined}
              onChange={(e) => update("gstHstEffectiveDate")(e.target.value)}
              className="min-h-12"
            />
          </Field>
        </div>
      </fieldset>

      {/* Logo */}
      <fieldset className="flex flex-col gap-4">
        <legend className="mb-1 text-sm font-semibold tracking-tight text-foreground">
          {t("logoHeading")}
        </legend>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={logoInputId}>{t("logoLabel")}</Label>
          <p className="text-sm text-muted-foreground text-pretty">
            {t("logoHint")}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-4">
          {logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={logoUrl}
              alt={t("logoCurrentAlt")}
              className="size-16 rounded-lg border border-border object-contain bg-muted/30"
            />
          ) : (
            <div
              aria-hidden="true"
              className="flex size-16 items-center justify-center rounded-lg border border-dashed border-border bg-muted/30 text-muted-foreground"
            >
              <ImageUp className="size-6" />
            </div>
          )}

          <Button
            type="button"
            variant="outline"
            disabled={logoUploading}
            onClick={() => fileInputRef.current?.click()}
            className="min-h-12 gap-2"
          >
            {logoUploading ? (
              <Loader2 aria-hidden="true" className="size-4 animate-spin" />
            ) : (
              <ImageUp aria-hidden="true" className="size-4" />
            )}
            <span>
              {logoUploading
                ? t("logoUploading")
                : logoUrl
                  ? t("logoReplace")
                  : t("logoButton")}
            </span>
          </Button>

          {/* Real file input, visually hidden but keyboard-reachable via the button. */}
          <input
            ref={fileInputRef}
            id={logoInputId}
            type="file"
            accept="image/png,image/jpeg"
            className="sr-only"
            aria-describedby={logoError ? logoErrorId : undefined}
            onChange={handleLogoChange}
          />
        </div>

        <AnimatePresence>
          {logoError ? (
            <motion.p
              key="logo-error"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              id={logoErrorId}
              role="alert"
              className="text-sm text-destructive"
            >
              {logoError}
            </motion.p>
          ) : null}
        </AnimatePresence>
      </fieldset>

      {/* Addresses */}
      <fieldset className="flex flex-col gap-5">
        <legend className="mb-1 text-sm font-semibold tracking-tight text-foreground">
          {t("addressHeading")}
        </legend>
        <Field
          id={businessAddressId}
          label={t("businessAddressLabel")}
          hint={t("businessAddressHint")}
        >
          <Textarea
            id={businessAddressId}
            value={form.businessAddress}
            rows={3}
            onChange={(e) => update("businessAddress")(e.target.value)}
          />
        </Field>
        <Field
          id={mailingAddressId}
          label={t("mailingAddressLabel")}
          hint={t("mailingAddressHint")}
        >
          <Textarea
            id={mailingAddressId}
            value={form.mailingAddress}
            rows={3}
            onChange={(e) => update("mailingAddress")(e.target.value)}
          />
        </Field>
      </fieldset>

      {/* Invoice defaults */}
      <fieldset className="flex flex-col gap-5">
        <legend className="mb-1 text-sm font-semibold tracking-tight text-foreground">
          {t("defaultsHeading")}
        </legend>
        <div className="grid gap-5 sm:grid-cols-2">
          <Field
            id={paymentTermsId}
            label={t("defaultPaymentTermsLabel")}
            hint={t("defaultPaymentTermsHint")}
          >
            <Input
              id={paymentTermsId}
              value={form.defaultPaymentTerms}
              placeholder={t("defaultPaymentTermsPlaceholder")}
              onChange={(e) => update("defaultPaymentTerms")(e.target.value)}
              className="min-h-12"
            />
          </Field>

          <Field id={languageId} label={t("defaultLanguageLabel")}>
            <Select
              value={form.defaultLanguage}
              onValueChange={(v) =>
                update("defaultLanguage")(v as BusinessProfileLanguage)
              }
            >
              <SelectTrigger id={languageId} className="min-h-12 w-full">
                <SelectValue placeholder={t("defaultLanguagePlaceholder")} />
              </SelectTrigger>
              <SelectContent>
                {PROFILE_LANGUAGES.map((value) => (
                  <SelectItem key={value} value={value}>
                    {value === "en"
                      ? t("defaultLanguageEn")
                      : t("defaultLanguageFr")}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
        </div>
      </fieldset>

      {/* Payment instructions */}
      <fieldset className="flex flex-col gap-5">
        <legend className="mb-1 flex flex-col gap-1">
          <span className="text-sm font-semibold tracking-tight text-foreground">
            {t("paymentHeading")}
          </span>
          <span className="text-sm font-normal text-muted-foreground text-pretty">
            {t("paymentSubtitle")}
          </span>
        </legend>

        <Field id={etransferId} label={t("etransferEmailLabel")}>
          <Input
            id={etransferId}
            type="email"
            inputMode="email"
            value={form.etransferEmail}
            placeholder={t("etransferEmailPlaceholder")}
            onChange={(e) => update("etransferEmail")(e.target.value)}
            className="min-h-12"
          />
        </Field>

        <div className="grid gap-5 sm:grid-cols-2">
          <Field id={chequeToId} label={t("chequePayableToLabel")}>
            <Input
              id={chequeToId}
              value={form.chequePayableTo}
              placeholder={t("chequePayableToPlaceholder")}
              onChange={(e) => update("chequePayableTo")(e.target.value)}
              className="min-h-12"
            />
          </Field>

          <Field
            id={cardLinkId}
            label={t("cardLinkLabel")}
            hint={t("cardLinkHint")}
          >
            <Input
              id={cardLinkId}
              type="url"
              inputMode="url"
              value={form.cardLink}
              placeholder={t("cardLinkPlaceholder")}
              onChange={(e) => update("cardLink")(e.target.value)}
              className="min-h-12"
            />
          </Field>
        </div>

        <Field
          id={chequeAddressId}
          label={t("chequeAddressLabel")}
          hint={t("chequeAddressHint")}
        >
          <Textarea
            id={chequeAddressId}
            value={form.chequeAddress}
            rows={3}
            onChange={(e) => update("chequeAddress")(e.target.value)}
          />
        </Field>
      </fieldset>

      <AnimatePresence>
        {error ? (
          <motion.p
            key="error"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            id={errorId}
            role="alert"
            className="text-sm text-destructive"
          >
            {error}
          </motion.p>
        ) : null}
      </AnimatePresence>

      <div className="flex flex-wrap items-center gap-4">
        <Button
          type="submit"
          disabled={status === "saving"}
          aria-describedby={error ? errorId : undefined}
          className="min-h-12 gap-2"
        >
          {status === "saving" ? (
            <Loader2 aria-hidden="true" className="size-4 animate-spin" />
          ) : (
            <Save aria-hidden="true" className="size-4" />
          )}
          <span>{status === "saving" ? t("saving") : t("save")}</span>
        </Button>

        <AnimatePresence>
          {status === "saved" ? (
            <motion.div
              key="saved"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              role="status"
              className="flex items-center gap-2 text-sm"
            >
              <CheckCircle2
                aria-hidden="true"
                className="size-4 shrink-0 text-primary"
              />
              <span className="flex flex-col">
                <span className="font-medium text-foreground">
                  {t("savedTitle")}
                </span>
                <span className="text-muted-foreground text-pretty">
                  {t("savedBody")}
                </span>
              </span>
            </motion.div>
          ) : null}
        </AnimatePresence>
      </div>
    </motion.form>
  );
}

/** A labeled field wrapper: `<Label>` + optional hint + the control, ARIA-wired. */
function Field({
  id,
  label,
  hint,
  children,
}: {
  id: string;
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  const hintId = `${id}-hint`;
  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor={id}>{label}</Label>
      {children}
      {hint ? (
        <p id={hintId} className="text-sm text-muted-foreground text-pretty">
          {hint}
        </p>
      ) : null}
    </div>
  );
}
