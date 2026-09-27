import type { FieldDefinition, RecordData } from "@/types/db";

/**
 * Pure, node-testable filter & sort for the records surface (Story 3.4).
 *
 * Filter & sort are a CLIENT-SIDE VIEW CONCERN over the rows already cached under
 * `['records', slug, tableKey]`. Nothing here touches the server, the API, the
 * query key, or the mutation path — `applyFilterSort` transforms only the array
 * that gets rendered, and never mutates its inputs. After an optimistic write
 * settles and the query invalidates, the refetched rows simply re-flow through
 * this function, so a row that no longer matches drops out on the next render.
 *
 * Framework-agnostic (no React / next-intl) so it can be unit-tested in the node
 * env (repo has no jsdom), per the 3.1–3.3 precedent. Value coercion mirrors
 * `field-input.ts` (numbers/currency parse to finite numbers; text trims).
 */

/** Single-column sort. `direction` is `"asc"` or `"desc"`; `null` state = unsorted. */
export type SortState = {
  /** The field key to sort by. */
  field: string;
  /** Ascending or descending. */
  direction: "asc" | "desc";
} | null;

/**
 * The type-aware operators, capped per the resolved decision:
 *  - text            → contains | equals
 *  - number/currency → eq | lt | gt | between
 *  - date/datetime   → before | after | on | between
 *  - boolean         → is
 */
export type FilterOperator =
  | "contains"
  | "equals"
  | "eq"
  | "lt"
  | "gt"
  | "between"
  | "before"
  | "after"
  | "on"
  | "is";

/** One ANDed field filter. `value2` is only used by the `between` operator. */
export type FilterState = {
  /** The field key this filter targets. */
  field: string;
  /** The operator, valid for the field's type (see `operatorsForType`). */
  operator: FilterOperator;
  /** The comparison value (raw string as entered, or "true"/"false" for boolean). */
  value: string;
  /** The upper bound for `between` (raw string); ignored otherwise. */
  value2?: string;
};

/**
 * The fields eligible as filter/sort targets: every VISIBLE (non-`hidden`) field,
 * INCLUDING `relation` fields (Story 3.8 — filter/sort by relationship). Hidden
 * fields are a display concern and never offered. Preserves definition order.
 *
 * NOTE: relation filters are applied SERVER-SIDE (JSONB containment) in the records
 * query, not by `matchesFilter`; relation sort is applied client-side by label via
 * the resolver threaded into `applyFilterSort`. Both live alongside — not inside —
 * the scalar client-side pipeline.
 */
export function eligibleFields(fields: FieldDefinition[]): FieldDefinition[] {
  return fields.filter((field) => !field.hidden);
}

/**
 * The operators offered for a field type. Anything not listed here (e.g.
 * `relation`) returns an empty list. `email`/`phone` are text-like.
 */
export function operatorsForType(
  type: FieldDefinition["type"],
): FilterOperator[] {
  switch (type) {
    case "number":
    case "currency":
      return ["eq", "lt", "gt", "between"];
    case "date":
    case "datetime":
      return ["before", "after", "on", "between"];
    case "boolean":
      return ["is"];
    case "relation":
      // A relation is matched only by exact target ("is"); the value is a target
      // id and the filter is applied server-side via containment (Story 3.8).
      return ["is"];
    case "text":
    case "email":
    case "phone":
      return ["contains", "equals"];
    default:
      return [];
  }
}

// --- Coercion helpers (kept consistent with field-input.ts) ------------------

/** Parse a raw string to a finite number, or `null` when it is not numeric. */
function toNumber(raw: unknown): number | null {
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : null;
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (trimmed === "") return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}

/** Parse a raw value to an epoch-ms number, or `null` when unparseable/blank. */
function toTime(raw: unknown): number | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === "string" && raw.trim() === "") return null;
  const parsed = new Date(raw as string | number);
  const time = parsed.getTime();
  return Number.isNaN(time) ? null : time;
}

/** True when a cell value is "blank" for ordering/predicate purposes. */
function isBlank(value: unknown): boolean {
  return (
    value === null ||
    value === undefined ||
    (typeof value === "string" && value.trim() === "")
  );
}

/** Coerce any cell value to a boolean the way the boolean toggle stores it. */
function toBoolean(raw: unknown): boolean {
  if (typeof raw === "boolean") return raw;
  if (typeof raw === "string") return raw.trim().toLowerCase() === "true";
  return Boolean(raw);
}

// --- Predicates --------------------------------------------------------------

/**
 * Evaluate one filter against one row's value for the given field type. Returns
 * `true` when the row matches. Never throws on missing/mistyped values — an
 * uncomparable cell (blank number, bad date, etc.) simply does not match.
 */
export function matchesFilter(
  value: unknown,
  filter: FilterState,
  type: FieldDefinition["type"],
): boolean {
  const { operator } = filter;

  // Relation filters are applied SERVER-SIDE (JSONB containment in the records
  // query), never here — the rows this function sees are already narrowed. Never
  // re-filter a relation client-side (the cell holds an id, not the label).
  if (type === "relation") {
    return true;
  }

  if (type === "boolean") {
    // "is": compare the cell's boolean to the chosen "true"/"false".
    return toBoolean(value) === toBoolean(filter.value);
  }

  if (type === "number" || type === "currency") {
    const cell = toNumber(value);
    if (cell === null) return false;
    const a = toNumber(filter.value);
    if (a === null) return false;
    switch (operator) {
      case "eq":
        return cell === a;
      case "lt":
        return cell < a;
      case "gt":
        return cell > a;
      case "between": {
        const b = toNumber(filter.value2);
        if (b === null) return false;
        const lo = Math.min(a, b);
        const hi = Math.max(a, b);
        return cell >= lo && cell <= hi;
      }
      default:
        return false;
    }
  }

  if (type === "date" || type === "datetime") {
    const cell = toTime(value);
    if (cell === null) return false;
    const a = toTime(filter.value);
    if (a === null) return false;
    switch (operator) {
      case "before":
        return cell < a;
      case "after":
        return cell > a;
      case "on": {
        // Match the whole calendar day (UTC), not an exact instant. Comparing
        // raw ms means a `datetime` cell (a real timestamp) never equals a
        // date-only filter value, and a `date` cell matches only by coincidence.
        // UTC day index sidesteps DST (86.4M ms/day is constant in UTC) and
        // mirrors how `date` values are parsed/formatted as UTC elsewhere.
        const MS_PER_DAY = 86_400_000;
        return Math.floor(cell / MS_PER_DAY) === Math.floor(a / MS_PER_DAY);
      }
      case "between": {
        const b = toTime(filter.value2);
        if (b === null) return false;
        const lo = Math.min(a, b);
        const hi = Math.max(a, b);
        return cell >= lo && cell <= hi;
      }
      default:
        return false;
    }
  }

  // text | email | phone — case-insensitive contains/equals over string forms.
  if (isBlank(value)) return false;
  const cell = String(value).toLowerCase();
  const needle = filter.value.trim().toLowerCase();
  switch (operator) {
    case "contains":
      return cell.includes(needle);
    case "equals":
      return cell === needle;
    default:
      return false;
  }
}

// --- Comparators -------------------------------------------------------------

/**
 * Compare two cell values for the given field type, returning a negative /
 * zero / positive number (ascending order). Blanks always sort LAST in the
 * ascending direction and are grouped together deterministically (the caller
 * negates for descending, keeping blanks grouped at the opposite end). Never
 * throws on missing/mistyped values.
 */
export function compareValues(
  a: unknown,
  b: unknown,
  type: FieldDefinition["type"],
): number {
  const aBlank = isBlank(a);
  const bBlank = isBlank(b);
  if (aBlank && bBlank) return 0;
  if (aBlank) return 1;
  if (bBlank) return -1;

  if (type === "number" || type === "currency") {
    const na = toNumber(a);
    const nb = toNumber(b);
    if (na === null && nb === null) return 0;
    if (na === null) return 1;
    if (nb === null) return -1;
    return na - nb;
  }

  if (type === "date" || type === "datetime") {
    const ta = toTime(a);
    const tb = toTime(b);
    if (ta === null && tb === null) return 0;
    if (ta === null) return 1;
    if (tb === null) return -1;
    return ta - tb;
  }

  if (type === "boolean") {
    // false (0) before true (1), deterministic.
    return Number(toBoolean(a)) - Number(toBoolean(b));
  }

  // text | email | phone — case-insensitive locale compare.
  return String(a).localeCompare(String(b), undefined, {
    sensitivity: "base",
  });
}

/**
 * Resolve a relation cell's stored value (a target id) to its display label, or
 * `null` when it does not resolve (soft-deleted / archived / still loading). Used
 * only for relation SORT (Story 3.8): the label lives in the target table and is
 * already resolved on-page by `useRelationLabels`, so sorting matches what the
 * user sees. Unresolved values sort last.
 */
export type RelationLabelResolver = (
  field: FieldDefinition,
  value: unknown,
) => string | null;

// --- The applied transform ---------------------------------------------------

/**
 * Apply active filters (ANDed) then the active single-column sort to `rows`,
 * returning a NEW array — the input is never mutated. Filters run first; the
 * survivors are STABLE-sorted (equal keys keep their incoming, `created_at`
 * order). With no sort the incoming order is preserved. Filters/sorts on a
 * field that is not a current eligible field are ignored (defensive against a
 * stale target after a table switch).
 */
export function applyFilterSort(
  rows: RecordData[],
  filters: FilterState[],
  sort: SortState,
  fields: FieldDefinition[],
  resolveRelationLabel?: RelationLabelResolver,
): RecordData[] {
  const byKey = new Map<string, FieldDefinition>();
  for (const field of eligibleFields(fields)) {
    byKey.set(field.key, field);
  }

  // Filter (AND). Skip filters whose target is no longer eligible. Relation
  // filters are handled server-side and skipped by `matchesFilter`.
  let result = rows.filter((row) =>
    filters.every((filter) => {
      const field = byKey.get(filter.field);
      if (!field) return true;
      return matchesFilter(row.data[filter.field], filter, field.type);
    }),
  );

  // Stable sort. Array.prototype.sort is stable per spec, but we index to be
  // explicit and keep the tie-break on original position regardless of engine.
  if (sort) {
    const field = byKey.get(sort.field);
    if (field) {
      const dir = sort.direction === "desc" ? -1 : 1;
      const isRelation = field.type === "relation";
      const indexed = result.map((row, index) => ({ row, index }));
      indexed.sort((x, y) => {
        // Relation sort orders by the RESOLVED display label (Story 3.8), not the
        // stored id. An unresolved/archived/loading value has no label → treated
        // as blank and grouped last, exactly like a blank scalar.
        const xVal = isRelation
          ? resolveRelationLabel?.(field, x.row.data[sort.field]) ?? null
          : x.row.data[sort.field];
        const yVal = isRelation
          ? resolveRelationLabel?.(field, y.row.data[sort.field]) ?? null
          : y.row.data[sort.field];
        const xBlank = isBlank(xVal);
        const yBlank = isBlank(yVal);
        // Blanks are grouped deterministically at the SAME (trailing) end in
        // both directions — the direction only reorders the non-blank values.
        if (xBlank && yBlank) return x.index - y.index;
        if (xBlank) return 1;
        if (yBlank) return -1;
        // Relation labels compare as locale-aware text; scalars by their type.
        const cmp = isRelation
          ? compareValues(xVal, yVal, "text")
          : compareValues(xVal, yVal, field.type);
        if (cmp !== 0) return cmp * dir;
        return x.index - y.index;
      });
      result = indexed.map((entry) => entry.row);
    }
  }

  return result;
}
