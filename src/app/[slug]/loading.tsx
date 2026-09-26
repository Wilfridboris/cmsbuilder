import { Skeleton } from "@/components/ui/skeleton";

/**
 * Route-level loading UI for `/{slug}` (Story 3.1).
 *
 * The dashboard page is a dynamic server component that fetches the org, schema,
 * and records before it can render. Next streams this fallback in the meantime,
 * so the first paint is a shadcn `Skeleton` laid out in the dashboard shape
 * (header + table switcher + table rows) — never a spinner (per UX-DR loading
 * hierarchy / NFR-P3). Purely decorative, hidden from assistive tech.
 */
export default function SlugDashboardLoading() {
  return (
    <main
      className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-8 px-6 py-16"
      aria-hidden="true"
    >
      <header className="flex flex-col gap-2">
        <Skeleton className="h-9 w-64" />
        <Skeleton className="h-5 w-80" />
      </header>

      <div className="flex flex-col gap-4">
        {/* Table switcher */}
        <div className="flex gap-2 border-b border-border pb-2">
          {[0, 1, 2].map((tab) => (
            <Skeleton key={tab} className="h-9 w-28 rounded-md" />
          ))}
        </div>

        {/* Active table */}
        <div className="overflow-hidden rounded-lg border">
          <div className="flex gap-4 border-b bg-muted/40 px-4 py-3">
            {[0, 1, 2, 3].map((col) => (
              <Skeleton key={col} className="h-4 flex-1" />
            ))}
          </div>
          <div className="flex flex-col">
            {[0, 1, 2, 3, 4].map((rowIndex) => (
              <div
                key={rowIndex}
                className="flex gap-4 border-b px-4 py-4 last:border-b-0"
              >
                {[0, 1, 2, 3].map((col) => (
                  <Skeleton key={col} className="h-4 flex-1" />
                ))}
              </div>
            ))}
          </div>
        </div>
      </div>
    </main>
  );
}
