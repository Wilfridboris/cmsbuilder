Here is a comprehensive **Product Requirements Document (PRD)** for **DashForge**, written from the perspective of a Senior Product Manager. This PRD translates our frictionless design vision into actionable engineering, design, and business requirements for a V1 (MVP) launch.

---

# 📄 Product Requirements Document (PRD)
**Product Name:** DashForge (BaseGen/Prompt-to-App)
**Document Status:** Approved for MVP Development
**Target Launch:** Q4 2026
**Target Market:** Ontario SMEs (Skilled Trades, Local Services, Niche Retail)

## 1. Overview & Problem Statement
### The Problem
Small business owners in Ontario (e.g., plumbers in Mississauga, snow removal in Ottawa) are trapped between two bad options: 
1. Messy, decentralized operations (Excel, paper invoices, WhatsApp).
2. Bloated, expensive SaaS (Salesforce, HubSpot, or even Wix) that requires technical skill and dozens of hours to configure.

### The Solution
DashForge is a **Generative Business Operating System**. A user types one natural language prompt explaining their business. Within 30 seconds, the platform uses AI to architect a relational database, generates a contextual UI, populates it with localized dummy data, and deploys it as a Progressive Web App (PWA). **Zero configuration. Zero menus. Instant value.**

---

## 2. Success Metrics (KPIs)
To measure if we are achieving our "frictionless" goal, we will track:
*   **Time-to-Value (TTV):** Target is **< 45 seconds** from pressing "Enter" on the prompt to interacting with the populated dashboard.
*   **Activation Rate:** % of visitors who generate an app AND click "Make it Real" (authenticate to claim the app). Target: **15%**.
*   **W1 Retention:** % of claimed users who log a real data entry in week one. Target: **40%**.
*   **Mobile Usage:** % of daily active users accessing via mobile PWA. Target: **> 70%**.

---

## 3. Target User Personas
*   **"Time-Starved Tim" (Primary):** 45-year-old HVAC contractor in the GTA. Has 5 trucks. Needs to track jobs, parts, and invoices. Hates computers, lives on his iPhone.
*   **"Scaling Sarah" (Secondary):** 30-year-old clinic manager in Ottawa. Needs to manage patient intake and staff schedules. Cares deeply about data privacy (PIPEDA) and bilingual access (EN/FR).

---

## 4. User Stories (The Core Flow)
1.  **As an unauthenticated user**, I want to describe my business in a single text box so that I don't have to navigate complex sign-up forms.
2.  **As a user**, I want to see my generated dashboard filled with fake, realistic data (e.g., Ontario addresses, dummy invoices) so that I instantly understand how to use it.
3.  **As a user**, I want to use a chat interface to ask for changes (e.g., "Add a column for employee hours") so that I don't have to learn how to edit a database schema.
4.  **As a business owner**, I want to click "Save & Claim" and log in with a magic link to instantly transition my app from "demo mode" to a live URL (`admin.dashforge.ca/mybusiness`).
5.  **As a mobile worker**, I want to save the dashboard to my phone’s home screen (PWA) so it feels like a native app on the job site.

---

## 5. MVP Feature Requirements (Scope)

### Epic 1: The Generative Engine (Backend)
*   **LLM Schema Generator:** Take natural language input and output a structured JSON schema defining tables, columns, and relationships.
*   **Instant DB Provisioning:** Use the JSON schema to instantly spin up a secure, isolated PostgreSQL database schema for that specific session.
*   **Synthetic Data Injector:** Prompt the LLM to generate 5-10 rows of highly contextual, localized dummy data (using Canadian names/cities) and insert it into the newly created database.

### Epic 2: The Adaptive UI (Frontend)
*   **Dynamic Table/Card Views:** A React-based UI that reads the database schema and automatically generates Data Tables (for desktop) and Swipeable Cards (for mobile).
*   **Contextual Forms:** Auto-generate "Add New" and "Edit" modals based on column data types (e.g., Date pickers for dates, Toggles for booleans).
*   **Conversational Editor:** A floating chat UI that takes a user's text request, sends it to the LLM to update the JSON schema, runs a database migration, and refreshes the UI dynamically.

### Epic 3: Authentication & Deployment
*   **Deferred Auth:** Users can generate and interact with the app *without* an account. Session state is held in the browser/cache.
*   **Magic Link Claim:** To deploy, user inputs email. System sends a magic link. Upon click, the demo database is wiped of dummy data, locked to the user's account, and moved to production status.
*   **PWA Setup:** A manifest file and service workers are automatically generated so users get an "Add to Home Screen" prompt on iOS/Android.

### Epic 4: Ontario-Specific Polish
*   **Bilingual Base:** UI scaffolding (menus, buttons) must support instant EN/FR toggling. 
*   **PIPEDA Compliance:** Data must be explicitly routed to Canadian-hosted servers (e.g., AWS ca-central-1).

---

## 6. Out of Scope for MVP (V2 Features)
*   *Do not build these yet. Keep the engineering team focused on speed.*
*   Custom Domain routing (MVP will use subdirectories: `dashforge.ca/[business]`).
*   Third-party integrations (Zapier, Quickbooks, Stripe).
*   Public-facing Website Generation (MVP focuses purely on the internal CMS/Dashboard to prove database value first).
*   Granular Role-Based Access Control (RBAC) (MVP will just have one "Admin" role).

---

## 7. Technical Architecture Guidelines
*   **Frontend:** Next.js (React), Tailwind CSS, shadcn/ui.
*   **Backend/Database:** Supabase (PostgreSQL). Excellent API for programmatic table creation and row-level security (RLS).
*   **AI Engine:** OpenAI GPT-4o or Anthropic Claude 3.5 Sonnet (optimized for strict JSON schema output).
*   **Hosting:** Vercel (Frontend), AWS Canada (Backend/DB for data residency).

---

## 8. Go-To-Market (GTM) Strategy & Risks
### Launch Plan
*   **Targeted Cold Outreach:** Scrape Google Maps for trades businesses in the GTA (ratings < 4 stars usually indicate operational mess). Pre-generate apps for them based on their Google profiles and email them the link: *"Hey Tim, I built this app for Tim's HVAC. Click here to use it."*
*   **Pricing:** $49/month flat rate. First 14 days free (auto-starts when they claim the app). 

### Biggest Risks & Mitigations
*   **Risk:** Hallucinations. The AI generates a broken schema or weird tables.
    *   *Mitigation:* Strict JSON enforcement via the LLM API. Fallback generic schemas if the AI fails.
*   **Risk:** Malicious Prompt Injection. Users trying to break the DB via the chat editor.
    *   *Mitigation:* The LLM must not execute SQL directly. It outputs JSON; our backend sanitizes and validates the JSON before running Supabase migrations.

---
**Sign-offs required before Sprint 1 Planning:**
* [ ] Lead Engineer
* [ ] Lead Product Designer
* [ ] Founders/Stakeholders