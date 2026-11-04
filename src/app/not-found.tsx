import Link from "next/link";
import { Logo } from "@/components/brand/logo";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center px-4 text-center">
      <Logo />
      <p className="mt-10 font-display text-7xl tracking-tight">404</p>
      <h1 className="mt-2 text-lg font-semibold">This page doesn&apos;t exist</h1>
      <p className="mt-1 max-w-sm text-sm text-muted-foreground">The notebook or link may have been deleted, or you may not have access to it.</p>
      <Button asChild className="mt-6">
        <Link href="/dashboard">Go to your notebooks</Link>
      </Button>
    </div>
  );
}
