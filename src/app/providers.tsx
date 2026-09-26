"use client";

import { useState, type ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

/**
 * App-wide client providers (Story 3.2) — the TanStack Query seam deferred from
 * Story 3.1.
 *
 * The `QueryClient` is held in `useState` so it is created ONCE per browser
 * session and stays stable across re-renders (a fresh client on every render
 * would drop the cache and defeat optimistic writes). Rendered inside
 * `NextIntlClientProvider` in the root layout so query-driven components still
 * see translations.
 */
export function Providers({ children }: { children: ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            // Records are seeded from server `initialData`; avoid a redundant
            // refetch on mount (NFR-P3 fast first paint). Invalidations after
            // a mutation still trigger the authoritative refetch.
            refetchOnWindowFocus: false,
          },
        },
      }),
  );

  return (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}
