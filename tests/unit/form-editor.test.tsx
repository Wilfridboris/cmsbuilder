import { renderToStaticMarkup } from "react-dom/server";
import { NextIntlClientProvider, type AbstractIntlMessages } from "next-intl";
import { describe, expect, it, vi } from "vitest";

import en from "@/lib/i18n/en.json";
import fr from "@/lib/i18n/fr.json";

/**
 * SSR render coverage for the Story 14.4 target-table card inside `FormEditor`. The repo
 * test env is `node` (no jsdom), so — like `intake-form.test.tsx` — the component is
 * exercised through `renderToStaticMarkup` wrapped in `NextIntlClientProvider` with the
 * REAL en/fr catalogs. This asserts the INITIAL render: the picker-vs-"no table" branch
 * and the published LOCK (picker + hint), which are otherwise only manually verified.
 * The interactive save path + server guards live in `form-target-mutation.test.ts` and
 * `forms-route.test.ts`.
 */

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: () => {}, refresh: () => {} }),
}));

import { FormEditor } from "@/components/forms/FormEditor";

const TABLES = [
  { key: "leads", label: "Leads" },
  { key: "clients", label: "Clients" },
];

function render(
  props: Partial<React.ComponentProps<typeof FormEditor>> = {},
  locale: "en" | "fr" = "en",
  messages: AbstractIntlMessages = en as AbstractIntlMessages,
): string {
  const full: React.ComponentProps<typeof FormEditor> = {
    slug: "acme",
    formId: "f1",
    initialTitle: "Job Request",
    initialSlug: "job-request",
    targetTableKey: "leads",
    tables: TABLES,
    editorFields: [],
    initialFieldConfig: [],
    initialIntroText: null,
    initialPublished: false,
    publishable: true,
    publishReason: "ok",
    ...props,
  };
  return renderToStaticMarkup(
    <NextIntlClientProvider locale={locale} messages={messages} timeZone="UTC">
      <FormEditor {...full} />
    </NextIntlClientProvider>,
  );
}

describe("FormEditor target card — render branches", () => {
  it("renders the table picker (Save table) when visible tables exist, not the empty note", () => {
    const html = render();
    expect(html).toContain("Save table");
    expect(html).not.toContain("No table is available yet");
    // Unpublished: no lock hint.
    expect(html).not.toContain("The table is locked while this form is published");
  });

  it("renders the empty-state note (not the picker) when there are no visible tables", () => {
    const html = render({ tables: [], targetTableKey: null });
    expect(html).toContain("No table is available yet");
    expect(html).not.toContain("Save table");
  });

  it("locks the target card with an unpublish hint when the form is published", () => {
    const html = render({ initialPublished: true });
    expect(html).toContain(
      "The table is locked while this form is published",
    );
    // A disabled control is present (the picker/Save lock).
    expect(html).toContain("disabled");
  });

  it("resolves the lock hint from the real French catalog", () => {
    const html = render({ initialPublished: true }, "fr", fr as AbstractIntlMessages);
    expect(html).toContain(
      "La table est verrouillée tant que ce formulaire est publié",
    );
  });
});
