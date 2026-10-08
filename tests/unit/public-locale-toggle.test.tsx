import { describe, expect, it, vi } from "vitest";

/**
 * Coverage for the "Public locale toggle" I/O-matrix row (Story 15.1) on the
 * remaining public surfaces beyond the home route (home is covered in
 * `home-page.test.tsx`): the EN/FR `LocaleToggle` must be present on `/login`,
 * `/privacy`, and `/terms`.
 *
 * Each page is rendered to its React element tree and we assert the LocaleToggle
 * appears (a per-surface presence assertion per the spec). The LocaleToggle is
 * mocked to a recognizable sentinel so its presence is observable by element
 * `type`; the other client children (`LoginForm`) and the hooks the surfaces use
 * (`useSearchParams`, `next-intl`) are stubbed so these node-env renders never
 * pull a client/i18n runtime. The legal pages are async Server Components
 * (invoked directly); `/login` is a plain client component (called as a function).
 */

const LocaleToggleStub = () => null;
const LoginFormStub = () => null;

vi.mock("@/components/i18n/LocaleToggle", () => ({
  LocaleToggle: LocaleToggleStub,
}));
vi.mock("@/components/auth/LoginForm", () => ({ LoginForm: LoginFormStub }));
vi.mock("next/navigation", () => ({
  useSearchParams: () => ({ get: () => null }),
}));
vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));
vi.mock("next-intl/server", () => ({
  getTranslations: async () => (key: string) => key,
}));

/** Does the rendered React element tree contain the LocaleToggle sentinel? */
function treeHas(node: unknown, target: unknown): boolean {
  if (node == null || typeof node === "boolean") return false;
  if (Array.isArray(node)) return node.some((child) => treeHas(child, target));
  if (typeof node !== "object") return false;
  const el = node as { type?: unknown; props?: { children?: unknown } };
  if (el.type === target) return true;
  return treeHas(el.props?.children, target);
}

describe("Public locale toggle presence (Story 15.1)", () => {
  it("is present on /login", async () => {
    const { default: LoginPage } = await import("@/app/login/page");
    const element = LoginPage();
    expect(treeHas(element, LocaleToggleStub)).toBe(true);
  });

  it("is present on /privacy", async () => {
    const { default: PrivacyPage } = await import(
      "@/app/(legal)/privacy/page"
    );
    const element = await PrivacyPage();
    expect(treeHas(element, LocaleToggleStub)).toBe(true);
  });

  it("is present on /terms", async () => {
    const { default: TermsPage } = await import("@/app/(legal)/terms/page");
    const element = await TermsPage();
    expect(treeHas(element, LocaleToggleStub)).toBe(true);
  });
});
