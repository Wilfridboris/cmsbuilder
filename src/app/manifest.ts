import type { MetadataRoute } from "next";

/**
 * Web App Manifest (Story 8.2) — Next 16's native `app/manifest.ts` convention
 * (`MetadataRoute.Manifest`), served at `/manifest.webmanifest` and auto-linked
 * into every page's `<head>` by Next — no manual `<link rel="manifest">`.
 *
 * Values mirror `scheza-brand-kit/web/site.webmanifest` (the single source of
 * brand truth) with ONE deliberate deviation: `start_url` points at the `/home`
 * resolver route, not `/`. The public `/` landing serves the PromptBuilder to
 * everyone and must stay untouched; `/home` resolves the signed-in user's
 * primary org server-side and lands the installed app directly on `/{slug}`
 * (session-less → `/login`). See the spec's "dedicated start_url resolver" note.
 *
 * `display: standalone` + the three brand icons (192, 512, maskable-512) satisfy
 * browser installability. The maskable icon lets Android crop to any mask shape
 * without clipping the logo.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Scheza",
    short_name: "Scheza",
    start_url: "/home",
    display: "standalone",
    background_color: "#FFC69A",
    theme_color: "#342350",
    icons: [
      {
        src: "/icon-192.png",
        sizes: "192x192",
        type: "image/png",
      },
      {
        src: "/icon-512.png",
        sizes: "512x512",
        type: "image/png",
      },
      {
        src: "/icon-maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
