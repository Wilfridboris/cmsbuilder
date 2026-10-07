import "server-only";

import { strToU8, zipSync } from "fflate";

/**
 * Thin ZIP encoder for the "Download My Data" bundle (Story 8.4). Wraps fflate's
 * synchronous `zipSync` so the route can hand it a flat list of text files
 * (`export.json` at the archive root plus one `tables/<key>.csv` per table) and
 * receive the archive bytes. Pure/server-safe: no I/O, no framework.
 *
 * fflate takes a `{ path: Uint8Array }` map, so each file's text is encoded to
 * UTF-8 bytes via `strToU8`. `level: 6` is fflate's balanced default.
 */
export function zipBundle(files: Array<{ name: string; content: string }>): Uint8Array {
  const entries: Record<string, Uint8Array> = {};
  for (const file of files) {
    entries[file.name] = strToU8(file.content);
  }
  return zipSync(entries, { level: 6 });
}
