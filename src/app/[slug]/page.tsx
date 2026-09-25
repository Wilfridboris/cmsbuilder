import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";

import { getCurrentUser } from "@/lib/auth/session";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { getSchema, listRecords } from "@/lib/data/records";
import { visibleTables } from "@/lib/schema/overrides";
import { formatCell, type CellStrings } from "@/lib/format";
import type { RecordData } from "@/types/db";

/**
 * Protected tenant dashboard at `/{slug}` (Story 2.1).
 *
 * Server component. Proves post-claim isolation: it resolves the slug to an org
 * through the caller's RLS-scoped client, so a non-member's read yields NO row
 * (RLS filters silently) and they are redirected to the claim/login entry — no
 * data leak. A member (the Admin creator) sees the live schema with their 1.7
 * overrides applied and the synthetic rows gone (cleared at finalize).
 *
 * Read-only rendering only: no record CRUD UI here (that is Epic 3). The tables
 * render empty of synthetic data, proving the clear.
 */

export const dynamic = "force-dynamic";

export default async function SlugDashboardPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const t = await getTranslations("SlugDashboard");
  const tGenerate = await getTranslations("Generate");

  // Middleware already gated unauthenticated access; re-check for defense in
  // depth (and to have the user in hand).
  const user = await getCurrentUser();
  if (!user) {
    redirect("/?auth=required");
  }

  const cookieStore = await cookies();
  const supabase = createServerSupabaseClient(cookieStore);

  // Resolve the slug → org UNDER RLS. A non-member sees no row and is bounced.
  const { data: org, error: orgError } = await supabase
    .from("organizations")
    .select("id, name")
    .eq("slug", slug)
    .maybeSingle();

  if (orgError || !org) {
    redirect("/?auth=required");
  }

  const orgId = org.id as string;

  const schemaResult = await getSchema(supabase, orgId);
  const tables = visibleTables(schemaResult.data ?? { tables: [] });

  // Load live rows per table concurrently (post-clear these are empty; Epic 3
  // adds CRUD). The per-table reads are independent, so fan them out.
  const recordLists = await Promise.all(
    tables.map((table) => listRecords(supabase, orgId, table.key)),
  );
  const recordsByTable: Record<string, RecordData[]> = {};
  tables.forEach((table, i) => {
    recordsByTable[table.key] = recordLists[i].data ?? [];
  });

  const cellStrings: CellStrings = {
    empty: tGenerate("cellEmpty"),
    yes: tGenerate("cellYes"),
    no: tGenerate("cellNo"),
  };

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-8 px-6 py-16">
      <header className="flex flex-col gap-2">
        <h1 className="text-3xl font-semibold tracking-tight text-balance">
          {org.name as string}
        </h1>
        <p className="text-base text-muted-foreground text-pretty">
          {t("subtitle")}
        </p>
      </header>

      {tables.length === 0 ? (
        <p className="text-base text-muted-foreground">{t("emptyDashboard")}</p>
      ) : (
        <div className="flex flex-col gap-10">
          {tables.map((table) => {
            const fields = table.fields.filter((field) => !field.hidden);
            const rows = recordsByTable[table.key] ?? [];
            return (
              <section key={table.key} className="flex flex-col gap-3">
                <h2 className="text-xl font-semibold tracking-tight">
                  {table.label}
                </h2>
                {rows.length === 0 ? (
                  <p className="text-sm text-muted-foreground">{t("emptyTable")}</p>
                ) : (
                  <div className="overflow-x-auto rounded-lg border">
                    <table className="w-full border-collapse text-left text-sm">
                      <thead>
                        <tr className="border-b bg-muted/40">
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
                          <tr key={row.id} className="border-b last:border-b-0">
                            {fields.map((field) => (
                              <td key={field.key} className="px-4 py-3">
                                {formatCell(
                                  row.data[field.key],
                                  field.type,
                                  cellStrings,
                                )}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>
            );
          })}
        </div>
      )}
    </main>
  );
}
