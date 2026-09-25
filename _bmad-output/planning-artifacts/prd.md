---
stepsCompleted:
  - step-01-init
  - step-02-discovery
  - step-02b-vision
  - step-02c-executive-summary
  - step-03-success
  - step-04-journeys
  - step-05-domain
  - step-06-innovation
  - step-07-project-type
  - step-08-scoping
  - step-09-functional
  - step-10-nonfunctional
  - step-11-polish
  - step-e-01-discovery
  - step-e-02-review
  - step-e-03-edit
releaseMode: phased
inputDocuments:
  - docs/research.md
  - docs/prd.md
  - docs/design.md
  - docs/stack.md
workflowType: 'prd'
workflow: 'edit'
classification:
  projectType: saas_b2b
  domain: general
  complexity: medium
  projectContext: brownfield
lastEdited: '2026-09-22'
editHistory:
  - date: '2026-09-19'
    changes: 'Strategic revision: repositioned away from no-code database builder toward workflow-redesign + defensibility triad; added Product Principles; switched flat $49/mo to usage-based metering (base+overage hybrid) across all sections; added schema explainability, CSV import (MVP), workflow suggestion layer + learned patterns + Business Snapshot + tenant activity logging (Growth), retail POS + Tier-3 API sync (Phase 2); added import journey; reworked success metrics; added FRs and NFRs.'
  - date: '2026-09-22'
    changes: 'Post-validation refinements + digital-crew/external-tools capture: added User Journey 7 (the digital employee closes the loop) and a summary-table row; expanded Phase 3 with the digital-crew role model (bookkeeper / sales / operations over one shared memory), connected external tools via a standard protocol (MCP; e.g. Gmail, DataForSEO), and CASL/PIPEDA governance in the safety model; quantified the Phase-3 entry gate (week-4 retention >=30% target, records-under-management growth across >=2 consecutive cohorts) and FR65 trust threshold (default 5 consecutive clean approvals); distinguished the Vision "operational insights" bullet from Phase-3 actions; added FR68 (agent roles) and FR69 (connected external tools) and an external-tool risk (Critical). Still Vision/Phase-3 only; MVP and Success Criteria unchanged.'
  - date: '2026-09-22'
    changes: 'Integrated the Hermes/autonomous-agent thesis as a first-class narrative: reframed Executive Summary and Product Principle 1 around the build → suggest → run arc; added Innovation Pattern 6 (Autonomous Per-Tenant Operator); added Project Scoping Phase 3 (Autonomous Operations, gated on proven week-4 retention + records-under-management growth) and reframed the Growth substrate as its nervous system; added a Security forward-note and NFR Forward-Compatibility seams (single guarded action layer, durable append-only event stream consumed via replayable cursor, persistent-worker seam, action allowlist); added action-safety risk (Critical, reputational-contagion impact) and Phase 3 FRs 62-67. MVP scope and Success Criteria deliberately unchanged.'
---

# Product Requirements Document - SnapBusy

**Author:** Boris
**Date:** 2026-05-17

## Executive Summary

SnapBusy is a Generative Business Operating System targeting Ontario small-to-medium enterprises in the skilled trades and local services sectors (HVAC, plumbing, roofing, snow removal, landscaping). Users describe their business in a single natural language prompt; within 30 seconds, SnapBusy generates a relational database schema, provisions a live PostgreSQL backend, injects hyper-contextual synthetic data, and renders a fully interactive dashboard — all before the user creates an account.

The product targets the operational gap between tools that are too generic (Excel, Airtable) and platforms that are too expensive and complex to configure without a developer (Salesforce, HubSpot). The primary user is the accidental administrator: a master tradesperson who built a successful service business but now loses evenings and weekends to administrative chaos — missed invoices, untracked parts, forgotten follow-ups. SnapBusy's value proposition is not a database; it is the peace of mind to turn off your brain at 6 PM.

SnapBusy is deliberately **not** positioned as a no-code database builder. That framing invites commodity comparison to Airtable and a race to zero on price. SnapBusy redesigns how the business runs — it proposes the workflow, not merely the table that stores it. Its defensibility rests on three compounding traits a schema generator alone cannot accumulate: **proprietary per-tenant operational data**, **embedded workflows** the business runs on daily, and **switching costs** that grow with every imported record and learned pattern. A schema generator has none of these; a system that learns one specific business over time has all three.

That compounding thesis has a natural endgame, and it defines SnapBusy's arc across three verbs: **AI builds → AI suggests → AI runs.** In the MVP the AI *builds* the system — schema, data, dashboard — in under a minute. In the Growth phase it *suggests* how the business should run, watching for what falls through the cracks. The endpoint is an AI that *runs* the business inside the system: an always-on, per-tenant operator — a digital employee — that executes routine operational work autonomously and reports back on the owner's channel of choice. This is deferred to a gated **Phase 3** (see *Project Scoping*), not the MVP. But every phase before it exists to accumulate the proprietary data, embedded workflow, and earned trust a digital employee needs to run one specific business. Naming the endgame now keeps the earlier phases pointed at it — and keeps SnapBusy on the right side of the AI-driven collapse of seat-based SaaS, as the system that *does* the work rather than the one that gets automated away.

Target market: Ontario SMEs, 1–15 employees, in skilled trades and local services. Initial go-to-market targets the Greater Toronto Area and Ottawa-Gatineau corridor. Pricing is **usage-based**: a low monthly base fee (~$29) plus metered overage on active records managed — jobs, invoices, and customers tracked per cycle — over a generous included allotment sized to cover a typical trades account. A 14-day free trial is triggered at account claim. (See *Pricing & Metering* for the metering model and the pure-usage-vs-hybrid open question.)

### What Makes This Special

The core technical unlock is **deterministic JSON schema generation at edge-compute speeds**. In 2026, frontier models (GPT-4o-mini, Claude 3.5 Sonnet) reliably output strict, nested JSON under strict system prompts — valid enough to pipe directly into a database provisioning API without a human engineer sanitizing output. This collapses the Time to Value from months to seconds.

The differentiator is not the deferred authentication (though it reduces bounce). The "aha" moment occurs at second ~14: the user sees a dashboard already populated with *their* operational reality — an invoice for "Emergency Pipe Repair at 100 City Centre Dr, Mississauga," a parts inventory listing "3/4 inch copper fittings," a dispatch view showing "Truck 2 – Currently on Hurontario St." This **hyper-contextual synthetic data** eliminates blank-canvas paralysis — the leading cause of B2B SaaS churn at onboarding. Competitors deliver an empty filing cabinet; SnapBusy delivers a fully staffed, organized office.

Ontario-specific differentiation reinforces retention: Canadian data residency (PIPEDA-compliant, AWS ca-central-1), native EN/FR bilingual architecture, and white-label resale for GTA/Ottawa digital agencies.

### Product Principles

Four rules derived from market research. Every feature and scope decision is checkable against them.

1. **Value compounds, it does not front-load.** The 30-second generation is the hook, not the product. SnapBusy must be more useful in month six than in minute one, because the business's own accumulated data and patterns live inside it. The endpoint of that compounding is an autonomous operator that can run the business *because* it has learned it — the arc from *AI builds* to *AI suggests* to *AI runs* (see Executive Summary and Project Scoping Phase 3).
2. **Redesign the workflow, don't automate the step.** SnapBusy proposes how the work should be organized, then runs it — rather than bolting automation onto an existing broken process.
3. **Explainable by default.** Every AI-generated field, table, or suggestion carries a plain-language reason and a one-click override. Adoption stalls on trust, not capability — and this user is wary of losing control.
4. **Charge for value delivered, not seats occupied.** Pricing meters the records a business actually manages, not logins — the model best fit to a 1–3 person trades operation and most resilient to AI-driven disruption of seat-based SaaS.

### Project Classification

| Attribute | Value |
|---|---|
| **Project Type** | B2B SaaS Platform |
| **Domain** | Business Productivity / Vertical SaaS / Low-Code |
| **Complexity** | Medium (AI generative architecture, multi-tenant data isolation, PWA deployment, regulatory compliance) |
| **Project Context** | Brownfield — existing draft PRD, design spec, stack decisions, and market research on file |

---

## Success Criteria

### User Success

**Week 1 — Activation**
A user is activated when they generate a dashboard, claim their app via magic link, and **import their real business data**. The "aha" moment — hyper-contextual synthetic data populated at ~second 14 — earns attention; the import of real customers and jobs earns commitment. Generation without import is a demo, not a customer, which is why **import is the primary activation metric**, not synthetic-data interaction. Target: 35% of claimed users import real data (CSV/Excel) within 7 days; a secondary target of 40% log at least one manual real entry within 7 days.

**Month 1 — Habit & Displacement**
Success at 30 days is defined by tool displacement, not feature usage. A retained user has:
- Sustained ≥ 4 active weeks of usage (> 5 real data entries per week)
- Abandoned their prior "duct-tape" solution (WhatsApp dispatch group silent; Excel file unmodified for ≥ 3 weeks)
- Invited ≥ 1 team member (dispatcher, partner, or field worker) to the dashboard

The team-invite milestone is the key stickiness signal: single-player mode is a trial; multi-player mode is an embedded business tool.

### Business Success

**3-Month Milestone — Stranger Validation**
- ~$1,000 MRR (customer count is ARPA-dependent under usage pricing — approximately 20–30 paying businesses at a blended ~$35–50/month)
- 500 total generated demo apps (measures top-of-funnel engagement and prompt virality)

Rationale: paying strangers — not friends, not beta testers — who pulled out a credit card after experiencing the synthetic-data moment and importing their real data proves the core value proposition is real and transferable without a sales call.

**12-Month Milestone — Default Alive**
- ~$10,000 MRR (~$120K ARR; roughly 200–280 active paying businesses at blended ARPA, exact count varies with records-under-management)

Rationale: $10K MRR covers all infrastructure and API costs, supports a founder salary, and validates that the Ontario SME market is deep enough to scale. Under usage-based metering, MRR and records-under-management move together — revenue grows as customers deepen usage rather than only as headcount grows. At this threshold SnapBusy transitions from "AI project" to a defensible, sellable Micro-SaaS.

### Technical Success

| Metric | Target |
|---|---|
| Time-to-Value (TTV) | < 45 seconds: prompt submission → populated, interactive dashboard |
| Activation Rate | 15% of visitors generate an app AND claim it |
| Week-1 Retention | 40% of claimed users log ≥ 1 real entry within 7 days |
| Mobile DAU Share | > 70% of daily active users via PWA |
| Schema Generation Reliability | > 99% of prompts produce a valid, parseable JSON schema (no fallback to generic template) |
| Data Residency | 100% of user data stored on Canadian-region infrastructure (AWS ca-central-1 or equivalent) |

### Measurable Outcomes

- A Mississauga HVAC contractor can go from landing page to a live, claimed, Ontario-localized dashboard in under 45 seconds with zero configuration
- A user invited to a shared dashboard can add a real record from a mobile device within 60 seconds of receiving the invite link
- Switching the UI language from English to French translates all navigation, column names, and synthetic data without a page reload

### Compounding-Value Metrics

These metrics track the thesis that value compounds rather than front-loads (Product Principle 1). They become measurable as the corresponding capabilities ship across MVP and Growth.

| Metric | Definition | Target | Available from |
|---|---|---|---|
| Import activation | Share of claimed accounts that import real data (CSV/Excel) | ≥ 35% within 7 days of claim | MVP |
| Week-4 retention | Share of accounts still active 4 weeks after import, past the novelty window | ≥ 30% | MVP |
| Suggestion acceptance rate | Share of proposed workflows accepted or edited (rather than dismissed) | ≥ 25% accepted-or-edited | Growth (validates the Suggestion Layer is insight, not noise) |
| Records under management per tenant | Median active records managed per tenant, tracked over time | Grows month-over-month per cohort | MVP (also the direct revenue proxy under usage pricing) |

*Rationale:* Records-under-management is the single number that proxies both compounding value and revenue. Suggestion acceptance rate is the go/no-go signal for whether the Workflow Suggestion Layer (Growth) is worth its build cost.

---

## User Journeys

### Journey 1: Tim — The First Visit (Success Path)

**Persona:** Tim Kowalski, 47. Runs TK Mechanical — 5 HVAC trucks serving Mississauga and Brampton. His business lives in a WhatsApp group, a dog-eared notebook in his truck, and a shared Excel file nobody updates correctly.

**Opening Scene**
9:30 PM on a Wednesday. Tim is trying to figure out if he invoiced the Dhaliwal family for a furnace repair two weeks ago — scrolling through WhatsApp messages to find the date. He Googles "simple job tracking for HVAC small business," clicks a SnapBusy ad. The landing page is one thing: a text box and the words *"What kind of business are you running?"*

He types: *"I run an HVAC company in Mississauga. I have 5 trucks, I need to track my jobs, parts inventory, and send invoices."* He hits Enter. No sign-up. No credit card.

**Rising Action**
Skeleton screens pulse for 8 seconds. His dashboard loads pre-populated: 5 trucks listed, a Jobs table with 8 dummy entries — one reads *"Furnace Tune-Up – 2241 Confederation Pkwy, Mississauga – $220 – Invoice Pending."* Parts inventory lists copper fittings, capacitors, and refrigerant cans with stock counts. He notices a small info icon next to a column he didn't ask for — **Warranty Expiry**. He taps it: *"Added Warranty Expiry — HVAC installs in Ontario usually carry a manufacturer warranty you'll want to track."* Next to the reason is a one-tap **Remove**. He keeps it; it's exactly right. He clicks a dummy job. An edit form opens with fields: Client Name, Address, Service Type, Parts Used, Invoice Status, Technician. He types into the chat bubble: *"Add a field for the second technician on a job."* The table refreshes. A new column appears.

**Climax**
At second ~14, Tim sees *"Emergency Pipe Repair – 1400 Hurontario St, Mississauga"* in the jobs list. Something clicks. This isn't a demo — this is his business, already organized. He clicks **"Make it Real."** Magic link arrives in 40 seconds. Dummy data clears. His dashboard is live at `scheza.com/tkmechanical`. He adds the Dhaliwal furnace job — the one he spent 20 minutes searching for in WhatsApp — in 45 seconds.

**Resolution**
Tim bookmarks the PWA to his iPhone home screen. Thursday morning he texts his dispatcher: *"Use this instead of WhatsApp for job tracking."* He does not open Excel that day. Or the next week.

**Requirements Revealed:** Prompt intake, LLM schema generation, Supabase provisioning, synthetic data injection with Ontario localization, deferred auth, magic link claim, PWA/home screen prompt, conversational schema editor, inline editing, mobile-responsive data tables.

### Journey 2: Marco — The Field Worker on Mobile

**Persona:** Marco, 29. One of Tim's HVAC technicians, Truck 3. Comfortable with his iPhone; uncomfortable with anything that feels like "software." Used to Tim texting job addresses in WhatsApp.

**Opening Scene**
Monday morning. Tim sends Marco a link: *"Use this for jobs now — scheza.com/tkmechanical."* Marco opens it on his phone in his truck outside a Tim Hortons on Mavis Rd.

**Rising Action**
The dashboard loads as swipeable cards — not a desktop table crammed onto a 6-inch screen. Each card shows a job: address, status, assigned technician. He finds his name on two jobs. He taps the first card; the address opens. He taps it — Apple Maps launches with the address pre-loaded. He finishes the job, taps "Add Entry." The form fields are large and finger-friendly. He selects "Service Complete" from a dropdown, types a note about the replaced part, taps Save. It syncs instantly.

**Climax**
Tim, back at the office, sees Marco's completed job update appear in the Jobs table in real time. He marks the invoice as sent without calling Marco. No WhatsApp thread. No back-and-forth.

**Resolution**
Marco never visits a settings page. He never sees a database. He uses SnapBusy the way he uses Google Maps — it just works on his phone.

**Requirements Revealed:** Shared dashboard access (invite by email), mobile-first card view, touch-optimized hit areas (48×48px min), real-time data sync, simplified field-worker entry flow, no-configuration shared access.

### Journey 3: Sarah — The Bilingual Operations Manager

**Persona:** Sarah Tremblay, 31. Operations Manager at Vert Paysage — a landscaping and snow removal company in Ottawa with 15 seasonal workers. Half her clients expect everything in French; half her workers only read French. She manages dispatch, client contracts, and worker schedules across both languages, currently via Google Sheets and printed paper contracts.

**Opening Scene**
Sarah hears about SnapBusy at an Ottawa trade association meeting. She opens it on her laptop and types in French: *"Je gère une entreprise de déneigement à Ottawa. J'ai 15 employés, des clients résidentiels et commerciaux, et je dois gérer les contrats en français et en anglais."*

**Rising Action**
The dashboard generates in French. Column names: *Clients, Employés, Contrats, Statut.* Synthetic data uses localized names — *Gagnon, Leblanc* — and Gatineau addresses. She toggles the language switch top-right. Everything — menus, column headers, dummy data — flips to English instantly, no reload. She clicks into a dummy contract entry: fields for Client Name, Civic Address, Contract Type, Language Preference (EN/FR), Service Schedule, and Gate Access Code — the last marked with a padlock icon.

**Climax**
The Gate Access Code padlock tooltip reads: *"Stored encrypted. Canadian servers only (PIPEDA)."* Sarah exhales. She handles security codes for 40+ residential properties and has always been nervous storing them in Google Sheets. This one detail closes the deal. She claims the app and invites her dispatcher and three team leads.

**Resolution**
Sarah runs weekly dispatch in SnapBusy in French. Her English-speaking client in Kanata fills out the intake form in English. Both entries land in the same database. No translation friction. No compliance anxiety.

**Requirements Revealed:** French-language prompt support, EN/FR UI toggle (labels + synthetic data), bilingual intake form, field-level sensitivity indicators, PIPEDA-compliant data residency messaging, multi-user invite flow, mixed-language entry support.

### Journey 4: Priya — The Customer Filling the Intake Form

**Persona:** Priya Sharma, 38. Homeowner in Brampton. Furnace stopped working on a Tuesday evening. Found Tim's Google Business profile; his bio links to `scheza.com/forms/tkmechanical`.

**Opening Scene**
Priya taps the link on her phone. A clean, single-page form opens — no sign-up, no navigation, no app to download. Header reads: "TK Mechanical — Book a Service Call."

**Rising Action**
Five fields: Name, Phone Number, Address, Type of Issue (dropdown: No Heat / No Cooling / Strange Noise / Other), Notes. Large touch targets. She fills it in under 60 seconds. Taps Submit. Confirmation: *"Thanks Priya — Tim will be in touch within 2 hours."*

**Climax**
On Tim's dashboard, a new entry pops into the Jobs table: *"Priya Sharma – 87 Balmoral Dr, Brampton – No Heat – Received 7:43 PM."* Tim receives an email notification. He replies to Priya directly.

**Resolution**
Priya got a response in 18 minutes. Tim captured a lead with no website, no booking platform, no third-party form tool — the intake URL was auto-generated when he built his dashboard, at no additional cost.

**Requirements Revealed:** Auto-generated public intake URL (`scheza.com/forms/[slug]`), schema-derived form fields, mobile-optimized single-page form, no-auth submission flow, real-time push to owner's dashboard, email notification on new intake submission (web push deferred to Growth phase).

### Journey 5: Tim — The Edge Case (Broken Schema Recovery)

**Persona:** Same Tim. Three weeks in. He wants to add a new workspace for his side business — appliance repair out of his garage.

**Opening Scene**
Tim types: *"I fix appliances — washers, dryers, fridges. I need to track repair jobs, parts I order, and whether I've called the customer back."* The AI generates a schema, but the vague prompt produces a table called *"Things"* with one column: *"Stuff."* The dashboard loads looking wrong.

**Rising Action**
Tim is confused. He opens the chat bubble: *"This doesn't look right. I need columns for the appliance type, the customer name, and the repair status."* The AI proposes a revised schema: Repair Jobs (Appliance Type, Brand, Customer Name, Phone, Issue Description, Parts Ordered, Status, Callback Done).

**Climax**
Tim types: *"Yes, use that."* The dashboard refreshes. The new schema replaces the broken one. His one real entry is migrated to the new structure automatically — nothing lost.

**Resolution**
Tim never saw a raw schema, an error code, or a JSON object. He had a conversation and the app fixed itself. His confidence in the tool is higher after the recovery than before the error.

**Requirements Revealed:** Schema validation before provisioning, fallback detection (malformed/vague output), conversational schema repair flow, non-destructive migration (preserve existing rows on schema update), user-friendly error messaging (no raw JSON or SQL exposed to user).

### Journey 6: Tim — Importing Three Years of Real Data (The Commitment Handoff)

**Persona:** Same Tim, immediately after claiming his app in Journey 1. Generation earned his attention; this journey is where he either commits or bounces.

**Opening Scene**
Tim's dashboard is live and full of synthetic data. A prompt appears: *"Ready to make this yours? Import your real customers and jobs."* His actual data lives in a three-year-old Excel file — 400 rows of jobs and a separate sheet of clients. The nightmare scenario in his head: *"now re-type three years of jobs."* If that were the ask, he would close the tab.

**Rising Action**
He drags the Excel file onto the screen. SnapBusy reads the columns and **shows its work**: a mapping table appears — *"Your column 'Customer' → Clients.Name," "Your column 'Addr' → Jobs.Address," "Your column 'Amt' → Invoices.Total."* Two columns it isn't sure about are flagged, not silently guessed: *"'Ref#' — map to Job Number, or skip?"* Each proposed match is editable before anything is committed. Nothing has been written to his database yet.

**Climax**
Tim fixes one mapping, confirms the rest, and taps **Import**. A progress meter runs; the synthetic rows are cleared and replaced with his real 400 jobs and his real clients. He scrolls and sees *"Dhaliwal – Furnace Repair – Feb 2024"* — the exact job he spent 20 minutes hunting for in WhatsApp in Journey 1. It's in the system now, searchable, forever.

**Resolution**
Tim has effectively switched. Three years of his operational history now live in SnapBusy — a switching cost that no synthetic-data demo could create. He never re-typed a single row.

**Requirements Revealed:** CSV/Excel upload; AI-assisted column mapping reusing the schema-generation capability; visible, editable mapping UI before commit (explainability principle); ambiguous columns flagged rather than silently guessed; non-destructive replacement of synthetic data with imported data; import as the primary activation event.

### Journey 7: Tim — The Digital Employee Closes the Loop (Vision — Phase 3)

**Persona:** Same Tim, a year in. SnapBusy holds his real customers, jobs, and invoices, and has watched how he works for months. He has quietly turned on the operator and approved a handful of routine actions.

**Opening Scene**
Friday, 6 PM. In the old days this is when Tim's second shift started — figuring out who never got invoiced, which quotes went cold, whether he's low on parts. Tonight his phone buzzes with a WhatsApp message from SnapBusy.

**Rising Action**
The message is a plain-language summary: *"6 jobs finished this week without an invoice — I drafted all 6, want me to send them? · The Kaur quote from 9 days ago hasn't been answered — draft follow-up ready · Copper fittings below reorder point."* Each item has a one-tap **Send / Edit / Skip.** Because Tim has approved "draft an invoice for a finished job" enough times, that role now runs on its own and is showing him the result, not asking permission. The customer follow-up — a customer-facing action — still waits for his tap.

**Climax**
Tim taps **Send** on the invoices, edits one word of the follow-up and sends it, and skips the reorder (he already bought fittings). Thirty seconds, from his truck. The old two-hour Friday shift is gone. He notices the summary reads as if written by staff: a *bookkeeping* line, a *sales* line, an *operations* line — a small crew that never sleeps and already knows every one of his customers.

**Resolution**
Tim never opens a settings screen. He didn't hire anyone. The business ran its own back office this week and checked in once, on the channel he already uses. He would sooner switch banks than switch this off.

**Requirements Revealed:** Per-tenant operator proposing actions from learned patterns; propose→approve→remembered graduation with customer-facing actions still gated; digital-crew role framing (bookkeeping / sales / operations) over one shared memory; owner reporting via an external channel (WhatsApp / SMS / email); connected external tools for actions beyond owned data; CASL/PIPEDA governance of automated customer contact; full activity-log audit of every agent action.

### Journey Requirements Summary

| Capability Area | Revealed By |
|---|---|
| LLM schema generation + validation | Journey 1, 5 |
| Ontario-localized synthetic data injection | Journey 1, 3 |
| Deferred auth + magic link claim | Journey 1 |
| PWA / home screen prompt | Journey 1 |
| Mobile card view + touch-optimized UI | Journey 2 |
| Real-time multi-user data sync | Journey 2 |
| Multi-user invite (shared dashboard) | Journey 2, 3 |
| EN/FR UI + data toggle (no reload) | Journey 3 |
| Field-level sensitivity indicators + PIPEDA messaging | Journey 3 |
| Auto-generated public intake form URL | Journey 4 |
| No-auth intake submission → real-time dashboard push | Journey 4 |
| Email notification on new intake (web push deferred to Growth phase) | Journey 4 |
| Conversational schema repair + non-destructive migration | Journey 5 |
| Schema explainability (per-field reason + one-click override) | Journey 1, 6 |
| Data import (CSV/Excel) + visible AI column mapping | Journey 6 |
| Autonomous operations: propose→approve→remembered actions, digital-crew roles, connected external tools (Vision/Phase 3) | Journey 7 |

---

## Domain-Specific Requirements

### Compliance & Regulatory (PIPEDA — Privacy by Design)

SnapBusy adopts a **Privacy by Design** posture. Canadian data residency is the foundation, not the complete strategy.

**Data Residency**
All user data must be stored exclusively on Canadian-region infrastructure (AWS ca-central-1 or Supabase equivalent). This is enforced at the infrastructure configuration level and must be verified before any production deployment.

**Informed Consent at Claim**
At the magic link claim step (demo → live account conversion), the UI must display a mandatory, unchecked checkbox:
*"I agree to the SnapBusy Privacy Policy and Terms of Service."*
This checkbox is a **hard blocker** — account creation cannot complete without explicit consent. The timestamp of consent must be stored against the user record.

**Data Portability**
A "Download My Data" button must be available in account settings, exporting all user records as CSV and JSON. This fulfills PIPEDA's data portability requirement and must be implemented before the product exits beta.

**Self-Service Offboarding**
Upon account cancellation:
1. The account enters a **30-day read-only grace period** — data is visible but no new entries can be added
2. At day 30, a hard cascade delete removes all records in the user's isolated schema
3. The user receives an email warning at day 1, day 7, and day 25 of the grace period
4. The "Download My Data" export is prominently surfaced during the grace period

### Technical Constraints — Multi-Tenant Data Isolation

**Architecture Decision: RLS + Shared Instance**
SnapBusy uses a single shared PostgreSQL instance (Supabase) with **Row-Level Security (RLS)** as the tenant isolation mechanism. Separate schemas per tenant and separate database instances are explicitly rejected — the former creates unmanageable migration complexity; the latter is cost-prohibitive at the MVP stage.

**Implementation Requirements**
- Every generated table must include an `organization_id` column, automatically populated at provisioning time with the authenticated user's UID
- RLS policies must enforce: `auth.uid() = organization_id` on all SELECT, INSERT, UPDATE, and DELETE operations
- RLS policies must be applied programmatically at table creation time — manual policy application is not acceptable
- The Supabase service role key (which bypasses RLS) must never be exposed to client-side code under any circumstances

**Verification**
Before any tenant table is made accessible to the frontend, an automated test must verify that a request authenticated as User A cannot return rows belonging to User B. This test is a **required gate for the schema provisioning pipeline**.

### Security Requirements — AI/LLM Attack Surface

> *"We are not throwing AI at a database. We have built a protective fence around it."*

The Conversational Editor is the highest-risk surface in the product. The following controls are **non-negotiable and must be implemented before any public-facing deployment**.

**The No Direct SQL Rule**
The LLM must never generate SQL. The LLM's only permitted output is a structured JSON schema definition describing table names, column names, and data types. Example valid output:
```json
{ "table": "jobs", "add_column": { "name": "warranty_expiry", "type": "date" } }
```
Any LLM response that contains raw SQL must be treated as a security violation and discarded.

**The Schema Validator (HIGH-PRIORITY BLOCKING TASK)**
A hardcoded Schema Validator function must be implemented as a Next.js API route and must run on every LLM output before it reaches Supabase. Requirements:
- Parse and validate the JSON structure against an allowlist of permitted operations (add column, rename column, add table, remove column)
- Reject any field name or table name containing restricted keywords: `DROP`, `GRANT`, `TRUNCATE`, `DELETE`, `EXEC`, `--`, `;`, `/*`
- Reject operations outside the allowlist (e.g., attempts to modify `organization_id`, `auth` tables, or RLS policies)
- Return a sanitized, user-friendly error message on rejection: *"That change isn't allowed. Try describing what you'd like to add instead."*
- Log all rejected attempts to Sentry with the raw LLM output and the user's `organization_id` for audit review

The Schema Validator is classified as a **blocking dependency** for the Conversational Editor feature. The editor must not ship without it.

**Identity Masking (System Prompt Hardening)**
Every API call to the LLM must include a hardened system prompt that explicitly constrains the model's role:
> *"You are a database structure assistant. You may only describe the structure of database tables (column names and types). You are not permitted to view, modify, or delete user data. You are not permitted to generate SQL. You must output only valid JSON conforming to the schema definition format."*

**Defense in Depth**
The four controls above form a layered security model:
1. **System prompt** constrains LLM intent
2. **Schema Validator** blocks malicious output before it reaches the database
3. **RLS** ensures that even a bypassed validator cannot cross tenant boundaries
4. **Sentry logging** provides visibility into any attempted exploits

No single layer is treated as sufficient. All four must be active in production.

**Forward note — the fence generalizes from schema-actions to real-world actions.** The four controls above guard *schema* actions: the only thing the MVP's AI can do is propose structure. A future autonomous operator (Phase 3) will propose *real-world* actions — sending an email, changing an invoice's status, ordering parts. The same fence generalizes: an **action allowlist** plays the role the Schema Validator plays today, every agent action runs under a per-actor, org-scoped identity subject to RLS (never the raw service-role key), and every action is written to the tenant activity log for audit before and after execution. No autonomous action is designed to reach a customer, a dollar, or the database except through this fence. This is a design constraint recorded now so the MVP does not foreclose it (see *Non-Functional Requirements — Forward-Compatibility*).

### Tenant Activity Logging (Growth Prerequisite)

A per-tenant, append-only activity log records material data events: record created, edited, deleted; schema changed; member invited; invoice status changed. Each entry stores the acting user, the affected table/record, a before/after diff where applicable, and an ISO-8601 timestamp, all scoped by `organization_id` under the same RLS isolation as tenant data.

**This capability does not exist in the MVP and is not a security audit trail — it is the data substrate two Growth features depend on:**

- **Business Snapshot export** (owner-facing summary) is a report over this log. Snapshot cannot be built as "a report over data that already exists" until this logging ships first — it is an explicit **prerequisite**, not a free byproduct.
- **Learned Patterns per tenant** consumes this log to detect repeated manual actions.

Activity logging is scoped to the **Growth** phase and must ship before either dependent feature. Effort for Business Snapshot is "Low *given this logging is in place*" — the logging itself is the real cost.

### Risk Register

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| LLM generates malicious schema JSON | Medium | High | Schema Validator (blocking task) |
| Tenant data cross-contamination | Low | Critical | RLS on all tables, automated isolation test |
| User cancels and demands data deletion | Medium | Medium | Self-Service Offboarding + cascade delete |
| LLM outputs SQL instead of JSON | Medium | High | No Direct SQL Rule + Validator keyword filter |
| Service role key exposed to client | Low | Critical | Key management policy, server-side only |
| PIPEDA audit or complaint | Low | High | Privacy by Design posture, consent log, data portability |
| Usage pricing perceived as unpredictable, suppressing conversion | Medium | High | Generous included allotment covering a typical account; live usage meter; optional hard monthly cap; A/B test hybrid vs pure usage |
| Import column-mapping errors corrupt real data | Medium | High | Visible, editable mapping before commit; ambiguous columns flagged not silently guessed; non-destructive (synthetic data cleared only on confirmed import) |
| Autonomous agent takes a wrong real-world action (Phase 3) — wrong-customer email, duplicate parts order, mis-billing | Medium | **Critical** | Reputational contagion is the real impact: trades run on tight-knit word-of-mouth (Journey 1 — Tim texts his crew the moment he trusts the tool; the same channel runs in reverse on a bad action). Mitigation: propose → approve → remembered graduation per action-type; money-spending and customer-facing actions stay approval-gated longest and are never autonomous by default; action allowlist + per-actor org-scoped identity + full activity-log audit; no background process writes tenant data via the raw service-role key (see NFR Forward-Compatibility) |
| Agent connected to an external tool causes external-world harm or cost (Phase 3) — wrong-recipient email, runaway paid-API spend, tenant data egress | Medium | **Critical** | Each connected tool is a distinct allowlisted, approval-gated action class with its own trust threshold; paid/customer-facing tools require explicit Admin opt-in and (for paid) a spend cap; all tool calls audited to the activity log; tenant data shared with any external tool governed by PIPEDA consent and CASL for customer messaging (see Phase 3 safety model) |

---

## Innovation & Novel Patterns

### Detected Innovation Areas

**1. AI as Architect (Generative Data Structure)**
SnapBusy represents a new category of AI application: **Generative Architecture**. Unlike AI tools that assist users within pre-existing structures (autocomplete, summarization, content generation), SnapBusy uses AI to generate the structure itself — database schema, relational model, UI layout, and contextual data — from a single natural language prompt. The technical enabler is deterministic JSON schema generation: frontier models in 2026 can be strictly constrained to output valid, nested JSON reliably enough to pipe directly into a database provisioning API. This eliminates the human engineering layer that previously made "prompt-to-app" a novelty rather than a product.

**2. Blank Canvas Inversion (Pre-Populated Deferred Auth)**
Standard B2B SaaS onboarding creates an empty product and asks users to fill it. SnapBusy inverts this: the user's first interaction is with a fully populated, Ontario-localized dashboard specific to their trade. Combined with deferred authentication (no account required to experience the product), this creates a novel conversion pattern: users experience the full value proposition *before* they are asked to commit. The "aha moment at second 14" — seeing hyper-contextual synthetic data that mirrors their operational reality — is the product's primary conversion mechanism, not a feature tour or marketing copy.

**3. Conversational Live Schema Mutation**
SnapBusy allows users to modify a live, production database schema through natural language via a floating chat interface. Adding a column, renaming a table, or restructuring a relationship is a typed sentence, not a configuration screen. The underlying implementation — LLM → JSON schema diff → Supabase migration → UI re-render — makes this safe and non-destructive. This pattern exists in enterprise platforms (Salesforce Flow, Retool) but requires administrator training and technical knowledge. SnapBusy makes it accessible to a 47-year-old HVAC contractor on his iPhone.

**4. Workflow Suggestion Layer (Proactive, Not Reactive)** — *Growth*
Most software records what the user does; SnapBusy notices what is *falling through*. A per-tenant engine watches usage patterns and surfaces suggestions in plain language — for example: *"Six jobs were marked complete this month with no invoice attached — add a reminder when a job closes unbilled?"* Each suggestion is accepted, dismissed, or edited by the owner, and dismissals are remembered and never re-asked. This is the single largest differentiator against horizontal tools (Airtable) and rigid vertical tools (Jobber): it turns the product from a place to record work into a system that redesigns the workflow (Product Principle 2). It depends on a trigger/action **execution engine** that does not exist in the MVP; that engine is scoped ahead of the suggestion layer (see Project Scoping).

**5. Learned Patterns per Tenant (The Moat)** — *Growth*
SnapBusy maintains a per-business record of what the owner actually does: fields added manually and repeatedly, workflows edited, suggestions dismissed, terminology used. This record feeds future suggestions and schema refinements *for that business specifically*. It is the embodiment of Product Principle 1 (value compounds): the system is measurably more useful in month six than in minute one. Critically, it is the defensibility that a schema generator cannot copy — a competitor can replicate the 30-second generation trick overnight, but cannot replicate a year of one specific business's accumulated patterns, and that record cannot be exported to a rival.

**6. Autonomous Per-Tenant Operator (The Digital Employee)** — *Vision / Phase 3*
Patterns 4 and 5 let SnapBusy *notice* and *suggest*; this one lets it *act*. A per-tenant operator runs routine operational work autonomously — chasing unbilled jobs, following up on stale quotes, flagging parts below reorder threshold, drafting customer follow-ups — then reports back on the owner's channel of choice (SMS, messaging app, email, or dashboard). It is the literal fulfillment of the product's core promise: *the peace of mind to turn your brain off at 6 PM.* It is not a new data asset but a new *use* of the ones Patterns 4 and 5 accumulate — it consumes the activity log, the execution engine, and the learned patterns, and therefore inherits their moat: a competitor can copy the 30-second generation overnight but cannot copy an operator that has run *this* business for six months. The distinction from the Growth Suggestion Layer is exact and load-bearing: the Suggestion Layer proposes and the human acts; the operator executes the approved action end-to-end and remembers the approval so it stops asking. That graduation — from suggestion inbox to digital employee, earned per action-type — is the pattern. It depends on infrastructure that does not exist before Growth and on trust that must be measured, not assumed. As it matures, the single operator can be presented as a **digital crew** of named roles (bookkeeper, sales, operations) sharing one per-tenant memory, and can act beyond the business's own data through connected external tools (email, search/SEO, messaging) via a standard tool-connection protocol such as MCP — each tool a leashed, audited action class (see *Project Scoping — Phase 3* for the entry gate, roles, tools, and safety model).

### Market Context & Competitive Landscape

Existing research (see `docs/research.md`) maps the competitive landscape into three categories:

| Category | Players | Gap |
|---|---|---|
| All-in-One Giants | Wix, Squarespace, Shopify | Rigid templates; "website builder" mindset, not business data mindset |
| No-Code Powerhouses | Webflow, Bubble, Softr | Too technical; require hours of configuration; blank canvas problem |
| Internal Tool Builders | Retool, Glide, ToolJet | Powerful but require developer setup; not accessible to non-technical SMEs |

None of these players combine: (a) AI-generated schema, (b) pre-populated synthetic data, (c) deferred auth, and (d) Ontario-specific localization in a single sub-45-second experience. The closest analog is Softr (Airtable → web app) but it requires the user to already have their data structured in Airtable. SnapBusy generates the structure from scratch.

The innovation window is specific to 2025–2027: the cost and reliability of deterministic JSON generation has only recently become viable for consumer-grade products. First-mover advantage in the Ontario SME vertical is available now.

### Validation Approach

| Innovation | Validation Signal | Timeline |
|---|---|---|
| AI as Architect | > 99% of prompts produce a valid, usable schema without manual correction | Pre-launch: internal testing with 50+ prompt variations across trade verticals |
| Blank Canvas Inversion | 15% of visitors who generate an app complete the "Make it Real" claim | 3-month post-launch activation rate tracking |
| Conversational Schema Mutation | Users successfully modify schema via chat without triggering the Schema Validator rejection fallback in > 90% of attempts | Week-1 user session recordings + Sentry rejection logs |

### Risk Mitigation

| Innovation Risk | Mitigation |
|---|---|
| AI generates plausible but wrong schema (hallucination) | Strict JSON mode + Schema Validator allowlist; fallback to generic trade templates if confidence score is low |
| Synthetic data is generic, not contextual enough to create the "aha" moment | Curated Ontario-specific data sets per trade vertical; prompt engineering tested against real trade terminology before launch |
| Conversational editor erodes user trust if it fails visibly | Non-destructive migrations (rows preserved on schema update); explicit undo confirmation before any destructive change; clear user-facing error messages |
| Competitors replicate the pattern quickly | Ontario-specific localization (PIPEDA, EN/FR, Canadian address data) is a moat that takes time to replicate; vertical-specific synthetic data libraries are a compounding asset |

---

## B2B SaaS Specific Requirements

### Project-Type Overview

SnapBusy is a multi-tenant B2B SaaS platform serving Ontario SMEs in skilled trades. Each business account operates in a fully isolated data environment. The product is designed for non-technical primary users (the business owner/admin) and semi-technical secondary users (field workers, dispatchers), requiring a permission model that protects the generative engine from accidental misuse without adding configuration overhead.

### Tenant Model

Covered in full under **Domain-Specific Requirements — Multi-Tenant Data Isolation**. Summary:
- Single shared PostgreSQL instance (Supabase)
- `organization_id` column on every generated table
- RLS policies enforce `auth.uid() = organization_id` on all operations
- Automated cross-tenant isolation test required before any table is exposed to the frontend

### Permission Model (RBAC — Two Hardcoded Roles)

SnapBusy ships with two hardcoded roles for MVP. A custom RBAC configuration UI is explicitly out of scope.

| Capability | Admin | Member |
|---|---|---|
| View and browse all records | ✅ | ✅ |
| Add new records | ✅ | ✅ |
| Edit existing records | ✅ | ✅ |
| Delete records | ✅ | ✅ |
| Access Conversational Editor (AI chat) | ✅ | ❌ Hidden |
| Modify database schema | ✅ | ❌ Hidden |
| Invite team members | ✅ | ❌ Hidden |
| Access Settings & Billing | ✅ | ❌ Hidden |

**Implementation:**
- Role is stored as a metadata tag `{"role": "admin" | "member"}` on the Supabase Auth user record at invite time
- Account creator is automatically assigned `admin`
- Invited users are assigned `member` by default; the inviting admin can change this before sending
- The frontend renders the Conversational Editor, Settings tab, and Invite UI conditionally based on the role tag
- Underlying API routes for schema mutations must independently verify the calling user is `admin` — frontend-only role hiding is not sufficient

**Rationale:** A field worker (Member) accidentally instructing the AI to drop a table is an existential churn risk. The two-role model is the minimum safe configuration for a multi-user product.

### Pricing & Metering (Usage-Based)

**MVP Model: Base + Metered Overage (Hybrid)**

SnapBusy prices on value delivered, not seats occupied (Product Principle 4). Seat-based SaaS is the model most exposed to AI-driven disruption and fits a 1–3 person trades business badly regardless — a solo operator in a busy year and a crew of three in a slow one should not pay the same seat bill. The billable unit is the **active record managed** (jobs, invoices, and customers tracked per cycle), not the user login.

| Attribute | Value |
|---|---|
| Base fee | ~$29/month, including a generous allotment of active records sized to cover a typical trades account so most users never reach overage |
| Overage | Metered per active record above the included allotment, billed per cycle |
| Live usage meter | Admin sees current usage against the allotment at all times — no surprise bills |
| Optional hard cap | Admin can set a monthly spend cap; on reaching it, new-record creation pauses rather than silently accruing charges |
| Trial | 14 days, no credit card required; unlimited records and team members during trial |
| Trial-to-paid conversion prompt | Persistent banner from Day 12: *"Your trial expires in 2 days. Add billing to keep your business running."* |
| Post-trial behaviour | Account enters read-only mode; data preserved for 30 days then subject to offboarding cascade |

**Conversion guardrails (why usage pricing won't scare this user):** trades owners fear unpredictable bills — the exact chaos SnapBusy sells relief from. Three controls make the model safe: the included allotment is deliberately generous (a typical account stays inside it and pays only the base), usage is always visible via the live meter, and the optional hard cap makes the worst case bounded and self-chosen.

**Why no usage caps during trial:** encouraging users to migrate their full operations — and import their history — during the trial maximizes switching cost and conversion probability. A user who has imported 500 real records is far more likely to pay than one who created 3 test entries.

**Open question (for validation):** whether trades owners prefer the base-plus-overage hybrid above or **pure usage-based metering** (no base fee). The hybrid is the default because it preserves a predictable ARPA and meaningful MRR milestones; pure usage is the A/B variant to test for conversion. Repricing later, with customers on legacy plans, is far harder than starting on a metered model now — hence usage pricing from Day 1 rather than deferred. See *Open Questions* in Project Scoping.

### Stripe Integration (Day 1 Requirement)

Stripe is a Day 1 dependency. Manual billing is inconsistent with the product's zero-friction mission and creates the exact administrative chaos the product is designed to eliminate.

**Implementation (Stripe Checkout + Customer Portal + Metered Billing):**
- No custom billing UI is built — SnapBusy uses Stripe-hosted surfaces exclusively for MVP
- **Metered subscription:** the plan is a Stripe subscription with a flat base price plus a **metered usage component**; SnapBusy reports each cycle's active-record count to Stripe as usage records against the metered price
- **Upgrade flow:** "Add Billing" button redirects to Stripe Checkout; on success, Stripe fires `checkout.session.completed` webhook
- **Billing management:** "Billing" in Settings redirects to Stripe Customer Portal (card updates, invoice history with usage breakdown, cancellation)
- **Usage reporting:** a scheduled job computes active-record counts per organization per cycle and posts them to Stripe; this count is also surfaced in-app as the live usage meter
- **Webhook handler:** Next.js API route listens for `checkout.session.completed`, `customer.subscription.deleted`, `invoice.payment_failed`, `invoice.paid` and updates `subscription_status` on the user's Supabase record
- **Access gating:** `subscription_status` is the single source of truth for trial, active, and expired states; Stripe status is cached, not authoritative

**Estimated implementation effort:** ~1 day for a mid-level engineer (metered usage reporting adds to the ~4h base Checkout/Portal integration).

### Integration List

| Integration | Scope | Purpose |
|---|---|---|
| Resend | MVP | Transactional email: magic links, trial expiry warnings, offboarding notifications |
| Stripe | MVP | Usage-based billing (base + metered active records), checkout, customer portal |
| Sentry | MVP | Error monitoring, Schema Validator rejection logging, LLM failure tracking |
| OpenAI API (GPT-4o-mini) / Groq (Llama 3) | MVP | Schema generation, synthetic data injection, conversational editor, import column mapping |
| Supabase | MVP | PostgreSQL database, Auth, Row-Level Security, real-time subscriptions |
| Vercel | MVP | Frontend hosting, serverless API routes, edge deployment |
| CSV / Excel import (in-house, AI column mapping) | MVP | Import real business data from spreadsheets — the primary onboarding path (Tier 1) |
| Trades-software export mappings (Jobber, Housecall Pro, ServiceTitan, QuickBooks) | Growth | Recognize competitor export file formats and pre-fill column mapping — no API required (Tier 2) |
| Zapier / Make.com | Growth | User-controlled workflow automation to third-party apps |
| QuickBooks / Stripe Billing Export | Growth | Financial data sync for business owners |
| Cloudflare for SaaS | Growth | Custom domain routing + SSL for white-label and custom domain features |
| Live two-way API sync (Jobber, Housecall Pro, ServiceTitan, QuickBooks) | Phase 2 | Real-time bidirectional sync — build only when paying customers ask (Tier 3) |

---

## Project Scoping & Phased Development

### MVP Strategy & Philosophy

**MVP Approach:** Experience MVP — the product must deliver the complete "aha moment" (sub-45-second prompt → populated dashboard) before any Growth features are considered. Revenue and retention are validated through the core generative experience, not feature breadth.

**Delivery Model:** Solo Technical Founder + AI-assisted development (Cursor/Copilot) with one part-time UI contractor. Engineering velocity is the primary constraint. Every build decision defaults to off-the-shelf tooling over custom implementation.

**Off-the-Shelf Mandate:**
- UI components: shadcn/ui defaults — no custom design system, no bespoke component library
- Billing UI: Stripe Customer Portal — no custom subscription management screens
- Auth: Supabase Magic Links — no custom auth flow
- Email: Resend — no custom email infrastructure
- Error monitoring: Sentry — no custom logging dashboard

*Trade-off accepted:* The V1 product will look "standardized." The competitive moat is the generative data intelligence, not button gradients. Design polish is a Growth-phase investment.

### MVP Feature Set (Phase 1)

**Core User Journeys Supported:** All five journeys (Tim success path, Marco mobile, Sarah bilingual, Priya intake form, Tim edge case recovery)

**Must-Have Capabilities:**

| Capability | Scope Decision |
|---|---|
| Prompt intake + LLM schema generation | Full — with "Mad Libs" structured UI and Prompt Inflation |
| Schema explainability + override | Full — each generated table/field carries a one-line plain-language reason and a one-click remove/rename, shown at generation (not buried in settings) |
| Data import (CSV/Excel) with AI column mapping | Full — Tier 1; visible, editable mapping before commit; ambiguous columns flagged |
| Supabase DB provisioning | Full |
| Ontario-localized synthetic data injection | Full — trade-specific, GTA/Ottawa-localized |
| Dynamic Table/Card Views (desktop + mobile) | Full — shadcn/ui DataTable + swipeable card view |
| Contextual Add/Edit forms | Full — auto-generated from schema column types |
| Conversational Editor | **Append-Only** — add tables, add columns, generate views only |
| Deferred auth + magic link claim | Full |
| PWA setup | Full — auto-generated manifest + service workers |
| Two-role system (Admin / Member) | Full — metadata tag in Supabase Auth, conditional UI rendering |
| EN/FR UI + data toggle | Full — instant toggle, no reload |
| PIPEDA consent at claim | Full — mandatory unchecked checkbox, timestamp stored |
| Standalone Intake Form | Full — auto-generated at `scheza.com/forms/[slug]` |
| Stripe billing (Day 1) | Full — Checkout + Customer Portal + Webhook handler |
| Sentry error monitoring | Full |
| Schema Validator (blocking task) | Full — required gate before Conversational Editor ships |
| Self-Service Offboarding (30-day grace + cascade delete) | Full — before beta exit |
| Download My Data (CSV/JSON) | Full — before beta exit |

### Conversational Editor — Append-Only Constraint

**What the AI CAN do in V1:**
- Add a new column to an existing table
- Add a new table
- Generate a new view (filtered or sorted presentation of existing data)

**What the AI CANNOT do in V1:**
- Delete a table
- Delete a column
- Rename an existing column or table

**User-Facing Behaviour for Unsupported Operations:**
When a user requests a delete or rename, the AI responds: *"To keep your data safe, I can't delete columns yet — but I've hidden [column name] from your view. You won't see it, but your existing data is still protected."*

The hidden state is stored as a frontend display flag in the user's settings record. No database migration is executed. This eliminates weeks of migration engineering while delivering an acceptable UX for V1.

**Rationale:** Full schema mutation requires non-destructive migration pipelines that safely handle existing rows — significant engineering with high data-loss risk. Append-only constrains the editor to additive operations, which are inherently safe and cover 80% of real user requests.

### Prompt Quality — Three-Layer Mitigation System

**Layer 1 — "Mad Libs" Structured Prompt UI (Frontend)**
The landing page replaces a blank text box with a guided prompt builder:
> *"I run a* [Dropdown: Trade/Service type] *business in* [Text: City/Town]. *I need to keep track of* [Text: e.g., jobs, trucks, invoices, clients].*"*

Dropdown pre-loads with Ontario trade verticals: HVAC, Plumbing, Roofing, Snow Removal, Landscaping, Electrical, General Contracting, Other.

**Layer 2 — Prompt Inflation (Backend)**
The user's raw input is never sent directly to the LLM. The Next.js API route wraps it in an opinionated system prompt:
> *"You are an expert Ontario trades business consultant. The user runs a [trade] business in [city]. Design the ideal operational database for this business. You MUST include tables for Clients, Jobs/Projects, and Invoices at minimum. Add additional tables relevant to [trade]. Populate each table with 5–8 rows of realistic dummy data using real [city] street names, standard Ontario pricing, and trade-specific terminology. Output only valid JSON conforming to the schema definition format."*

**Layer 3 — Hard Fallback Schema**
If the LLM times out, returns invalid JSON, or fails Schema Validator checks twice consecutively, the system automatically deploys a hardcoded **Universal Field Service Template** (Clients, Jobs, Invoices) pre-seeded with generic Ontario dummy data. The user sees their dashboard within 30 seconds regardless of LLM performance. A subtle banner reads: *"We used a starter template — you can customize it using the chat."* No error screen is ever shown.

### Schema Explainability & Override (MVP)

Every AI-generated table and field carries a one-line, plain-language reason and a one-click remove or rename, surfaced at generation time — not buried in a settings panel. Example: *"Added Permit Number — roofing jobs in Ontario usually require one."* This is the Explainable-by-Default principle (Principle 3) applied to the first-impression moment, where trust is won or lost. The reason text is produced by the same generation call that proposes the schema; the override is a frontend action that, for removals, uses the existing append-only hide mechanism (no destructive migration).

### Data Import & Migration

Import — not signup — is the real onboarding gate and the primary activation event (see Success Criteria). Nobody starts from zero: the data is in a spreadsheet, QuickBooks, Jobber, or a filing cabinet. If the 30-second demo ends with "now re-enter three years of jobs," the user is lost at the exact moment they were won. Import also creates switching cost faster than organic usage does. The mapping UI must **show its work** — proposed column matches are visible and editable before commit (same explainability principle as schema generation); a silent black-box import of a business's entire history is exactly the moment to over-communicate.

| Tier | Scope | Phase | Rationale |
|---|---|---|---|
| 1 | CSV and Excel upload with AI column mapping | **MVP** | Covers the largest share of the market — most "systems" are spreadsheets. Reuses the schema-generation capability: understanding messy input and mapping it to structure is the same problem pointed at a different input. |
| 2 | Pre-built mappings for Jobber, Housecall Pro, ServiceTitan, QuickBooks exports | Growth | No API needed — recognizes their export file format and pre-fills the mapping. Turns generic import into "we already know your system." |
| 3 | Live two-way API sync with those tools | Phase 2 | Deferred — build only when paying customers ask. |

### Post-MVP Features (Growth — Post $1K MRR)

*Framing:* four items below — tenant activity logging, the workflow execution engine, the suggestion layer, and the learned-patterns record — are not independent features. Together they are **the nervous system a future autonomous operator runs on** (Phase 3): the activity log is its senses, the execution engine its hands, the learned patterns its memory. Each earns its place in Growth on its own merits (Business Snapshot, workflow suggestions, the moat), and each doubles as the substrate that makes the digital employee possible later without new architecture.

- Public-facing website generation with static site template library
- Custom domain routing with auto-provisioned SSL (Cloudflare for SaaS)
- Third-party integrations: Zapier/Make.com webhooks, QuickBooks export
- Full RBAC (Admin / Editor / Viewer roles with configurable UI)
- White-label resale for GTA/Ottawa digital agencies
- Conversational Editor: full mutation support (delete, rename, restructure with non-destructive migrations)
- **Data Import Tier 2:** pre-built export mappings for Jobber, Housecall Pro, ServiceTitan, and QuickBooks — recognizes each export format and pre-fills column mapping (no API required)
- **Tenant activity logging** — the append-only per-tenant event log (see Domain Requirements); a hard prerequisite for both Business Snapshot and Learned Patterns, and therefore sequenced first among the items below
- **Workflow execution engine** — trigger/action rules on database events with conditional logic; this does not exist in the MVP and is a **prerequisite for the Workflow Suggestion Layer** below
- **Workflow Suggestion Layer** — per-tenant pattern watcher that proposes workflows in plain language (e.g. *"Six jobs closed unbilled this month — add a reminder?"*); each suggestion is accepted, dismissed, or edited, and dismissals are remembered and not re-asked (depends on the execution engine above)
- **Learned Patterns record** — per-tenant capture of repeated manual field additions, edited workflows, dismissed suggestions, and terminology used; feeds future suggestions and schema refinements for that business specifically (depends on tenant activity logging)
- **Business Snapshot export** — owner-facing exportable summary (clean customer and job records, revenue history, activity timeline), positioned as *"your business, always ready to hand off, insure, or sell"*; a report over tenant activity logging, which must ship first

### Vision Features (Post $10K MRR)

- Industry vertical packs: RoofStack, HVACDesk, SnowOps (pre-seeded schema + template bundles)
- AI-powered operational insights and trend detection — read-only analysis surfaced by the Phase-3 operator (distinct from the actions it takes; see Phase 3)
- Community marketplace for user-contributed schema templates

### Phase 3: Autonomous Operations ("Your Digital Employee")

The endgame of the *build → suggest → run* arc: an always-on, per-tenant operator that executes routine operational work autonomously and reports back. This is the literal form of the product's core promise — turn your brain off at 6 PM.

**What it does (illustrative):** chases unbilled jobs, follows up on stale quotes, flags parts below reorder threshold, drafts customer follow-ups, and posts a daily summary to the owner's channel (SMS, messaging app, email, or dashboard).

**How it differs from the Growth Suggestion Layer (the load-bearing distinction):** the Suggestion Layer *proposes* and the human *acts*; the operator *executes* the approved action end-to-end and *remembers* the approval so it stops asking for that action-type. The graduation from suggestion inbox to digital employee — earned per action-type — is the whole of Phase 3. Without this distinction Phase 3 is just the suggestion layer with extra steps; with it, it is a different product tier.

**Safety model — propose → approve → remembered:** every action-type starts fully human-approved. As the owner approves the same action-type repeatedly, the operator earns autonomy *for that type only*. Money-spending and customer-facing actions (payments, customer emails) stay approval-gated the longest and are never autonomous by default. Every action runs under a per-actor, org-scoped identity through the action allowlist (the Schema Validator fence generalized from schema-ops to real-world actions), and is written to the tenant activity log for audit. A wrong autonomous action is a **Critical** risk because trades reputation spreads by word-of-mouth (see *Risk Register*). Because actions can reach real customers and, via connected tools, external services, the operator must honour **CASL** (consent for commercial electronic messages) and **PIPEDA** transparency for automated actions and for any tenant data shared with an external tool.

**Dependencies:** builds entirely on the Growth substrate — tenant activity logging (senses), the workflow execution engine (hands), and learned patterns (memory). Phase 3 adds no new data assets, only a new *use* of existing ones.

**Evolution — from one assistant to a digital crew:** the operator is a bundle of skills, and as trust grows it can be presented as named roles the owner already understands — a **bookkeeper** (invoicing, chasing unbilled jobs, reorder flags), a **sales** role (quote and lead follow-up, win-back nudges), an **operations** role (scheduling, dispatch prep). All roles share one per-tenant memory (the learned-patterns brain), so they act with the same understanding of the business — the sales role and the bookkeeper both know a given account pays late and prefers French. Each role's autonomy is granted and revoked independently. Bookkeeping and sales come first because they act on owned data; a marketing role comes last because it depends on external channels. The "crew" is a packaging of a mature operator, not a separate build — and the shared memory is the moat, because a generic third-party agent is a smart stranger every morning while this one has worked at the business for months.

**Connected external tools:** roles act beyond the business's own data through connected external tools via a standard tool-connection protocol (e.g. **MCP**) — email (e.g. **Gmail**), search/SEO data (e.g. **DataForSEO**), messaging, calendars. This is the agent-native evolution of the Growth-phase Zapier/Make integration line, and it is what lets a marketing role reach outside owned data (SEO gaps, outreach) rather than staying limited to it. Every connected tool is a **distinct allowlisted, approval-gated action class** with its own per-type trust threshold and, where it spends money (paid APIs), an explicit spend cap and admin opt-in; every tool call is audited to the activity log; and any tenant data shared with an external tool is governed by PIPEDA consent. External tools are the largest single expansion of the trust surface in the product — an agent with email can contact anyone, and an agent with a paid API can spend money — so they are the most tightly leashed capability in Phase 3, not the freest.

**Runtime — an always-on *capability*, not a mandated *server*:** the MVP is stateless serverless (Vercel) + Supabase; an autonomous operator needs always-on compute. The runtime is an explicit Phase 3 architecture decision among (a) a serverless-cron + durable-queue approach, (b) a managed agent runner (e.g. Inngest, Trigger.dev), or (c) a persistent worker/droplet. A **Hermes-style harness** — persistent memory, loop engineering, model-agnostic tool use — is the reference pattern and a leading candidate, named as a candidate, *not committed as a deployment.* Whatever the runtime, it couples to the app through the Supabase spine (durable activity log + guarded action layer), never through a private backdoor.

**Entry gate — narrated now, committed only when earned:** Phase 3 is not opened by an MRR number alone. The signals that justify building it are **proven week-4 retention at or above the 30% target** (the threshold already set in the Compounding-Value Metrics, past the novelty window) and **records under management growing month-over-month across at least two consecutive cohorts** — evidence that businesses stay and deepen, which is the precondition for an operator worth trusting. Until those hold, Phase 3 stays a documented direction, not a build. This gate is what keeps the thesis first-class in the narrative without inflating MVP scope.

### Phase 2 & Explicitly Out of Scope

Not in Phase 1 (neither MVP nor Growth):

- **Retail and hospitality POS integration** — Square, Shopify POS, Moneris, Lightspeed, Toast. These serve a different persona than trades: retailers transact at a counter, trades invoice per job. This is a real opportunity, not a dead end — the CSV and column-mapping engine built for trades is the same engine retail needs, so Phase 2 is new connectors rather than new architecture. Ranking: Square and Shopify POS first (API quality and install base); Moneris carries a local-Toronto trust angle; Lightspeed mid; Toast is restaurant-specific and lowest priority.
- **Live two-way API sync** with field-service tools (Tier 3 in Data Import & Migration).
- **Native iOS/Android apps** — responsive PWA first; native shells only if PWA limitations become a measured retention blocker.

**Signals that justify opening Phase 2:** trades customers requesting POS connections themselves, or trades acquisition slowing while retail interest arrives inbound. Not before.

### Risk Mitigation Strategy

| Risk | Mitigation |
|---|---|
| Conversational Editor scope creep | Append-Only constraint limits V1 to additive operations; full mutations deferred to Growth |
| Vague prompts producing generic dashboards | Three-layer mitigation: Mad Libs UI + Prompt Inflation + Hard Fallback Template |
| LLM hallucination breaking schema | Schema Validator (blocking task) + JSON strict mode + double-failure fallback |
| Solo founder bandwidth | Off-the-shelf mandate (shadcn/ui, Stripe Portal, Supabase Auth); no custom systems until Growth |
| Data loss from schema changes | Append-Only constraint eliminates destructive migrations from MVP scope |
| Trial-to-paid conversion failure | No usage caps during trial; Day 12 persistent banner; data volume creates switching cost |

### Build Priority

Ordered by dependency and payoff. Items 1–3 are MVP; 4–9 are Growth, sequenced so prerequisites precede the features that depend on them.

| # | Item | Effort | Phase | Why this order |
|---|---|---|---|---|
| 1 | CSV/Excel import with AI column mapping | Medium | MVP | Without it the demo stalls the moment a real user tries real work; it is the primary activation event |
| 2 | Usage-based metering | Low | MVP | Cheap now, expensive to retrofit once customers sit on legacy plans |
| 3 | Schema explainability + override | Low | MVP | Small UI change, disproportionate trust payoff at the first-impression moment |
| 4 | Tenant activity logging | Medium | Growth | Prerequisite substrate for Snapshot and Learned Patterns |
| 5 | Workflow execution engine | High | Growth | Prerequisite for the suggestion layer (does not exist in MVP) |
| 6 | Workflow suggestion layer | High | Growth | Biggest differentiator; needs real usage data to suggest against, so it follows import and the engine |
| 7 | Trades-software export mappings (Tier 2) | Medium | Growth | Turns generic import into "we already know your system" |
| 8 | Business Snapshot export | Low* | Growth | Reporting layer over activity logs (*Low only once logging from item 4 exists) |
| 9 | Learned patterns record | Medium | Growth | Long-term moat; compounds only after sustained usage |

### Open Questions

- [ ] Pure usage pricing vs base-plus-overage hybrid — hybrid is the current default; test pure usage as the A/B variant (see Pricing & Metering)
- [ ] Included-allotment size and overage rate for the hybrid model — needs validation against real trades-account record volumes
- [ ] Which trades vertical to target first for the initial cohort
- [ ] Whether pre-account generation creates abandoned-system cost worth capping

---

## Functional Requirements

### App Generation

- **FR1:** Visitor can describe their business using a guided structured prompt (trade type, city, and what they track) without creating an account
- **FR2:** The system generates a relational database schema from the user's prompt input within 45 seconds
- **FR3:** The system populates generated tables with hyper-contextual, Ontario-localized synthetic data at generation time
- **FR4:** The system automatically deploys a hardcoded Universal Field Service Template when LLM generation fails twice consecutively, without displaying an error screen
- **FR5:** Visitor can browse, interact with, and edit the generated dashboard before creating an account

### Data Management

- **FR6:** User can view records in a table as a data table (desktop) or swipeable card list (mobile)
- **FR7:** User can add new records to any table via an auto-generated form with input types matching the column data types
- **FR8:** User can edit existing records inline without navigating to a separate screen
- **FR9:** User can delete individual records from any table
- **FR10:** User can filter and sort records within any table view
- **FR11:** Admin can hide a column from all views without deleting the column or its stored data
- **FR12:** Multiple team members can view and edit records concurrently with changes reflected in real time

### Conversational Editor

- **FR13:** Admin can add a new column to an existing table by describing the change in natural language
- **FR14:** Admin can add a new table by describing it in natural language
- **FR15:** Admin can request a new filtered or sorted view of an existing table in natural language
- **FR16:** The system preserves all existing row data when schema changes are executed via the Conversational Editor
- **FR17:** The system responds with a safe, non-technical message when a user requests an unsupported operation (column delete, table delete, rename), and applies a frontend visibility change where applicable

### User Access & Permissions

- **FR18:** Visitor can claim a generated app by providing their email address and authenticating via a magic link
- **FR19:** User can authenticate to an existing account via magic link without a password
- **FR20:** Admin can invite team members to their dashboard by email address
- **FR21:** Admin can assign a role (Admin or Member) to each invited team member before the invitation is sent
- **FR22:** The system automatically assigns the Admin role to the account creator
- **FR23:** Member can view, add, and edit records
- **FR24:** Member cannot access the Conversational Editor, Settings, Invite, or Billing features

### Intake Forms

- **FR25:** The system automatically generates a public intake form URL for every claimed dashboard
- **FR26:** External visitors can submit records via the public intake form without creating an account
- **FR27:** Intake form submissions appear in the dashboard owner's data table in real time
- **FR28:** Admin receives an email notification when a new intake form submission is received (web push notifications are deferred to Growth phase; MVP fulfillment is email via Resend)

### Billing & Subscriptions

- **FR29:** User can begin a 14-day free trial without providing payment information
- **FR30:** Admin can start a usage-based paid subscription (monthly base fee plus metered overage on active records) via a Stripe-hosted checkout page
- **FR31:** Admin can manage their subscription (update payment method, view invoices with usage breakdown, cancel) via the Stripe Customer Portal
- **FR32:** The system transitions an account to read-only mode when the trial period expires or the subscription lapses
- **FR33:** Admin receives email notifications at Day 12 and Day 14 of the trial period prompting them to add billing

### Localization & Compliance

- **FR34:** User can switch the dashboard UI language between English and French without a page reload
- **FR35:** The system generates French-language synthetic data when the user's prompt is submitted in French
- **FR36:** The system displays a mandatory, unchecked privacy consent checkbox at account claim that must be checked before the account is created
- **FR37:** Admin can export all their organization's data as a CSV or JSON file
- **FR38:** The system places an account in a 30-day read-only grace period upon cancellation, then performs a hard cascade delete of all organization data
- **FR39:** Admin receives email notifications at Days 1, 7, and 25 of the offboarding grace period
- **FR40:** The system displays a field-level indicator on columns flagged as storing sensitive or personally identifiable data

### Platform & Security

- **FR41:** The system prompts mobile users to install the dashboard as a PWA on their home screen
- **FR42:** All schema modification requests from the Conversational Editor are validated against a permitted-operations allowlist before being executed
- **FR43:** The system rejects schema change requests containing restricted keywords and returns a user-facing plain-language error message
- **FR44:** Each organization's data is strictly isolated such that no authenticated user can read or write another organization's records
- **FR45:** All Schema Validator rejections are logged with the user's organization ID and raw LLM output for platform monitoring

### Schema Explainability (MVP)

- **FR46:** The system displays a one-line, plain-language reason for each AI-generated table and field at generation time
- **FR47:** User can remove or rename any AI-generated field or table with a single action at generation time, without opening a settings screen (removal uses the append-only hide mechanism; no destructive migration)

### Data Import (MVP — Tier 1)

- **FR48:** User can upload a CSV or Excel file to import records into their dashboard
- **FR49:** The system proposes an AI-generated column-to-field mapping for an uploaded file and displays it for review before any data is written
- **FR50:** User can edit any proposed column mapping before confirming the import
- **FR51:** The system flags columns it cannot confidently map rather than silently guessing, and requires the user to resolve them before import proceeds
- **FR52:** The system replaces synthetic demo data with imported real data without data loss upon the user confirming the import

### Billing — Usage Metering (MVP)

- **FR53:** The system meters the count of active records managed per billing cycle and reports it to the billing provider for overage calculation
- **FR54:** Admin can view current active-record usage against the included allotment at any time
- **FR55:** Admin can set an optional monthly spend cap; when the cap is reached, the system pauses new-record creation instead of accruing further charges

### Growth-Phase Requirements

*The following are Growth-phase capabilities (post-$1K MRR); they are listed here for traceability. Their sequencing and prerequisites are defined in Project Scoping.*

- **FR56:** The system records material per-tenant data events (record create, edit, delete; schema change; member invite; status change) to an append-only activity log scoped by organization
- **FR57:** The system proposes workflows to the Admin in plain language based on per-tenant usage patterns
- **FR58:** Admin can accept, edit, or dismiss each proposed workflow, and dismissed suggestions are not proposed again
- **FR59:** The system executes accepted workflows via trigger/action rules on database events with conditional logic
- **FR60:** The system maintains a per-tenant record of repeated manual actions, edited workflows, dismissed suggestions, and terminology, and uses it to inform future suggestions and schema refinements
- **FR61:** Admin can export a Business Snapshot summarizing customer and job records, revenue history, and activity timeline

### Autonomous Operations (Vision — Phase 3)

*The following are Phase 3 capabilities, gated on proven week-4 retention and month-over-month records-under-management growth (see Project Scoping — Phase 3). Listed here for traceability only; they are neither MVP nor Growth scope.*

- **FR62:** The system proposes a real-world operational action (e.g., send a follow-up, flag a reorder, update a status) to the Admin based on per-tenant patterns and pending work
- **FR63:** Admin can approve, edit, or reject each proposed action before it executes
- **FR64:** The system executes an approved action end-to-end and records it — before and after execution — to the tenant activity log
- **FR65:** The system executes an action-type autonomously once a per-type trust threshold is met (default: 5 consecutive Admin approvals of that action-type with no edit or rejection), while keeping money-spending and customer-facing action-types approval-gated by default (higher threshold, explicit Admin opt-in required)
- **FR66:** Admin can review, pause, or revoke the autonomy granted to any action-type at any time
- **FR67:** The system reports completed and pending autonomous work to the Admin via a chosen channel (SMS, messaging app, email, or dashboard)
- **FR68:** Admin can view and manage the operator's work organized as named roles (e.g., bookkeeping, sales follow-up, operations), each with autonomy granted or revoked independently
- **FR69:** The operator can perform actions through connected external tools (e.g., email, search/SEO, messaging) via a standard tool-connection protocol; each connected tool is an allowlisted, approval-gated action class subject to the same activity-log audit and per-type trust threshold, and money-spending tools additionally require an Admin-set spend cap and explicit opt-in

---

## Non-Functional Requirements

### Performance

| ID | Requirement |
|---|---|
| NFR-P1 | Prompt submission to interactive, populated dashboard: < 45 seconds at p95 |
| NFR-P2 | Supabase DB provisioning from validated JSON schema: < 5 seconds |
| NFR-P3 | Dashboard page load for an authenticated returning user: < 2 seconds at p95 on mobile LTE |
| NFR-P4 | Inline record edits appear in the UI immediately (optimistic rendering); server confirmation within 1 second |
| NFR-P5 | Real-time record updates sync to all active shared dashboard members within 2 seconds |
| NFR-P6 | EN/FR language toggle applies in < 300ms with no page reload |
| NFR-P7 | CSV/Excel import of up to 5,000 rows completes in < 60 seconds; the column-mapping preview renders in < 5 seconds of file upload |
| NFR-P8 | (Growth) Workflow suggestions are computed asynchronously and never block CRUD operations; a computed suggestion surfaces within one dashboard session refresh |

*Rationale:* Performance is SnapBusy's primary competitive differentiator. TTV < 45 seconds is a core product promise; any regression beyond this threshold directly undermines the "aha moment" and the activation funnel.

### Security

| ID | Requirement |
|---|---|
| NFR-S1 | All data in transit must be encrypted using TLS 1.2 or higher |
| NFR-S2 | All data at rest must be encrypted at the infrastructure level (AES-256 or equivalent via Supabase/AWS) |
| NFR-S3 | Row-Level Security policies must be active on 100% of tenant-generated tables — verified by automated test before any table is exposed to the frontend |
| NFR-S4 | The Schema Validator must reject 100% of requests containing restricted keywords (`DROP`, `GRANT`, `TRUNCATE`, `DELETE`, `EXEC`, `--`, `;`, `/*`) |
| NFR-S5 | 100% of LLM API calls must include the hardened identity-masking system prompt |
| NFR-S6 | The Supabase service role key must never appear in client-side code — enforced by a CI lint rule that fails the build if the key is detected in frontend bundles |

### Scalability

| ID | Requirement |
|---|---|
| NFR-SC1 | The architecture must support 200 concurrent active organizations without manual infrastructure changes |
| NFR-SC2 | Vercel serverless functions must auto-scale to handle traffic spikes without manual intervention |
| NFR-SC3 | Each organization's generated schema may contain up to 20 tables and 50,000 rows within the MVP infrastructure tier; growth beyond this triggers an upgrade prompt to the Admin |

*Note:* The serverless stack (Vercel + Supabase) handles auto-scaling natively. NFR-SC3 defines the explicit ceiling at which SnapBusy must proactively communicate an upgrade path rather than silently degrading.

### Accessibility

| ID | Requirement |
|---|---|
| NFR-A1 | All UI text and interactive elements must meet WCAG AA color contrast ratios at minimum; WCAG AAA where achievable (per AODA obligations for Ontario-serving products) |
| NFR-A2 | All interactive elements (buttons, row selectors, form fields, toggles) must have a minimum touch target of 48×48px |
| NFR-A3 | AI-generated UI components must include ARIA role labels derived from schema context (e.g., a column named "Invoice Status" generates `aria-label="Invoice Status"`) |
| NFR-A4 | All form fields must have associated visible or screen-reader-accessible labels — no placeholder-only labelling |

### Reliability

| ID | Requirement |
|---|---|
| NFR-R1 | Core dashboard operations (view, add, edit, delete records) must remain available during LLM API outages — LLM is not a dependency for CRUD operations, only for schema generation and the Conversational Editor |
| NFR-R2 | Platform uptime target: 99.5% monthly for MVP; 99.9% monthly for Growth phase |
| NFR-R3 | LLM API timeout threshold: 15 seconds; the Hard Fallback Schema must be triggered automatically at this threshold — no user-facing timeout or error screen |
| NFR-R4 | Stripe webhook processing failures must not affect a user's ability to access their dashboard — subscription status is cached in Supabase and serves as the fallback source of truth if Stripe is unreachable |
| NFR-R5 | Active-record usage counts reported to the billing provider must reconcile with the database record count within a 1% tolerance per cycle, verified by an automated reconciliation job — billing accuracy is a trust requirement under usage pricing |

### Forward-Compatibility (Autonomous Operations — Phase 3)

These constraints apply to the **MVP** so a future autonomous operator (Phase 3) can be added without re-architecture. They are limits on *how* the MVP is built, not MVP build work — nothing agentic ships in MVP.

| ID | Requirement |
|---|---|
| NFR-FC1 | All tenant-data mutations — from the app today and any future automated actor — must flow through a single guarded action layer under a per-actor, org-scoped identity subject to RLS; no code path may write tenant data using the raw Supabase service-role key |
| NFR-FC2 | The tenant activity log (Growth) must be an authoritative, append-only event stream consumable via a replayable cursor; Supabase Realtime / Postgres NOTIFY may serve only as a wake-up optimization, never as the system of record for events |
| NFR-FC3 | The MVP must not assume request-scoped compute is the only compute; a documented seam must exist for a persistent or scheduled worker to read the event stream and invoke the guarded action layer out-of-band |
| NFR-FC4 | Any future autonomous action must be expressible as an entry on an action allowlist (the Schema Validator model generalized from schema-ops to real-world actions) and must be recorded to the activity log before and after execution |

*Rationale:* these are the cheap-now/expensive-later seams — the same logic that justified usage-based metering from Day 1. They preserve the option to build the digital employee (Phase 3) without foreclosing it in MVP, and they keep the security fence intact when the AI graduates from proposing structure to taking action.
