import { describe, expect, it } from "vitest";
import type { FieldDefinition, FormFieldConfig } from "@/types/db";
import { applyFieldConfig } from "@/lib/intake/target";

/**
 * Pure-resolution coverage for `applyFieldConfig` (Epic 14, Story 14.5) — the SINGLE place
 * the per-field config is applied over the base intake field list. Locks the frozen I/O &
 * Edge-Case Matrix invariants: empty-config passthrough, include/exclude, reorder, label
 * override, helpText attach, and that a relation/stale key never surfaces (the base is
 * always `intakeFields`, so relation/hidden fields can never be in `base` and a config key
 * naming one is simply ignored).
 */

/** A base list standing in for `intakeFields(table)` — already non-hidden, non-relation. */
function base(): FieldDefinition[] {
  return [
    { key: "name", label: "Name", type: "text" },
    { key: "email", label: "Email", type: "email" },
    { key: "phone", label: "Phone", type: "phone" },
  ];
}

describe("applyFieldConfig — empty config passthrough", () => {
  it("returns the base unchanged (same reference) for an empty config", () => {
    const input = base();
    const result = applyFieldConfig(input, []);
    expect(result).toBe(input);
  });
});

describe("applyFieldConfig — include / exclude", () => {
  it("drops a field whose entry is included:false", () => {
    const config: FormFieldConfig[] = [
      { key: "name", included: true, order: 0 },
      { key: "email", included: false, order: 1 },
      { key: "phone", included: true, order: 2 },
    ];
    const result = applyFieldConfig(base(), config);
    expect(result.map((f) => f.key)).toEqual(["name", "phone"]);
  });

  it("fails open: a base field with NO entry is kept, appended after configured fields", () => {
    // Only `phone` is configured; `name`/`email` have no entry -> kept, after `phone`.
    const config: FormFieldConfig[] = [{ key: "phone", included: true, order: 0 }];
    const result = applyFieldConfig(base(), config);
    expect(result.map((f) => f.key)).toEqual(["phone", "name", "email"]);
  });

  it("returns an empty list when every field is excluded", () => {
    const config: FormFieldConfig[] = [
      { key: "name", included: false },
      { key: "email", included: false },
      { key: "phone", included: false },
    ];
    expect(applyFieldConfig(base(), config)).toEqual([]);
  });
});

describe("applyFieldConfig — reorder", () => {
  it("orders configured fields by `order` ascending", () => {
    const config: FormFieldConfig[] = [
      { key: "name", order: 2 },
      { key: "email", order: 0 },
      { key: "phone", order: 1 },
    ];
    const result = applyFieldConfig(base(), config);
    expect(result.map((f) => f.key)).toEqual(["email", "phone", "name"]);
  });
});

describe("applyFieldConfig — label override + helpText", () => {
  it("overrides the label in place and attaches non-blank helpText without mutating the input", () => {
    const input = base();
    const config: FormFieldConfig[] = [
      { key: "name", label: "Your full name", helpText: "First and last", order: 0 },
      { key: "email", order: 1 },
      { key: "phone", order: 2 },
    ];
    const result = applyFieldConfig(input, config);

    const name = result.find((f) => f.key === "name")!;
    expect(name.label).toBe("Your full name");
    expect(name.helpText).toBe("First and last");

    // A field with no label override keeps its schema label and carries no helpText.
    const email = result.find((f) => f.key === "email")!;
    expect(email.label).toBe("Email");
    expect(email.helpText).toBeUndefined();

    // The input base is untouched (shallow-copy override).
    expect(input.find((f) => f.key === "name")!.label).toBe("Name");
  });

  it("keeps the schema label when the public label is blank/whitespace, and omits blank helpText", () => {
    const config: FormFieldConfig[] = [
      { key: "name", label: "   ", helpText: "  ", order: 0 },
    ];
    const result = applyFieldConfig(base(), config);
    const name = result.find((f) => f.key === "name")!;
    expect(name.label).toBe("Name");
    expect(name.helpText).toBeUndefined();
  });
});

describe("applyFieldConfig — relation / stale keys never surface", () => {
  it("ignores a config entry whose key is not a base field (relation or removed field)", () => {
    // `owner` (a relation, never in `base` because base is intakeFields) and `ghost`
    // (a removed field) are not base fields -> ignored entirely.
    const config: FormFieldConfig[] = [
      { key: "name", order: 0 },
      { key: "owner", label: "Owner", order: 1 },
      { key: "ghost", included: true, order: 2 },
      { key: "email", order: 3 },
      { key: "phone", order: 4 },
    ];
    const result = applyFieldConfig(base(), config);
    expect(result.map((f) => f.key)).toEqual(["name", "email", "phone"]);
    // No stale/relation key leaked a label.
    expect(result.some((f) => f.key === "owner" || f.key === "ghost")).toBe(false);
  });
});
