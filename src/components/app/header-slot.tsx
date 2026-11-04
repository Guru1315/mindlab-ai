"use client";

import type { ReactNode } from "react";
import { createPortal } from "react-dom";
import { useClientValue } from "@/hooks/use-hydrated";

/**
 * Lets a page (e.g. the notebook workspace) render its title and actions into
 * the shared app header without the layout knowing about the page.
 */
const SLOT_ID = "app-header-slot";

export function HeaderSlot() {
  return <div id={SLOT_ID} className="flex min-w-0 flex-1 items-center gap-2" />;
}

export function HeaderPortal({ children }: { children: ReactNode }) {
  const target = useClientValue(() => document.getElementById(SLOT_ID));
  return target ? createPortal(children, target) : null;
}
