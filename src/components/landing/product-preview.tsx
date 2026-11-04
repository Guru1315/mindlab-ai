import { BookOpenText, FileText, Globe, Headphones, Layers, ListChecks, Network, Play, Sparkles } from "lucide-react";

/**
 * Original illustration of the MindLab workspace for the landing page.
 * Purely presentational (no data is loaded); it mirrors the real three-panel layout.
 */
export function ProductPreview() {
  return (
    <div className="relative mx-auto w-full max-w-5xl">
      <div className="absolute -inset-x-10 -top-10 -bottom-6 -z-10 rounded-[2.5rem] bg-[radial-gradient(60%_60%_at_50%_30%,color-mix(in_oklch,var(--brand)_22%,transparent),transparent)] blur-2xl" />
      <div className="overflow-hidden rounded-2xl border bg-card shadow-[0_30px_80px_-30px_color-mix(in_oklch,var(--brand)_45%,transparent)]">
        <div className="flex items-center gap-1.5 border-b bg-muted/50 px-4 py-2.5">
          <span className="size-2.5 rounded-full bg-foreground/15" />
          <span className="size-2.5 rounded-full bg-foreground/15" />
          <span className="size-2.5 rounded-full bg-foreground/15" />
          <span className="ml-3 text-xs text-muted-foreground">Climate policy research</span>
        </div>
        <div className="grid grid-cols-1 text-left sm:grid-cols-[0.9fr_1.6fr_1fr]">
          <div className="hidden border-r p-4 sm:block">
            <p className="mb-3 text-xs font-medium tracking-wide text-muted-foreground uppercase">Sources</p>
            {[
              { icon: FileText, t: "IPCC synthesis report.pdf", tone: "text-rose-500" },
              { icon: FileText, t: "Carbon pricing primer.docx", tone: "text-sky-500" },
              { icon: Globe, t: "Ocean heat content explainer", tone: "text-emerald-500" },
              { icon: BookOpenText, t: "Lecture notes (week 4)", tone: "text-amber-500" },
            ].map(({ icon: Icon, t, tone }) => (
              <div key={t} className="mb-2 flex items-center gap-2 rounded-lg border bg-background px-2.5 py-2 text-xs">
                <span className="grid size-4 place-items-center rounded-[4px] border border-brand bg-brand text-[9px] text-brand-foreground">✓</span>
                <Icon className={`size-3.5 shrink-0 ${tone}`} />
                <span className="truncate">{t}</span>
              </div>
            ))}
          </div>
          <div className="border-r p-4 sm:p-5">
            <div className="mb-3 ml-auto w-fit max-w-[85%] rounded-2xl rounded-br-md bg-primary px-3.5 py-2 text-xs text-primary-foreground">
              How do carbon taxes compare with cap-and-trade?
            </div>
            <div className="space-y-2 text-xs leading-relaxed text-foreground/90">
              <p>
                Both put a price on emissions, but they fix different variables: a carbon tax sets the <strong>price</strong>
                <Cite n={1} /> while cap-and-trade sets the <strong>quantity</strong> of allowed emissions
                <Cite n={2} />.
              </p>
              <p>
                The primer notes that tax revenue is more predictable, whereas trading systems give certainty about the
                emissions outcome <Cite n={2} />
                <Cite n={3} />.
              </p>
            </div>
            <div className="mt-4 flex flex-wrap gap-1.5">
              {["What price levels are discussed?", "Which sectors are covered?"].map((q) => (
                <span key={q} className="rounded-full border bg-background px-2.5 py-1 text-[11px] text-muted-foreground">
                  {q}
                </span>
              ))}
            </div>
          </div>
          <div className="hidden p-4 sm:block">
            <p className="mb-3 text-xs font-medium tracking-wide text-muted-foreground uppercase">Studio</p>
            <div className="mb-3 rounded-xl border bg-brand-soft/60 p-3">
              <div className="flex items-center gap-2 text-xs font-medium">
                <Headphones className="size-3.5 text-brand" /> Audio overview
              </div>
              <div className="mt-2.5 flex items-center gap-2">
                <span className="grid size-6 place-items-center rounded-full bg-brand text-brand-foreground">
                  <Play className="size-3 fill-current" />
                </span>
                <div className="flex h-5 flex-1 items-end gap-[2px]">
                  {[3, 6, 4, 8, 5, 9, 6, 4, 7, 5, 8, 3, 6, 4, 7, 5].map((h, i) => (
                    <span key={i} className="flex-1 rounded-full bg-brand/60" style={{ height: `${h * 10}%` }} />
                  ))}
                </div>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              {[
                { icon: BookOpenText, t: "Study guide" },
                { icon: Layers, t: "Flashcards" },
                { icon: ListChecks, t: "Quiz" },
                { icon: Network, t: "Mind map" },
              ].map(({ icon: Icon, t }) => (
                <div key={t} className="flex items-center gap-1.5 rounded-lg border bg-background px-2 py-2 text-[11px]">
                  <Icon className="size-3.5 text-brand" /> {t}
                </div>
              ))}
            </div>
            <div className="mt-3 flex items-center gap-1.5 text-[11px] text-muted-foreground">
              <Sparkles className="size-3" /> Grounded in 4 sources
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function Cite({ n }: { n: number }) {
  return (
    <span className="mx-0.5 inline-grid size-4 place-items-center rounded-full bg-brand-soft align-[1px] text-[9px] font-semibold text-brand">
      {n}
    </span>
  );
}
