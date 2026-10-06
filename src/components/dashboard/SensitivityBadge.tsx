"use client";

import { useId, useRef, useState } from "react";
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
 * (as `OverrideControl` does).
 *
 * Open is a derived intent: `hovered || keyboard-focused || tap-pinned`.
 * - Hover/focus openers live on a host span, not on the Slotted trigger:
 *   through `PopoverTrigger asChild` the trigger's own merged handlers do not
 *   fire, so the reveal would otherwise only open on click.
 * - Focus only counts as a keyboard reveal when it arrives while the pointer is
 *   NOT over the trigger. Radix focuses the trigger when it opens, and Chromium
 *   reports that programmatic focus as `:focus-visible`, so `:focus-visible`
 *   alone cannot tell a keyboard tab from a hover-induced focus; the hover ref
 *   does, which is what lets pointer-leave actually dismiss.
 * - Tap/click (the touch path, where there is no hover or keyboard focus) is
 *   Radix-driven via `onOpenChange`; any close request (second tap, Escape,
 *   outside pointer-down) drops every intent so it actually dismisses.
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
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [pinned, setPinned] = useState(false);
  const hoveredRef = useRef(false);
  const descriptionId = useId();
  const message = t("message");
  const open = hovered || focused || pinned;

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        if (next) {
          setPinned(true);
        } else {
          setPinned(false);
          setHovered(false);
          setFocused(false);
        }
      }}
    >
      <span
        className="inline-flex"
        onMouseEnter={() => {
          hoveredRef.current = true;
          setHovered(true);
        }}
        onMouseLeave={() => {
          hoveredRef.current = false;
          setHovered(false);
        }}
        onFocus={(event) => {
          if (
            !hoveredRef.current &&
            event.target instanceof Element &&
            event.target.matches(":focus-visible")
          ) {
            setFocused(true);
          }
        }}
        onBlur={() => setFocused(false)}
      >
        <PopoverTrigger asChild>
          <button
            type="button"
            aria-label={t("indicatorLabel")}
            aria-describedby={descriptionId}
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
      </span>
      <PopoverContent
        side="top"
        onOpenAutoFocus={(event) => event.preventDefault()}
        onCloseAutoFocus={(event) => event.preventDefault()}
        className="pointer-events-none w-auto max-w-56 text-sm text-pretty motion-reduce:animate-none"
      >
        {message}
      </PopoverContent>
    </Popover>
  );
}
