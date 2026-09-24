# Supabase RLS Test Project & CI Gate — Setup

The RLS isolation test (`tests/integration/rls-isolation.test.ts`, run by
`npm run test:rls`) is a **hard CI gate**: it must run against a **real**
Supabase instance, never a mock. This doc records how the dedicated test
project and the CI secrets were set up so anyone can reproduce or rotate them.

- **Test project ref:** `rtzfehmkkmjqpuehllur` · **URL:** `https://rtzfehmkkmjqpuehllur.supabase.co`
- **Region:** `ca-central-1` (must match production — PIPEDA).
- **CI gate behaviour:** no secrets → self-skips (green); a *partial* secret set → **fails loudly**; all three set → **enforces**.

---

## 1. Create the test project
Supabase dashboard → **New project** → region **Canada (Central)** (`ca-central-1`).
Keep it **separate from production** — the test seeds and deletes users/orgs on every run.

## 2. Apply the platform migration
The schema lives in `supabase/migrations/`. Any one of:

```bash
# CLI (from repo root)
npx supabase login
npx supabase link --project-ref rtzfehmkkmjqpuehllur
npm run db:push            # applies supabase/migrations/ to the linked project
```

or paste each migration's SQL into the dashboard **SQL Editor**, or apply via the
Supabase MCP (`apply_migration`). It creates `organizations`, `org_members`,
`records`, `org_schemas`, the `auth_org_ids()` resolver, the membership RLS
policies, and the `org_active_record_counts` view.

## 3. Run the security advisors (do this after any DDL)
Check for RLS/security regressions the local `db reset` won't catch:

- Dashboard → **Advisors → Security**, or Supabase MCP `get_advisors(type: "security")`.
- Expected/benign here: `rls_enabled_no_policy` on `organizations`/`org_members`
  (intentional deny-default) and `auth_org_ids` being executable (returns only the
  caller's own memberships).
- **Fixed during setup:** `org_active_record_counts` was a default `SECURITY DEFINER`
  view (would bypass RLS and leak cross-tenant counts). Migration
  `20260924140953_harden_active_record_view.sql` recreates it `security_invoker=on`.

## 4. Set the GitHub Actions secrets
The workflow (`.github/workflows/ci.yml`) reads three secrets. Install and auth `gh`:

```bash
# install (Windows)
winget install --id GitHub.cli -e --accept-source-agreements --accept-package-agreements
gh auth login            # GitHub.com → HTTPS → browser; grant repo + workflow scopes
```

Set them (values from dashboard → **Settings → API**):

```bash
gh secret set SUPABASE_TEST_URL              --repo Wilfridboris/cmsbuilder --body "https://rtzfehmkkmjqpuehllur.supabase.co"
gh secret set SUPABASE_TEST_ANON_KEY         --repo Wilfridboris/cmsbuilder --body "<anon / publishable key>"
gh secret set SUPABASE_TEST_SERVICE_ROLE_KEY --repo Wilfridboris/cmsbuilder   # paste service_role when prompted (not echoed)

gh secret list --repo Wilfridboris/cmsbuilder   # confirm all three
```

> Set **all three** together — a partial set makes the gate fail on purpose.
> The `service_role` key is secret: set it via the prompt (no `--body`) so it
> never lands in shell history or logs.

## 5. Run the gate locally
Two options:

**A. Against the hosted test project** — put the three values in a git-ignored
`.env.test.local` at the repo root (loaded by `vitest.config.ts`):

```
SUPABASE_TEST_URL=https://rtzfehmkkmjqpuehllur.supabase.co
SUPABASE_TEST_ANON_KEY=<anon key>
SUPABASE_TEST_SERVICE_ROLE_KEY=<service_role key>
```
```bash
npm run test:rls          # expect 5 passed
```

**B. Against a local Supabase** (no hosted keys needed):

```bash
npx supabase start        # boots Postgres + applies migrations; prints URL + keys
# paste its URL / anon / service_role into .env.test.local, then:
npm run test:rls
npx supabase stop
```

## Command reference
| Purpose | Command |
|---|---|
| Install gh (Windows) | `winget install --id GitHub.cli -e --accept-source-agreements --accept-package-agreements` |
| Auth gh | `gh auth login` |
| Set a secret (value) | `gh secret set <NAME> --repo Wilfridboris/cmsbuilder --body "<value>"` |
| Set a secret (prompt) | `gh secret set <NAME> --repo Wilfridboris/cmsbuilder` |
| List secrets | `gh secret list --repo Wilfridboris/cmsbuilder` |
| Link project | `npx supabase link --project-ref rtzfehmkkmjqpuehllur` |
| Push migrations | `npm run db:push` |
| Local stack up/down | `npx supabase start` / `npx supabase stop` |
| Run the RLS gate | `npm run test:rls` |

> **Never commit** `.env.test.local` or any `service_role` key. `.env*.local` is git-ignored.
