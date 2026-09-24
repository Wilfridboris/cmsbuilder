import "server-only";

import type { SchemaDefinition } from "@/types/db";

/**
 * Hard fallback template (Story 1.5) — the deterministic no-error dashboard.
 *
 * When generation fails twice (timeout, invalid JSON, or validator rejection),
 * `POST /api/generate` provisions this hardcoded universal field-service template
 * instead of returning an error screen. It is a plain `SchemaDefinition` — NOT
 * an LLM output — but it MUST pass `validateGeneratedSchema`/`filterSeedRows`
 * unchanged (the same safety gate the LLM output passes; a unit test asserts it):
 *   - exactly three tables (`clients`, `jobs`, `invoices`);
 *   - only the MVP scalar field types (`text | number | boolean | date |
 *     datetime | currency | email | phone`) — never `relation`;
 *   - a plain-language `reason` on every table AND every field (so Story 1.7
 *     explainability and Story 1.6 render work unchanged);
 *   - no reserved-column collisions, no blocked keywords.
 *
 * Content is English only: the fallback fires precisely when generation —
 * including its language detection — has already failed. Seed data is generic
 * Ontario-localized field-service data (real Ontario city names, plausible CAD
 * pricing, field-service terminology). Data-only, server-side; mirrors the
 * `DEMO_SCHEMA`/`DEMO_ROWS` shape in `src/lib/data/seed.ts`.
 */

/**
 * The universal field-service template: Clients, Jobs, Invoices. Marked
 * `isFallback: true` at provisioning time (the route spreads this and sets the
 * flag) so the flag is durable in `org_schemas.definition` and mirrored to the
 * client for the banner.
 */
export const UNIVERSAL_FIELD_SERVICE_TEMPLATE: SchemaDefinition = {
  tables: [
    {
      key: "clients",
      label: "Clients",
      reason:
        "The people and businesses you serve — the core list every field-service business keeps.",
      fields: [
        {
          key: "name",
          label: "Client",
          type: "text",
          reason: "Who the work is for.",
        },
        {
          key: "city",
          label: "City",
          type: "text",
          reason: "Where the work happens — helps with routing and scheduling.",
        },
        {
          key: "phone",
          label: "Phone",
          type: "phone",
          reason: "How you reach them to confirm or follow up.",
          sensitive: true,
        },
        {
          key: "email",
          label: "Email",
          type: "email",
          reason: "Where quotes and invoices are sent.",
          sensitive: true,
        },
        {
          key: "status",
          label: "Status",
          type: "text",
          reason: "Whether they're an active, prospective, or past client.",
        },
      ],
    },
    {
      key: "jobs",
      label: "Jobs",
      reason:
        "The work you're booked to do — what keeps your schedule and revenue moving.",
      fields: [
        {
          key: "client",
          label: "Client",
          type: "text",
          reason: "Which client the job is for.",
        },
        {
          key: "service",
          label: "Service",
          type: "text",
          reason: "What you're doing on this job.",
        },
        {
          key: "scheduled_date",
          label: "Scheduled",
          type: "date",
          reason: "When the work is booked so nothing gets missed.",
        },
        {
          key: "quoted",
          label: "Quoted",
          type: "currency",
          reason: "The agreed price — the number that becomes revenue.",
        },
        {
          key: "status",
          label: "Status",
          type: "text",
          reason: "Where the job stands so nothing falls through.",
        },
      ],
    },
    {
      key: "invoices",
      label: "Invoices",
      reason:
        "What you've billed and what's still owed — how you keep cash flowing.",
      fields: [
        {
          key: "client",
          label: "Client",
          type: "text",
          reason: "Who the invoice is billed to.",
        },
        {
          key: "amount",
          label: "Amount",
          type: "currency",
          reason: "How much is owed on this invoice.",
        },
        {
          key: "issued_date",
          label: "Issued",
          type: "date",
          reason: "When the invoice was sent.",
        },
        {
          key: "due_date",
          label: "Due",
          type: "date",
          reason: "When payment is expected — so you can chase what's overdue.",
        },
        {
          key: "paid",
          label: "Paid",
          type: "boolean",
          reason: "Whether the invoice has been settled.",
        },
      ],
    },
  ],
};

/**
 * Generic Ontario-localized seed rows keyed by `table_key` — 5–8 per table.
 * Real Ontario city names, plausible CAD pricing, and field-service
 * terminology. Passed through `filterSeedRows` unchanged (projected onto the
 * template's known field keys).
 */
export const FALLBACK_SEED_ROWS: Record<
  string,
  Array<Record<string, unknown>>
> = {
  clients: [
    { name: "Maple Ridge Dental", city: "Ottawa", phone: "613-555-0142", email: "office@mapleridgedental.ca", status: "Active" },
    { name: "Bytown Bakery", city: "Ottawa", phone: "613-555-0188", email: "hello@bytownbakery.ca", status: "Active" },
    { name: "Rideau Auto Body", city: "Kanata", phone: "613-555-0119", email: "service@rideauautobody.ca", status: "Prospective" },
    { name: "Glebe Family Clinic", city: "Ottawa", phone: "613-555-0173", email: "admin@glebeclinic.ca", status: "Active" },
    { name: "Carleton Property Mgmt", city: "Nepean", phone: "613-555-0156", email: "ops@carletonpm.ca", status: "Active" },
    { name: "Westboro Yoga Studio", city: "Ottawa", phone: "613-555-0127", email: "studio@westboroyoga.ca", status: "Past" },
  ],
  jobs: [
    { client: "Maple Ridge Dental", service: "Rooftop HVAC install", scheduled_date: "2026-10-06", quoted: 8400, status: "Scheduled" },
    { client: "Bytown Bakery", service: "Walk-in cooler repair", scheduled_date: "2026-09-29", quoted: 1250, status: "In progress" },
    { client: "Rideau Auto Body", service: "Furnace replacement", scheduled_date: "2026-10-13", quoted: 5600, status: "Quoted" },
    { client: "Glebe Family Clinic", service: "Ductwork cleaning", scheduled_date: "2026-09-22", quoted: 980, status: "Complete" },
    { client: "Carleton Property Mgmt", service: "Boiler annual service", scheduled_date: "2026-10-02", quoted: 2100, status: "Scheduled" },
    { client: "Westboro Yoga Studio", service: "AC unit install", scheduled_date: "2026-10-20", quoted: 4300, status: "Quoted" },
  ],
  invoices: [
    { client: "Glebe Family Clinic", amount: 980, issued_date: "2026-09-23", due_date: "2026-10-23", paid: true },
    { client: "Bytown Bakery", amount: 1250, issued_date: "2026-09-25", due_date: "2026-10-25", paid: false },
    { client: "Maple Ridge Dental", amount: 8400, issued_date: "2026-09-20", due_date: "2026-10-20", paid: false },
    { client: "Carleton Property Mgmt", amount: 2100, issued_date: "2026-09-18", due_date: "2026-10-18", paid: true },
    { client: "Rideau Auto Body", amount: 5600, issued_date: "2026-09-27", due_date: "2026-10-27", paid: false },
    { client: "Westboro Yoga Studio", amount: 4300, issued_date: "2026-09-15", due_date: "2026-10-15", paid: false },
  ],
};
