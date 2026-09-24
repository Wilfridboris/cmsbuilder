import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/** Merge conditional class names, de-duplicating Tailwind utilities. */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Normalize a user-provided table/field name into a safe `snake_case` key
 * before it is persisted as a `table_key` or field `key`.
 *
 * Story 1.1 provides only this pure helper (referenced across later stories);
 * the Schema Validator, provisioner, and mutation layer that consume it are
 * owned by Stories 1.2+.
 */
export function normalizeTableName(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/['"]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}
