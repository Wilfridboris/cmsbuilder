import { useSyncExternalStore } from "react";

/** No-op subscribe: mount state never changes after hydration. */
const noopSubscribe = () => () => {};

/** True only after client hydration — gates browser-only affordances (e.g. Web Share). */
export function useIsClient(): boolean {
  return useSyncExternalStore(
    noopSubscribe,
    () => true,
    () => false,
  );
}
