import { getTranslations } from "next-intl/server";

import { createAdminClient } from "@/lib/supabase/admin";
import { getSchema, listRecords } from "@/lib/data/records";
import { DEMO_ORG_ID, DEMO_TABLE_KEY } from "@/lib/data/seed";
import type { FieldDefinition } from "@/types/db";

/**
 * Walking-skeleton demo route (Story 1.2).
 *
 * Server component. Epic 1 has no authenticated users, so an anonymous visitor
 * has no `auth.uid()` and RLS on `records` would return nothing. This route
 * therefore reads the fixed demo org through the BOOTSTRAP admin client scoped
 * to `DEMO_ORG_ID` — a documented pre-auth bootstrap path (same category as
 * anonymous generation). RLS *enforcement* is proven by the integration test
 * with real JWTs, NOT by this route; `records.ts` stays identity-agnostic so
 * the same functions serve both.
 *
 * Read-only by design: no CRUD, edit, filter/sort, or real-time sync (later
 * stories). Headers come from the schema definition; cells from each row's
 * JSONB `data`. Never renders an error screen — a failed read degrades to the
 * empty-state copy.
 */
export default async function DemoPage() {
  const t = await getTranslations("Demo");
  const admin = createAdminClient();

  const [schemaResult, recordsResult] = await Promise.all([
    getSchema(admin, DEMO_ORG_ID),
    listRecords(admin, DEMO_ORG_ID, DEMO_TABLE_KEY),
  ]);

  const table = schemaResult.data?.tables.find((tbl) => tbl.key === DEMO_TABLE_KEY);
  const fields: FieldDefinition[] = (table?.fields ?? []).filter(
    (field) => !field.hidden,
  );
  const rows = recordsResult.data ?? [];
  const hasData = fields.length > 0 && rows.length > 0;

  return (
    <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-6 px-6 py-16">
      <header className="flex flex-col gap-2">
        <h1 className="text-3xl font-semibold tracking-tight">{t("title")}</h1>
        <p className="text-base text-foreground/70">{t("subtitle")}</p>
      </header>

      {hasData ? (
        <div className="overflow-x-auto rounded-lg border border-foreground/10">
          <table className="w-full border-collapse text-left text-sm">
            <caption className="sr-only">{t("tableCaption")}</caption>
            <thead>
              <tr className="border-b border-foreground/10 bg-foreground/5">
                {fields.map((field) => (
                  <th
                    key={field.key}
                    scope="col"
                    className="px-4 py-3 font-medium text-foreground/80"
                  >
                    {field.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr
                  key={row.id}
                  className="border-b border-foreground/5 last:border-b-0"
                >
                  {fields.map((field) => (
                    <td key={field.key} className="px-4 py-3 text-foreground/90">
                      {formatCell(row.data[field.key], field.type)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="text-base text-foreground/60">{t("empty")}</p>
      )}
    </main>
  );
}

/** Render a JSONB cell value per its field type. Non-load-bearing formatting. */
function formatCell(value: unknown, type: FieldDefinition["type"]): string {
  if (value === null || value === undefined) {
    return "—";
  }
  if (type === "currency" && typeof value === "number") {
    return new Intl.NumberFormat("en-CA", {
      style: "currency",
      currency: "CAD",
    }).format(value);
  }
  if (type === "boolean") {
    return value ? "Yes" : "No";
  }
  return String(value);
}
