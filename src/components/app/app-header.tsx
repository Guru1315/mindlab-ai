import { Logo } from "@/components/brand/logo";
import type { Profile } from "@/lib/types";
import { UserMenu } from "./user-menu";
import { HeaderSlot } from "./header-slot";

export function AppHeader({ profile }: { profile: Profile }) {
  return (
    <header className="sticky top-0 z-30 flex h-14 shrink-0 items-center gap-3 border-b bg-background/80 px-3 backdrop-blur-xl sm:px-5">
      <Logo href="/dashboard" className="shrink-0" />
      <HeaderSlot />
      <div className="ml-auto flex items-center gap-2">
        <UserMenu profile={profile} />
      </div>
    </header>
  );
}
