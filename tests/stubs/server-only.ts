/**
 * No-op stub for the `server-only` package in the Vitest node environment.
 *
 * `server-only` is a Next.js build-time guard that throws if a server module is
 * pulled into a client bundle — it has no runtime behavior. Unit tests run
 * server-only modules directly in node, so we alias the import to this empty
 * module (see `vitest.config.ts`). The real guard still applies in the app build.
 */
export {};
