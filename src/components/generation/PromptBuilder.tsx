"use client";

import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";

import { Button } from "@/components/ui/button";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  TRADE_KEYS,
  createPromptIntentSchema,
  saveIntent,
  type PromptIntentInput,
} from "@/lib/generation/intent";
import type { Locale } from "@/lib/i18n/config";

/**
 * The landing "conversation" screen (Story 1.3): a single-focus guided
 * "Mad Libs" form — trade-type dropdown, city/town field, "what you track"
 * field, one primary CTA.
 *
 * Validation runs on submit only (never per keystroke). On a valid submit the
 * typed `GenerationIntent` is persisted to the anonymous session via
 * `saveIntent()` and the app hands off to `/generate` (Story 1.4's pipeline
 * replaces that route's stub). This component captures input only — no account,
 * email, generation, LLM call, or database write.
 */
export function PromptBuilder() {
  const t = useTranslations("PromptBuilder");
  const locale = useLocale() as Locale;
  const router = useRouter();

  const form = useForm<PromptIntentInput>({
    // Submit-only validation, per the intake spec — never per keystroke.
    mode: "onSubmit",
    reValidateMode: "onSubmit",
    resolver: zodResolver(createPromptIntentSchema(t)),
    defaultValues: {
      // `undefined` keeps the Select in its placeholder state until chosen.
      tradeType: undefined,
      city: "",
      whatYouTrack: "",
    },
  });

  function onSubmit(values: PromptIntentInput) {
    saveIntent({ ...values, submittedLocale: locale });
    router.push("/generate");
  }

  return (
    <Form {...form}>
      <form
        onSubmit={form.handleSubmit(onSubmit)}
        noValidate
        className="w-full"
      >
        <fieldset className="flex flex-col gap-6">
          <legend className="sr-only">{t("legend")}</legend>

          <FormField
            control={form.control}
            name="tradeType"
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t("tradeLabel")}</FormLabel>
                <Select
                  onValueChange={field.onChange}
                  value={field.value ?? ""}
                >
                  <FormControl>
                    <SelectTrigger
                      ref={field.ref}
                      onBlur={field.onBlur}
                      className="min-h-12 w-full"
                    >
                      <SelectValue placeholder={t("tradePlaceholder")} />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    {TRADE_KEYS.map((key) => (
                      <SelectItem key={key} value={key} className="min-h-12">
                        {t(`trade.${key}`)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="city"
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t("cityLabel")}</FormLabel>
                <FormControl>
                  <Input
                    {...field}
                    autoComplete="off"
                    placeholder={t("cityPlaceholder")}
                    className="min-h-12"
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="whatYouTrack"
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t("trackLabel")}</FormLabel>
                <FormControl>
                  <Textarea
                    {...field}
                    rows={3}
                    placeholder={t("trackPlaceholder")}
                    className="min-h-24 resize-y"
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <Button type="submit" size="lg" className="min-h-12 w-full text-base">
            {t("cta")}
          </Button>
        </fieldset>
      </form>
    </Form>
  );
}
