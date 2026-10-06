"use client";

import { useId, useState } from "react";
import { useTranslations } from "next-intl";
import { Lock } from "lucide-react";

import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";

/**
 * SensitivityBadge (Story 8.3) — a small padlock shown beside a sensitive field
 * in the authenticated table and card record views (FR40 / UX-DR12 trust
 * signal). Tapping, hovering, or keyboard-focusing the padlock reveals a
 * plain-language, PIPEDA-reassuring message (NFR-S2: encrypted at rest,
 * Canadian servers only).
 *
 * This is read-only presentation of the existing `FieldDefinition.sensitive`
 * flag — it never gates, masks, or alters the value.
 *
 * Why a Popover (not a Tooltip): the AC requires reveal on tap OR hover, and
 * the card view is the mobile surface. A Radix Tooltip covers hover + focus
 * but not touch tap, so it would fail the AC on mobile. We reuse `popover.tsx`
 * (as `OverrideControl` does): the Popover opens on tap/click + keyboard
 * natively; hover (`onMouseEnter`/`onMouseLeave`) and focus
 * (`onFocus`/`onBlur`) openers are layered on. `onOpenAutoFocus` is prevented
 * on the content so the hover/focus reveal never steals or traps keyboard
 * focus.
 *
 * Accessibility: the reveal message lives in a portaled `PopoverContent` whose
 * auto-focus is suppressed, so assistive tech never reaches it. We therefore
 * also expose the message as a visually-hidden description linked to the
 * trigger via `aria-describedby`, so a screen-reader user hears both the
 * "sensitive field" label and the protection message. The tap target is padded
 * toward the 44px mobile minimum while the icon stays visually small.
 */
export function SensitivityBadge({ className }: { className?: string }) {
  const t = useTranslations("Sensitivity");
  const [open, setOpen] = useState(false);
  const descriptionId = useId();
  const message = t("message");

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={t("indicatorLabel")}
          aria-describedby={descriptionId}
          onMouseEnter={() => setOpen(true)}
          onMouseLeave={() => setOpen(false)}
          onFocus={() => setOpen(true)}
          onBlur={() => setOpen(false)}
          className={cn(
            "inline-flex shrink-0 items-center justify-center rounded-md p-2.5 text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            className,
          )}
        >
          <Lock aria-hidden="true" className="size-3.5" />
          <span id={descriptionId} className="sr-only">
            {message}
          </span>
        </button>
      </PopoverTrigger>
      <PopoverContent
        side="top"
        onOpenAutoFocus={(event) => event.preventDefault()}
        className="w-auto max-w-56 text-sm text-pretty motion-reduce:animate-none"
      >
        {message}
      </PopoverContent>
    </Popover>
  );
}
