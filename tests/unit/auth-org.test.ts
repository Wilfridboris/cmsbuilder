import { describe, expect, it } from "vitest";

import {
  resolveUserPrimaryOrgSlug,
  resolveUserOrgMembership,
} from "@/lib/auth/org";

/**
 * Unit coverage for the `@/lib/auth/org` resolvers against a mock admin client:
 *
 * `resolveUserPrimaryOrgSlug` (Story 2.2) — the user→org resolution that lands a
 * returning user post-login:
 *   - most-recent membership resolves the org slug;
 *   - null when the user has no membership (routed to the no-org status);
 *   - null when the resolved org somehow has no slug;
 *   - throws on a membership read error (the callback maps this to ?claim=error).
 *
 * `resolveUserOrgMembership` (Story 2.3) — the admin-gating sibling that also
 * carries `org_members.role`:
 *   - returns { orgId, slug, role } for the most-recent membership (admin/member);
 *   - null when the user has no membership;
 *   - throws on a membership read error.
 * (Kept here rather than in auth-confirm.test.ts, which must mock this module.)
 */

/**
 * Minimal thenable query-builder stub mimicking the supabase-js chain the
 * resolver uses: `.from(t).select(c)...maybeSingle()`. Each `.from` call pops the
 * next queued result so the two sequential reads (org_members, then
 * organizations) can be scripted independently.
 */
function makeAdmin(results: Array<{ data: unknown; error: unknown }>) {
  let call = -1;
  const builder = {
    select: () => builder,
    eq: () => builder,
    order: () => builder,
    limit: () => builder,
    maybeSingle: async () => results[call],
  };
  return {
    from: () => {
      call += 1;
      return builder;
    },
  } as never;
}

describe("resolveUserPrimaryOrgSlug", () => {
  it("resolves the most-recent membership's org slug", async () => {
    const admin = makeAdmin([
      { data: { organization_id: "org-1" }, error: null },
      { data: { slug: "mikes-plumbing-laval" }, error: null },
    ]);

    const result = await resolveUserPrimaryOrgSlug("u1", admin);

    expect(result).toEqual({ slug: "mikes-plumbing-laval" });
  });

  it("returns null when the user has no membership", async () => {
    const admin = makeAdmin([{ data: null, error: null }]);

    const result = await resolveUserPrimaryOrgSlug("u1", admin);

    expect(result).toBeNull();
  });

  it("returns null when the resolved org has no slug", async () => {
    const admin = makeAdmin([
      { data: { organization_id: "org-1" }, error: null },
      { data: null, error: null },
    ]);

    const result = await resolveUserPrimaryOrgSlug("u1", admin);

    expect(result).toBeNull();
  });

  it("throws when the membership read errors", async () => {
    const admin = makeAdmin([
      { data: null, error: { message: "permission denied" } },
    ]);

    await expect(resolveUserPrimaryOrgSlug("u1", admin)).rejects.toThrow(
      /membership/i,
    );
  });
});

describe("resolveUserOrgMembership", () => {
  it("returns { orgId, slug, role } for the most-recent membership", async () => {
    const admin = makeAdmin([
      { data: { organization_id: "org-1", role: "admin" }, error: null },
      { data: { slug: "mikes-plumbing-laval" }, error: null },
    ]);

    const result = await resolveUserOrgMembership("admin-1", admin);

    expect(result).toEqual({
      orgId: "org-1",
      slug: "mikes-plumbing-laval",
      role: "admin",
    });
  });

  it("carries a member role through", async () => {
    const admin = makeAdmin([
      { data: { organization_id: "org-2", role: "member" }, error: null },
      { data: { slug: "acme" }, error: null },
    ]);

    const result = await resolveUserOrgMembership("u2", admin);

    expect(result).toEqual({ orgId: "org-2", slug: "acme", role: "member" });
  });

  it("returns null when the user has no membership", async () => {
    const admin = makeAdmin([{ data: null, error: null }]);

    const result = await resolveUserOrgMembership("nobody", admin);

    expect(result).toBeNull();
  });

  it("throws on a membership read error", async () => {
    const admin = makeAdmin([
      { data: null, error: { message: "permission denied" } },
    ]);

    await expect(resolveUserOrgMembership("u1", admin)).rejects.toThrow(
      /membership/i,
    );
  });
});
