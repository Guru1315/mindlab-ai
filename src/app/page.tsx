import {
  ArrowRight,
  BookOpenText,
  Check,
  FileUp,
  Headphones,
  Layers,
  Lock,
  MessageSquareQuote,
  Network,
  Quote,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import Link from "next/link";
import { Logo } from "@/components/brand/logo";
import { ProductPreview } from "@/components/landing/product-preview";
import { LandingFaq } from "@/components/landing/faq";
import { FadeIn, HeroIn } from "@/components/motion";
import { ThemeToggle } from "@/components/theme-toggle";
import { Button } from "@/components/ui/button";

const FEATURES = [
  {
    icon: MessageSquareQuote,
    title: "Answers with receipts",
    body: "Every answer cites the exact passages it came from. Click a citation to jump to the highlighted text in the original source.",
  },
  {
    icon: FileUp,
    title: "Bring any source",
    body: "PDFs, Word documents, Markdown, plain text, web pages or pasted notes — processed into searchable knowledge in seconds.",
  },
  {
    icon: Headphones,
    title: "Audio overviews",
    body: "Turn your sources into a two-host podcast, a quick brief, a debate or a critique. Listen, scrub and download.",
  },
  {
    icon: BookOpenText,
    title: "Study guides & briefings",
    body: "Generate study guides, FAQs, briefing docs, timelines and key-concept sheets — then edit and export them.",
  },
  {
    icon: Layers,
    title: "Flashcards & quizzes",
    body: "Practice with flip cards and multiple-choice quizzes built from your material, with explanations for every answer.",
  },
  {
    icon: Network,
    title: "Mind maps",
    body: "See how ideas connect with an expandable map of topics and subtopics across all of your sources.",
  },
];

const STEPS = [
  { n: "01", title: "Create a notebook", body: "One notebook per project, course or question you're exploring." },
  { n: "02", title: "Add your sources", body: "Upload files, paste links or text. MindLab extracts, chunks and indexes them." },
  { n: "03", title: "Ask, learn, create", body: "Chat with citations, then generate study material and audio from the same sources." },
];

const PLANS = [
  {
    name: "Free",
    price: "$0",
    note: "For personal research",
    features: ["Up to 50 sources per notebook", "Cited chat across your sources", "All Studio tools", "10 audio overviews per day"],
    cta: "Start for free",
    featured: false,
  },
  {
    name: "Pro",
    price: "$12",
    note: "per month · coming soon",
    features: ["Higher usage limits", "Longer audio overviews", "Priority processing", "Everything in Free"],
    cta: "Start free today",
    featured: true,
  },
  {
    name: "Team",
    price: "Custom",
    note: "coming soon",
    features: ["Shared workspaces", "Admin controls", "SSO", "Everything in Pro"],
    cta: "Start free today",
    featured: false,
  },
];

export default function LandingPage() {
  return (
    <div className="relative min-h-screen overflow-x-clip">
      <header className="sticky top-0 z-40 border-b border-transparent bg-background/75 backdrop-blur-xl supports-[backdrop-filter]:bg-background/60">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4 sm:px-6">
          <Logo />
          <nav className="hidden items-center gap-7 text-sm text-muted-foreground md:flex">
            <a href="#features" className="hover:text-foreground">Features</a>
            <a href="#how" className="hover:text-foreground">How it works</a>
            <a href="#pricing" className="hover:text-foreground">Pricing</a>
            <a href="#faq" className="hover:text-foreground">FAQ</a>
          </nav>
          <div className="flex items-center gap-1.5">
            <ThemeToggle />
            <Button asChild variant="ghost" className="hidden sm:inline-flex">
              <Link href="/login">Log in</Link>
            </Button>
            <Button asChild>
              <Link href="/signup">Get started</Link>
            </Button>
          </div>
        </div>
      </header>

      <main>
        <section className="relative px-4 pt-16 pb-20 sm:px-6 sm:pt-24">
          <div className="pointer-events-none absolute inset-0 -z-10 bg-[linear-gradient(to_bottom,transparent,var(--background)),repeating-linear-gradient(90deg,color-mix(in_oklch,var(--foreground)_5%,transparent)_0_1px,transparent_1px_72px)]" />
          <div className="mx-auto max-w-4xl text-center">
            <HeroIn>
              <span className="inline-flex items-center gap-2 rounded-full border bg-card px-3 py-1 text-xs text-muted-foreground shadow-sm">
                <Sparkles className="size-3.5 text-brand" /> Source-grounded AI for research and study
              </span>
            </HeroIn>
            <HeroIn delay={0.05}>
              <h1 className="mt-6 font-display text-5xl leading-[1.02] tracking-tight text-balance sm:text-7xl">
                Think deeper with <em className="text-brand">your own</em> sources.
              </h1>
            </HeroIn>
            <HeroIn delay={0.1}>
              <p className="mx-auto mt-6 max-w-2xl text-lg text-pretty text-muted-foreground">
                MindLab reads your documents, answers questions with clickable citations, and turns everything into
                study guides, quizzes, mind maps and podcast-style audio overviews.
              </p>
            </HeroIn>
            <HeroIn delay={0.15} className="mt-9 flex flex-col items-center justify-center gap-3 sm:flex-row">
              <Button asChild size="lg" className="h-11 px-5 text-[0.95rem]">
                <Link href="/signup">
                  Create your first notebook <ArrowRight />
                </Link>
              </Button>
              <Button asChild size="lg" variant="outline" className="h-11 px-5 text-[0.95rem]">
                <a href="#how">See how it works</a>
              </Button>
            </HeroIn>
          </div>
          <HeroIn delay={0.2} className="mt-16">
            <ProductPreview />
          </HeroIn>
        </section>

        <section id="features" className="scroll-mt-20 px-4 py-20 sm:px-6">
          <div className="mx-auto max-w-6xl">
            <FadeIn className="max-w-2xl">
              <p className="text-sm font-medium text-brand">Features</p>
              <h2 className="mt-2 font-display text-4xl tracking-tight sm:text-5xl">A research partner that shows its work.</h2>
            </FadeIn>
            <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {FEATURES.map((f, i) => (
                <FadeIn key={f.title} delay={i * 0.04}>
                  <div className="group h-full rounded-2xl border bg-card p-6 transition-shadow hover:shadow-lg hover:shadow-brand/5">
                    <span className="grid size-10 place-items-center rounded-xl bg-brand-soft text-brand transition-transform group-hover:-translate-y-0.5">
                      <f.icon className="size-5" />
                    </span>
                    <h3 className="mt-5 font-semibold">{f.title}</h3>
                    <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{f.body}</p>
                  </div>
                </FadeIn>
              ))}
            </div>
          </div>
        </section>

        <section id="how" className="scroll-mt-20 border-y bg-card/60 px-4 py-20 sm:px-6">
          <div className="mx-auto grid max-w-6xl gap-12 lg:grid-cols-[1fr_1.2fr] lg:items-center">
            <FadeIn>
              <p className="text-sm font-medium text-brand">How it works</p>
              <h2 className="mt-2 font-display text-4xl tracking-tight sm:text-5xl">From a pile of documents to understanding.</h2>
              <p className="mt-4 text-muted-foreground">
                MindLab splits each source into passages, embeds them for semantic search, and retrieves only the most
                relevant passages from the notebook you&apos;re in. The AI is instructed to answer from those passages —
                and to tell you when they don&apos;t contain the answer.
              </p>
              <ul className="mt-6 space-y-2.5 text-sm">
                {["Notebook-level isolation: answers never mix projects", "Citations are validated against retrieved text", "Uploaded content is treated as data, never as instructions"].map((t) => (
                  <li key={t} className="flex items-start gap-2.5">
                    <ShieldCheck className="mt-0.5 size-4 shrink-0 text-success" /> {t}
                  </li>
                ))}
              </ul>
            </FadeIn>
            <div className="grid gap-4">
              {STEPS.map((s, i) => (
                <FadeIn key={s.n} delay={i * 0.06}>
                  <div className="flex gap-5 rounded-2xl border bg-background p-5">
                    <span className="font-display text-3xl text-brand">{s.n}</span>
                    <div>
                      <h3 className="font-semibold">{s.title}</h3>
                      <p className="mt-1 text-sm text-muted-foreground">{s.body}</p>
                    </div>
                  </div>
                </FadeIn>
              ))}
            </div>
          </div>
        </section>

        <section className="px-4 py-20 sm:px-6">
          <FadeIn className="mx-auto max-w-3xl text-center">
            <Quote className="mx-auto size-8 text-brand/60" />
            <p className="mt-5 font-display text-3xl leading-snug tracking-tight text-balance sm:text-4xl">
              “The best research tools don&apos;t just give answers — they show you exactly where each answer comes from.”
            </p>
            <p className="mt-4 text-sm text-muted-foreground">The principle MindLab is built on</p>
          </FadeIn>
        </section>

        <section id="pricing" className="scroll-mt-20 px-4 py-20 sm:px-6">
          <div className="mx-auto max-w-6xl">
            <FadeIn className="text-center">
              <p className="text-sm font-medium text-brand">Pricing</p>
              <h2 className="mt-2 font-display text-4xl tracking-tight sm:text-5xl">Start free. Grow when you need to.</h2>
            </FadeIn>
            <div className="mt-12 grid gap-4 lg:grid-cols-3">
              {PLANS.map((p, i) => (
                <FadeIn key={p.name} delay={i * 0.05}>
                  <div className={`relative flex h-full flex-col rounded-2xl border p-6 ${p.featured ? "border-brand/50 bg-card shadow-xl shadow-brand/10" : "bg-card/60"}`}>
                    {p.featured && <span className="absolute -top-3 left-6 rounded-full bg-brand px-2.5 py-0.5 text-xs font-medium text-brand-foreground">Most popular</span>}
                    <h3 className="font-semibold">{p.name}</h3>
                    <p className="mt-3">
                      <span className="font-display text-5xl tracking-tight">{p.price}</span>
                      <span className="ml-2 text-sm text-muted-foreground">{p.note}</span>
                    </p>
                    <ul className="mt-6 flex-1 space-y-2.5 text-sm">
                      {p.features.map((f) => (
                        <li key={f} className="flex gap-2">
                          <Check className="mt-0.5 size-4 shrink-0 text-brand" /> {f}
                        </li>
                      ))}
                    </ul>
                    <Button asChild className="mt-8" variant={p.featured ? "default" : "outline"}>
                      <Link href="/signup">{p.cta}</Link>
                    </Button>
                  </div>
                </FadeIn>
              ))}
            </div>
            <p className="mt-6 text-center text-xs text-muted-foreground">
              Paid plans are not yet available; every account currently gets the Free plan.
            </p>
          </div>
        </section>

        <section id="faq" className="scroll-mt-20 border-t bg-card/60 px-4 py-20 sm:px-6">
          <div className="mx-auto max-w-3xl">
            <FadeIn className="text-center">
              <h2 className="font-display text-4xl tracking-tight sm:text-5xl">Questions, answered.</h2>
            </FadeIn>
            <LandingFaq />
          </div>
        </section>

        <section className="px-4 py-24 sm:px-6">
          <FadeIn className="mx-auto max-w-4xl overflow-hidden rounded-3xl border bg-primary px-6 py-14 text-center text-primary-foreground sm:px-12">
            <Lock className="mx-auto size-6 opacity-70" />
            <h2 className="mt-4 font-display text-4xl tracking-tight sm:text-5xl">Your sources stay yours.</h2>
            <p className="mx-auto mt-4 max-w-xl opacity-75">
              Private storage, per-user access control on every row, and no mixing between notebooks.
            </p>
            <Button asChild size="lg" variant="secondary" className="mt-8 h-11 px-5">
              <Link href="/signup">
                Get started — it&apos;s free <ArrowRight />
              </Link>
            </Button>
          </FadeIn>
        </section>
      </main>

      <footer className="border-t px-4 py-10 sm:px-6">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 text-sm text-muted-foreground sm:flex-row">
          <Logo />
          <p>© {new Date().getFullYear()} MindLab AI. An independent project.</p>
          <div className="flex gap-5">
            <Link href="/login" className="hover:text-foreground">Log in</Link>
            <Link href="/signup" className="hover:text-foreground">Sign up</Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
