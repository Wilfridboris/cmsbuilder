import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";
import { loadEnv } from "vite";
import react from "@vitejs/plugin-react";

// Load `.env`, `.env.test`, and `.env.test.local` (git-ignored) into
// `process.env` so the RLS isolation test can read SUPABASE_TEST_* locally.
// The `""` prefix loads all keys (not just VITE_-prefixed ones). In CI the same
// vars are provided by the workflow `env:` block, not a file.
const testEnv: Record<string, string> = loadEnv("test", process.cwd(), "");
for (const key of Object.keys(testEnv)) {
  if (process.env[key] === undefined) {
    process.env[key] = testEnv[key];
  }
}

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "node",
    globals: true,
    // `.test.ts(x)` = unit/integration (run here). `.spec.ts(x)` is reserved
    // for e2e (Playwright, a later story) and is excluded from the Vitest run.
    include: ["tests/**/*.test.{ts,tsx}"],
    exclude: ["tests/e2e/**", "node_modules/**"],
  },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      // `server-only` is a build-time guard with no runtime export; stub it so
      // server-only modules (gemini client/prompts, validator) can be unit-tested
      // in the node env without pulling in the Next.js bundler boundary.
      "server-only": fileURLToPath(
        new URL("./tests/stubs/server-only.ts", import.meta.url),
      ),
    },
  },
});
