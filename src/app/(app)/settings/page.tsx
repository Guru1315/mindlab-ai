import type { Metadata } from "next";
import { SettingsView } from "@/components/settings/settings-view";

export const metadata: Metadata = { title: "Settings" };

// Settings data is loaded client-side from /api/settings; the (app) layout
// performs the server-side auth check.
export default function SettingsPage() {
  return <SettingsView />;
}
