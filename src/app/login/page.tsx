"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { Info } from "lucide-react";

import { LoginForm } from "@/components/auth/LoginForm";

/**
 * `/login` (Story 2.2) — the returning-user login entry point.
 *
 * A dedicated, hyper-minimalist route hosting the email-only `LoginForm`, wrapped
 * by the root layout. It renders a translated status notice above the form when
 * the visitor arrived here from a bounce:
 *   - `?auth=required` — middleware bounced an unauthenticated tenant-route visit;
 *   - `?login=no-org`  — the callback authenticated a user with no membership.
 *
 * Both render a non-alarming `role="status"` notice (mirroring the home page's
 * `ClaimNotice`), never a raw error screen. All copy resolves through the `Login`
 * next-intl namespace (EN + FR).
 */
export default function LoginPage() {
  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center gap-8 px-6 py-16">
      <Suspense fallback={null}>
        <LoginNotice />
      </Suspense>
      <LoginForm />
    </main>
  );
}

/** Translated login notice driven by the middleware / callback redirect. */
function LoginNotice() {
  const t = useTranslations("Login");
  const params = useSearchParams();
  const auth = params.get("auth");
  const login = params.get("login");

  let message: string | null = null;
  if (auth === "required") message = t("authRequired");
  else if (login === "no-org") message = t("noOrg");

  if (!message) return null;

  return (
    <div
      role="status"
      className="flex items-start gap-3 rounded-lg border border-primary/20 bg-primary/5 px-4 py-3 text-sm text-foreground/80"
    >
      <Info aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-primary" />
      <p className="text-pretty">{message}</p>
    </div>
  );
}
