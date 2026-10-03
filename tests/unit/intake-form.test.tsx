import { renderToStaticMarkup } from "react-dom/server";
import { NextIntlClientProvider, type AbstractIntlMessages } from "next-intl";
import { describe, expect, it } from "vitest";

import en from "@/lib/i18n/en.json";
import fr from "@/lib/i18n/fr.json";
import type { FieldDefinition } from "@/types/db";
import { IntakeForm, Unavailable } from "@/components/intake/IntakeForm";

/**
 * SSR coverage for the public `IntakeForm` + `Unavailable` surface (Story 6.1),
 * closing the frozen I/O & Edge-Case matrix rows that live in the component: the
 * happy-path field render (one labelled, type-matched input per field, in order),
 * the boolean radiogroup, the present-but-unwired submit, the French-locale chrome,
 * and the friendly unavailable state.
 *
 * The repo test env is `node` (no jsdom), so the component — which calls the
 * isomorphic `useTranslations` hook — is exercised through React's server renderer
 * (`renderToStaticMarkup`) wrapped in `NextIntlClientProvider` with the REAL en/fr
 * catalogs, so the French-copy assertion is genuine (not an echoed key).
 */

function render(
  ui: React.ReactElement,
  locale: "en" | "fr" = "en",
  messages: AbstractIntlMessages = en as AbstractIntlMessages,
): string {
  return renderToStaticMarkup(
    <NextIntlClientProvider locale={locale} messages={messages} timeZone="UTC">
      {ui}
    </NextIntlClientProvider>,
  );
}

const HAPPY_FIELDS: FieldDefinition[] = [
  { key: "full_name", label: "Full Name", type: "text" },
  { key: "email", label: "Email Address", type: "email" },
  { key: "phone", label: "Phone", type: "phone" },
  { key: "preferred_date", label: "Preferred Date", type: "date" },
  { key: "appointment", label: "Appointment", type: "datetime" },
  { key: "quantity", label: "Quantity", type: "number" },
];

describe("IntakeForm — happy path", () => {
  const html = render(<IntakeForm orgName="Acme Plumbing" fields={HAPPY_FIELDS} />);

  it("renders the business name and the translated heading/CTA", () => {
    expect(html).toContain("Acme Plumbing");
    expect(html).toContain("Get in touch");
  });

  it("renders one label associated to its input (htmlFor/id) per field", () => {
    for (const field of HAPPY_FIELDS) {
      expect(html).toContain(`for="intake-${field.key}"`);
      expect(html).toContain(`id="intake-${field.key}"`);
      expect(html).toContain(field.label);
    }
  });

  it("maps each field type to the correct HTML input type", () => {
    // email -> email, phone -> tel, date -> date, datetime -> datetime-local.
    expect(html).toContain('id="intake-email"');
    expect(html).toMatch(/id="intake-email"[^>]*type="email"|type="email"[^>]*id="intake-email"/);
    expect(html).toMatch(/id="intake-phone"[^>]*type="tel"|type="tel"[^>]*id="intake-phone"/);
    expect(html).toMatch(/id="intake-preferred_date"[^>]*type="date"|type="date"[^>]*id="intake-preferred_date"/);
    expect(html).toMatch(
      /id="intake-appointment"[^>]*type="datetime-local"|type="datetime-local"[^>]*id="intake-appointment"/,
    );
    // text + number both fall back to a text input (number carries inputmode decimal).
    expect(html).toMatch(/id="intake-full_name"[^>]*type="text"|type="text"[^>]*id="intake-full_name"/);
    expect(html).toMatch(/id="intake-quantity"[^>]*type="text"|type="text"[^>]*id="intake-quantity"/);
    expect(html).toMatch(/inputmode="decimal"/i);
  });

  it("preserves schema field order", () => {
    const order = HAPPY_FIELDS.map((f) => html.indexOf(f.label));
    expect(order).toEqual([...order].sort((a, b) => a - b));
    expect(Math.min(...order)).toBeGreaterThan(-1);
  });

  it("renders a present-but-unwired submit (type=button, no form submission)", () => {
    expect(html).toContain("Send"); // the translated submit label
    expect(html).not.toContain('type="submit"');
    // The <form> carries no action (submission is wired in Story 6.2).
    expect(html).not.toMatch(/<form[^>]*\saction=/);
  });
});

describe("IntakeForm — boolean field", () => {
  it("renders a radiogroup with translated Yes/No, not a text input", () => {
    const html = render(
      <IntakeForm
        orgName="Acme"
        fields={[{ key: "subscribe", label: "Subscribe?", type: "boolean" }]}
      />,
    );
    expect(html).toContain('role="radiogroup"');
    expect(html).toContain('id="intake-subscribe"');
    expect(html).toContain('aria-label="Subscribe?"');
    expect((html.match(/role="radio"/g) ?? []).length).toBe(2);
    expect(html).toContain("Yes");
    expect(html).toContain("No");
    // A boolean renders the toggle, never a scalar <input>.
    expect(html).not.toContain("<input");
  });
});

describe("IntakeForm — French locale", () => {
  it("renders French chrome copy while field labels stay as authored", () => {
    const html = render(
      <IntakeForm orgName="Acme" fields={HAPPY_FIELDS} />,
      "fr",
      fr as AbstractIntlMessages,
    );
    expect(html).toContain("Contactez-nous"); // fr heading
    expect(html).not.toContain("Get in touch"); // en heading absent
    expect(html).toContain("Full Name"); // authored field label, not translated
  });
});

describe("Unavailable", () => {
  it("renders the friendly translated state with no error UI", () => {
    const html = render(<Unavailable />);
    expect(html).toContain("Form not available");
    expect(html).toContain("not available right now");
    expect(html).not.toContain('role="alert"');
    expect(html).not.toContain("<input");
  });

  it("renders French unavailable copy under the fr catalog", () => {
    const html = render(<Unavailable />, "fr", fr as AbstractIntlMessages);
    expect(html).toContain("Formulaire indisponible");
  });
});
