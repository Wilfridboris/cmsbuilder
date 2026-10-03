import { formatCell, isBlankCellValue, type CellStrings } from "@/lib/format";
import type { FieldDefinition, SelectOption } from "@/types/db";

/**
 * Renders one scalar cell's display value.
 *
 * A null / blank value renders as a visually empty cell carrying only a
 * screen-reader label (`strings.empty`, e.g. "Empty" / "Vide") — the
 * Airtable / Notion / Linear pattern — never a placeholder glyph. Non-blank
 * values render the shared `formatCell` output. Pure and hook-free, so it works
 * in both Server and Client components.
 */
export function CellText({
  value,
  type,
  strings,
  className,
  options,
}: {
  value: unknown;
  type: FieldDefinition["type"];
  strings: CellStrings;
  className?: string;
  /** A `select` field's option list — forwarded to `formatCell` so the cell
   * renders the matching option's label instead of the raw stored token. */
  options?: SelectOption[];
}) {
  if (isBlankCellValue(value)) {
    return <span className="sr-only">{strings.empty}</span>;
  }
  return (
    <span className={className}>{formatCell(value, type, strings, options)}</span>
  );
}
