import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";

import { getCurrentUser } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/admin";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { resolveUserOrgMembership } from "@/lib/auth/org";
import { getSchema, listRecords } from "@/lib/data/records";
import { visibleTables } from "@/lib/schema/overrides";
import { type CellStrings } from "@/lib/format";
import { RecordsView } from "@/components/dashboard/RecordsView";
import type { MemberRole, RecordData } from "@/types/db";

/**
 * Protected tenant dashboard at `/{slug}` (Story 2.1).
 *
 * Server component. Proves post-claim isolation: it resolves the slug to an org
 * through the caller's RLS-scoped client, so a non-member's read yields NO row
 * (RLS filters silently) and they are redirected to the claim/login entry — no
 * data leak. A member (the Admin creator) sees the live schema with their 1.7
 * overrides applied and the synthetic rows gone (cleared at finalize).
 *
 * Read-only rendering only: Story 3.1 renders the live schema as a responsive
 * table (desktop) / swipeable card (mobile) surface via `RecordsView`; record
 * CRUD, filter/sort, column-hide, and real-time are later Epic 3 stories. Post
 * claim the tables render empty of synthetic data, proving the clear.
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
    // Match middleware + the Settings gate: an unauthenticated visitor goes to
    // the login form, not the marketing home, so they can sign back in directly.
    redirect("/login?auth=required");
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

  // Resolve the caller's role for THIS org (mirrors the layout's membership
  // resolution). Drives whether the Admin-only Columns control renders; the
  // server route's `requireAdmin` is the real gate. A caller whose membership
  // doesn't resolve to this slug defaults to "member" (no control) — never a
  // crash. The service-role admin client is used ONLY for this membership read.
  const membership = await resolveUserOrgMembership(user.id, createAdminClient());
  const role: MemberRole =
    membership && membership.slug === slug ? membership.role : "member";

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
        <RecordsView
          slug={slug}
          orgId={orgId}
          role={role}
          tables={tables}
          recordsByTable={recordsByTable}
          cellStrings={cellStrings}
        />
      )}
    </main>
  );
}
