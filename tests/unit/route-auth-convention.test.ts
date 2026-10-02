import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Convention gate for the recurring route-auth-duplication pattern (retro Epic 5
 * [A1] + process lesson #15).
 *
 * The admin + cross-org + writable chain has a single home: `resolveWritableAdminIdentity`
 * in `src/lib/api/route-helpers.ts` (admin gate + slug cross-check + assertWritable).
 * Hand-rolling it — calling `requireAdmin(...)` AND `resolveWritableOrgIdentity(...)`
 * inline in the same route handler — is the exact duplication flagged in the
 * epic-3/4/7/12/5 retrospectives and fixed in Epic 5 across the five schema routes.
 *
 * This test locks that fix in: no API route may re-hand-roll the combo. A route
 * that needs admin + writable must use the shared helper. (Using either primitive
 * alone is fine: `invite` needs membership-not-admin, records routes need writable
 * without the admin gate — those are legitimately different and not flagged.)
 */

const API_ROOT = join(process.cwd(), "src", "app", "api");

function routeFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...routeFiles(full));
    } else if (entry.name === "route.ts" || entry.name === "route.tsx") {
      out.push(full);
    }
  }
  return out;
}

describe("route-auth convention (retro Epic 5 [A1])", () => {
  it("no API route hand-rolls requireAdmin + resolveWritableOrgIdentity (use resolveWritableAdminIdentity)", () => {
    const offenders: string[] = [];
    for (const file of routeFiles(API_ROOT)) {
      const src = readFileSync(file, "utf8");
      if (src.includes("requireAdmin(") && src.includes("resolveWritableOrgIdentity(")) {
        offenders.push(file.replace(process.cwd(), "").replace(/\\/g, "/"));
      }
    }
    expect(
      offenders,
      `These routes hand-roll the admin+writable chain. Replace the requireAdmin + ` +
        `resolveWritableOrgIdentity block with resolveWritableAdminIdentity(slug, user) ` +
        `from @/lib/api/route-helpers:\n  ${offenders.join("\n  ")}`,
    ).toEqual([]);
  });
});
