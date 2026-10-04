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
 *   - the MVP scalar field types (`text | number | boolean | date | datetime |
 *     currency | email | phone`) plus single-reference `relation` fields
 *     (Story 1.8): a Job→Client link and an Invoice→Job link, so the fallback
 *     demonstrates linked tables too;
 *   - a `displayField` per table (the canonical row label);
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
        "The people and businesses you serve: the core list every field-service business keeps.",
      displayField: "name",
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
          reason: "Where the work happens, which helps with routing and scheduling.",
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
          type: "select",
          options: [
            { value: "active", label: "Active" },
            { value: "prospective", label: "Prospective" },
            { value: "past", label: "Past" },
          ],
          reason: "Whether they're an active, prospective, or past client.",
        },
      ],
    },
    {
      key: "jobs",
      label: "Jobs",
      reason:
        "The work you're booked to do, and what keeps your schedule and revenue moving.",
      displayField: "service",
      fields: [
        {
          key: "client",
          label: "Client",
          type: "relation",
          relationConfig: { targetTable: "clients", cardinality: "one" },
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
          reason: "The agreed price, the number that becomes revenue.",
        },
        {
          key: "status",
          label: "Status",
          type: "select",
          options: [
            { value: "scheduled", label: "Scheduled" },
            { value: "in_progress", label: "In progress" },
            { value: "quoted", label: "Quoted" },
            { value: "complete", label: "Complete" },
          ],
          reason: "Where the job stands so nothing falls through.",
        },
      ],
    },
    {
      key: "invoices",
      label: "Invoices",
      reason:
        "What you've billed and what's still owed, so you can keep cash flowing.",
      displayField: "invoice_number",
      fields: [
        {
          key: "invoice_number",
          label: "Invoice #",
          type: "text",
          reason: "The reference number you and the client use for this invoice.",
        },
        {
          key: "job",
          label: "Job",
          type: "relation",
          relationConfig: { targetTable: "jobs", cardinality: "one" },
          reason: "Which job this invoice bills for.",
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
          reason: "When payment is expected, so you can chase what's overdue.",
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
 *
 * Relation columns (Story 1.8) carry the TARGET row's `displayField` value, not
 * an id: `jobs.client` holds the client's `name`, `invoices.job` holds the
 * job's `service`. Provisioning inserts referenced tables first, maps each
 * table's display value → inserted id, then rewrites these to the target ids
 * before writing (so `records.data` stores the id). The values below are chosen
 * to match a real target row so every reference resolves.
 */
export const FALLBACK_SEED_ROWS: Record<
  string,
  Array<Record<string, unknown>>
> = {
  clients: [
    { name: "Maple Ridge Dental", city: "Ottawa", phone: "613-555-0142", email: "office@mapleridgedental.ca", status: "active" },
    { name: "Bytown Bakery", city: "Ottawa", phone: "613-555-0188", email: "hello@bytownbakery.ca", status: "active" },
    { name: "Rideau Auto Body", city: "Kanata", phone: "613-555-0119", email: "service@rideauautobody.ca", status: "prospective" },
    { name: "Glebe Family Clinic", city: "Ottawa", phone: "613-555-0173", email: "admin@glebeclinic.ca", status: "active" },
    { name: "Carleton Property Mgmt", city: "Nepean", phone: "613-555-0156", email: "ops@carletonpm.ca", status: "active" },
    { name: "Westboro Yoga Studio", city: "Ottawa", phone: "613-555-0127", email: "studio@westboroyoga.ca", status: "past" },
  ],
  jobs: [
    { client: "Maple Ridge Dental", service: "Rooftop HVAC install", scheduled_date: "2026-10-06", quoted: 8400, status: "scheduled" },
    { client: "Bytown Bakery", service: "Walk-in cooler repair", scheduled_date: "2026-09-29", quoted: 1250, status: "in_progress" },
    { client: "Rideau Auto Body", service: "Furnace replacement", scheduled_date: "2026-10-13", quoted: 5600, status: "quoted" },
    { client: "Glebe Family Clinic", service: "Ductwork cleaning", scheduled_date: "2026-09-22", quoted: 980, status: "complete" },
    { client: "Carleton Property Mgmt", service: "Boiler annual service", scheduled_date: "2026-10-02", quoted: 2100, status: "scheduled" },
    { client: "Westboro Yoga Studio", service: "AC unit install", scheduled_date: "2026-10-20", quoted: 4300, status: "quoted" },
  ],
  invoices: [
    { invoice_number: "INV-1001", job: "Ductwork cleaning", amount: 980, issued_date: "2026-09-23", due_date: "2026-10-23", paid: true },
    { invoice_number: "INV-1002", job: "Walk-in cooler repair", amount: 1250, issued_date: "2026-09-25", due_date: "2026-10-25", paid: false },
    { invoice_number: "INV-1003", job: "Rooftop HVAC install", amount: 8400, issued_date: "2026-09-20", due_date: "2026-10-20", paid: false },
    { invoice_number: "INV-1004", job: "Boiler annual service", amount: 2100, issued_date: "2026-09-18", due_date: "2026-10-18", paid: true },
    { invoice_number: "INV-1005", job: "Furnace replacement", amount: 5600, issued_date: "2026-09-27", due_date: "2026-10-27", paid: false },
    { invoice_number: "INV-1006", job: "AC unit install", amount: 4300, issued_date: "2026-09-15", due_date: "2026-10-15", paid: false },
  ],
};
