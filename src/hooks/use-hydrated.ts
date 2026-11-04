"use client";

import { useSyncExternalStore } from "react";

const subscribe = () => () => {};

/** False during SSR and hydration, true afterwards — without a setState-in-effect. */
export function useHydrated(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );
}

/** Reads a client-only value after hydration (null on the server). */
export function useClientValue<T>(read: () => T): T | null {
  return useSyncExternalStore(subscribe, read, () => null);
}
