import { describe, expect, it } from "vitest";
import { normalizeTableName } from "@/lib/utils";

/**
 * Story 1.1 smoke test — proves the Vitest harness runs green in CI and that
 * the `@/*` path alias resolves in the test environment. Real unit/integration
 * suites (validator, provisioner, RLS isolation) are added by Stories 1.2+.
 */
describe("test harness", () => {
  it("runs", () => {
    expect(1 + 1).toBe(2);
  });

  it("resolves the @/* import alias and runs source code", () => {
    expect(normalizeTableName("  Job Tracking! ")).toBe("job_tracking");
  });
});
