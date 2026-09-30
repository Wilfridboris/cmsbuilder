# Epic 7 Context: Billing, Trials & Flat Tiers

<!-- Compiled from planning artifacts. Edit freely. Regenerate with compile-epic-context if planning docs change. -->

## Goal

Monetize Scheza entirely on Stripe-hosted surfaces. A new account gets a 14-day free trial with no card required (full unlimited access, to maximize spreadsheet import and switching cost), then converts to a flat, all-inclusive monthly subscription priced by business size (Solo / Crew / Shop) via Stripe Checkout, and self-serves updates, invoices, and cancellation through the Stripe Customer Portal. When the trial expires or a subscription lapses, the account transitions to read-only mode (data stays visible, no new entries) governed by a cached subscription state. Billing is deliberately predictable: no metering, no usage reporting, no spend cap. Invoicing volume (invoices issued per cycle) only drives a tier-change *prompt*, never an automatic charge. This epic delivers the trust promise that the bill never surprises the owner, and depends only on Epics 1-3 (data model, guarded mutate layer, real claimed accounts).

## Stories

- Story 7.1: 14-Day Free Trial (No Card)
- Story 7.2: Start a Flat-Tier Subscription via Stripe Checkout
- Story 7.3: Manage Subscription via Stripe Customer Portal
- Story 7.4: Read-Only Gating & Trial Reminders
- Story 7.5: Tier View, Tier-Change Prompt & Tier Reconciliation

## Requirements & Constraints

- **No custom billing UI.** Use Stripe-hosted Checkout and Customer Portal exclusively. Scheza builds only the redirect buttons, the trial/tier display cards, and the webhook/cron handlers.
- **Trial:** begins at account claim, 14-day expiry, no payment info requested. During trial, records and team members are unlimited. Trial state is the single access authority.
- **Flat subscription only:** one fixed-price Stripe subscription per tier (Solo/Crew/Shop). No metered price, no usage records, no overage, no spend cap. Each tier includes unlimited team members, customers, historical records, and import (no per-seat/per-record charge, no contract).
- **Read-only gating:** on trial expiry or subscription lapse, the account goes read-only (data visible, no new entries).
- **Cached source of truth:** the account's subscription state stored in Supabase is authoritative for access (access state flows trial -> active -> read-only -> grace -> deleted). Stripe status is only cached. Stripe/webhook downtime must never lock out a paying user (NFR-R4).
- **Webhook security:** every Stripe webhook must be signature-verified; invalid signatures are rejected and not processed.
- **Trial reminders:** email prompts at Day 12 and Day 14 via Resend, plus a persistent in-app banner from Day 12 ("Your trial expires in N days. Add billing to keep your business running.").
- **Tier view:** Admin can always see current tier, exactly what it includes, and next billing date, with no usage meter shown.
- **Tier-change prompt:** when invoicing volume sustainably exceeds the current tier's band, show a prompt to move up a plan. Never silently meter or auto-charge overage.
- **Reconciliation (NFR-R5):** a per-cycle job compares the tier held in Stripe against the stored tier; any drift pages (Sentry) before it can affect access. Billing accuracy is a trust requirement.
- **Admin-only:** billing surfaces are Admin-only (Member RBAC from Epic 2 excludes Billing).
- Exact tier prices and the invoice-volume bands are open configuration values pending willingness-to-pay validation, not structural decisions.

## Technical Decisions

- **State storage:** `subscription_status` and `subscription_tier` live on the org record (no separate metering tables). `subscription_status` is the access source of truth; `subscription_tier` is the billed plan. Any legacy `org_usage` / `org_billing_settings` metering tables are removed.
- **Stripe SDK split:** Stripe server v22 + client v9, version-matched. Server client init lives in the Stripe lib.
- **Checkout:** "Add Billing" redirects (server action) to a Stripe Checkout session for the fixed per-tier price (env vars `STRIPE_PRICE_SOLO` / `_CREW` / `_SHOP`, server-only). Redirect button shows a disabled "Redirecting..." state during handoff.
- **Webhook handler** (single route) processes the flat-subscription lifecycle: `checkout.session.completed` (set status active + record purchased tier), `customer.subscription.deleted`, `invoice.payment_failed`, `invoice.paid`. Verify with `stripe.webhooks.constructEvent` against `STRIPE_WEBHOOK_SECRET`.
- **Customer Portal:** "Billing" in Settings redirects an active-subscription Admin to the Stripe Customer Portal for card updates, invoice history, and cancellation.
- **Reconciliation cron:** Vercel Cron (declared in `vercel.json`) hits a `CRON_SECRET`-protected `/api/cron/reconcile-tier` route each cycle; unauthenticated requests (missing/invalid `CRON_SECRET`) are rejected. There is no usage-reporting cron (flat tiers carry no metered usage). The same Vercel Cron mechanism also runs trial/offboarding lifecycle sweeps.
- **Config not structure:** tier definitions + Stripe price-id mapping and the reconcile logic live in the billing lib; tier prices and volume bands are configuration.
- **Env vars introduced/used:** `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_SOLO`/`_CREW`/`_SHOP`, `CRON_SECRET`, `RESEND_API_KEY`.
- **Standard contracts:** API routes follow the platform's authenticate -> Zod-validate -> logic -> `{ data, error }` envelope; never expose raw stacks or Stripe internals to the client.

## UX & Interaction Patterns

- Stripe redirect interactions show a disabled button with "Redirecting..." text during the handoff.
- Trial-to-paid: persistent in-app conversion banner from Day 12 alongside the Day 12 / Day 14 emails.
- Billing view presents tier, inclusions, and next billing date as a plain card with no live meter and no spend cap, reinforcing predictability.
- Tier-change surfaces as a non-blocking prompt to upgrade, not an enforced gate.

## Cross-Story Dependencies

- **Depends on Epics 1-3:** the org record / data model (Epic 1), claimed real accounts and Admin/Member RBAC (Epic 2, billing is Admin-only), and the guarded mutation layer (Epic 3, whose writes the read-only gate must block). No dependency on Epics 4-12.
- **Resend integration** (from infra / used by Epic 2 magic links) is reused for trial reminder emails.
- **Offboarding overlap:** the read-only/grace/delete lifecycle is shared conceptually with Epic 8 (30-day grace -> cascade delete); Epic 7 owns the trial/subscription-lapse read-only transition, Epic 8 owns cancellation offboarding. The same cached `subscription_status` state machine spans both.
- **Tier signal source:** the invoicing-volume count that drives the tier-change prompt is read from the fixed `invoices` table built in Epic 12 (uniform across tenants); if Epic 12 is not yet present, the prompt has no data source.
- Internal-story order: 7.1 (trial state) precedes 7.4 (gating/reminders); 7.2 (Checkout) and 7.3 (Portal) establish the Stripe integration that 7.4 and 7.5 read from.
