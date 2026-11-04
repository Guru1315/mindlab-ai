import Link from "next/link";
import { cn } from "@/lib/utils";

export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" aria-hidden="true" className={cn("size-7", className)}>
      <defs>
        <linearGradient id="ml-grad" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="oklch(0.62 0.2 285)" />
          <stop offset="1" stopColor="oklch(0.48 0.2 265)" />
        </linearGradient>
      </defs>
      <rect width="32" height="32" rx="9" fill="url(#ml-grad)" />
      <path d="M9 22V11.5c0-.8.9-1.3 1.6-.8L16 14.6l5.4-3.9c.7-.5 1.6 0 1.6.8V22" fill="none" stroke="white" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="16" cy="21.5" r="1.7" fill="white" />
    </svg>
  );
}

export function Logo({ href = "/", className }: { href?: string; className?: string }) {
  return (
    <Link href={href} className={cn("flex items-center gap-2 font-semibold tracking-tight", className)}>
      <LogoMark />
      <span className="text-[1.05rem]">
        MindLab <span className="text-brand">AI</span>
      </span>
    </Link>
  );
}
