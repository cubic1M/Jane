import Link from "next/link";
import { dayLabel } from "@/lib/day-label";
import type { HomeTaxesView } from "@/lib/home-taxes";
import { formatCents } from "@/lib/money";
import { figuresOf, type Source } from "@/planning/home-taxes";

// Homeowner taxes on /taxes (spec step 170): each figure with links to where it came from,
// and the state and local tax cap applied.

const CARD = "flex flex-col gap-3 rounded-xl border border-zinc-200 p-4 dark:border-zinc-800";
const LINK = "underline underline-offset-2";

function SourceLink({ s }: { s: Source }) {
  switch (s.kind) {
    case "transaction":
      return (
        <Link href={`/transactions?q=${encodeURIComponent(s.payee)}`} className={LINK}>
          {s.payee}, {dayLabel(s.date, { year: true })}, {formatCents(s.cents)}
        </Link>
      );
    case "loan":
      return (
        <Link href="/loans" className={LINK}>
          {s.name} (lender&apos;s figure)
        </Link>
      );
    case "document":
      return (
        <Link href="/taxes?focus=records:forms" className={LINK}>
          {s.form} from {s.from}
        </Link>
      );
    case "answer":
      return (
        <Link href="/taxes/profile#home" className={LINK}>
          {s.label}
        </Link>
      );
  }
}

export function HomeSection({ view }: { view: HomeTaxesView }) {
  if (!view.homeowner) return null;
  const salt = view.salt;
  return (
    <section aria-labelledby="home-heading" id="home" className={CARD}>
      <h2 id="home-heading" className="text-xl font-semibold">
        Your home
      </h2>
      <ul className="flex flex-col gap-2 text-sm">
        {figuresOf(view).map((f) => (
          <li key={f.label} className="flex flex-col gap-1">
            <span className="flex flex-wrap justify-between gap-x-3">
              <span className="font-medium">{f.label}</span>
              <span className="whitespace-nowrap">{formatCents(f.cents)}</span>
            </span>
            <span className="text-zinc-600 dark:text-zinc-400">
              From{" "}
              {f.sources.map((s, i) => (
                <span key={i}>
                  {i > 0 && "; "}
                  <SourceLink s={s} />
                </span>
              ))}
              {f.note ? `. ${f.note}` : ""}
            </span>
          </li>
        ))}
      </ul>
      <p className="text-sm">
        State and local taxes: {formatCents(salt.totalCents)}. Up to {formatCents(salt.capCents)}{" "}
        counts if you itemize (the cap), so {formatCents(salt.allowedCents)} does
        {salt.overCents > 0 ? ` and ${formatCents(salt.overCents)} doesn't` : ""}.
      </p>
      {view.sale && (
        <p className="text-sm">
          Home sale: a gain of about {formatCents(Math.max(0, view.sale.gainCents))};{" "}
          {view.sale.qualifies
            ? `${formatCents(view.sale.exclusionCents)} of gain can be tax-free, so about ${formatCents(view.sale.taxableGainCents)} is taxed.`
            : `it doesn't qualify for the exclusion: ${view.sale.why.join(" ")}`}
        </p>
      )}
    </section>
  );
}
