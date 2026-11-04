"use client";

import { useTheme } from "next-themes";
import { useEffect } from "react";

/** Applies the theme saved to the user's account on first load of a device. */
export function ThemeSync({ theme }: { theme: "system" | "light" | "dark" | null }) {
  const { setTheme } = useTheme();
  useEffect(() => {
    if (!theme) return;
    try {
      if (!localStorage.getItem("mindlab-theme-synced")) {
        setTheme(theme);
        localStorage.setItem("mindlab-theme-synced", "1");
      }
    } catch {
      // Storage unavailable (private mode); skip syncing.
    }
  }, [theme, setTheme]);
  return null;
}
