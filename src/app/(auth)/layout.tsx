import { Logo } from "@/components/brand/logo";
import { ThemeToggle } from "@/components/theme-toggle";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid min-h-screen lg:grid-cols-[1.05fr_1fr]">
      <div className="flex flex-col px-4 py-6 sm:px-10">
        <div className="flex items-center justify-between">
          <Logo />
          <ThemeToggle />
        </div>
        <div className="flex flex-1 items-center justify-center py-10">
          <div className="w-full max-w-sm">{children}</div>
        </div>
      </div>
      <div className="relative hidden overflow-hidden border-l bg-primary lg:block">
        <div className="absolute inset-0 bg-[radial-gradient(70%_50%_at_70%_20%,color-mix(in_oklch,var(--brand)_55%,transparent),transparent),radial-gradient(60%_50%_at_10%_90%,color-mix(in_oklch,var(--brand)_35%,transparent),transparent)]" />
        <div className="relative flex h-full flex-col justify-end p-12 text-primary-foreground">
          <p className="font-display text-5xl leading-tight tracking-tight text-balance">
            Every answer, traced back to its <em>source</em>.
          </p>
          <p className="mt-5 max-w-md opacity-70">
            Build notebooks from your documents, ask grounded questions, and learn faster with study tools and audio overviews.
          </p>
        </div>
      </div>
    </div>
  );
}
