import Link from "next/link";
import type { ReactNode } from "react";
import { formatCents } from "@/lib/money";
import type { AreaTile, HeroView } from "@/lib/hub/view";
import { HealthBadge, Meter, StackBar, TinyChart } from "./charts";

// The home hub's hero row and area tiles (docs/design/home-hub.md): a big number and one
// small graphic each, the whole card a link to where the number comes from.

const CARD =
  "group relative flex min-w-0 flex-col gap-2 border border-zinc-300 bg-white p-4 hover:border-emerald-700 dark:border-zinc-700 dark:bg-zinc-950 dark:hover:border-emerald-500";
const CARD_LINK =
  "text-sm font-medium text-zinc-600 after:absolute after:inset-0 hover:text-emerald-700 dark:text-zinc-400";

const dollars = (cents: number) => formatCents(cents).replace(/\.\d\d$/, "");
// The hero: the net worth chart on top, the biggest thing on Home (the founder's "graph like
// Robinhood"), then safe to spend and money found side by side, smaller.
export function HeroRow({
  hero,
  planItems,
  chart,
}: {
  hero: HeroView;
  planItems: number;
  chart: ReactNode;
}) {
  const { safe, saved } = hero;
  return (
    <section aria-label="Your money at a glance" className="flex flex-col gap-3">
      {chart}
      <div className="grid grid-cols-2 gap-3">
        {safe && (
          <div className={`${CARD} col-span-2 sm:col-span-1`}>
            <Link href="/figures/safe_to_spend" className={CARD_LINK}>
              {safe.label}
            </Link>
            <p
              data-hub-number="safe"
              className={`text-2xl font-semibold tracking-tight tabular-nums ${safe.short ? "text-red-700" : ""}`}
            >
              {safe.short ? `Short ${dollars(safe.cents)}` : dollars(safe.cents)}
            </p>
            <StackBar
              parts={safe.parts}
              emphasis="safe"
              label={safe.parts.map((p) => `${p.label} ${Math.round(p.share * 100)}%`).join(", ")}
            />
            <p aria-hidden className="flex flex-wrap gap-x-3 text-xs text-zinc-500">
              {safe.parts.map((p) => (
                <span key={p.key}>
                  <span className={p.key === "safe" ? "text-emerald-700" : ""}>■</span> {p.label}
                </span>
              ))}
            </p>
          </div>
        )}
        <div className={CARD}>
          {/* Each figure links to the page that shows it: what was found is the report's total
            (hub QA: it linked to /plan, whose total counts more). */}
          <Link href={saved.label === "Saved so far" ? "/saved" : "/report"} className={CARD_LINK}>
            {saved.label}
          </Link>
          <p
            data-hub-number="saved"
            className="text-2xl font-semibold tracking-tight tabular-nums"
          >
            {saved.label === "Money found" && saved.cents === 0 && planItems > 0 ? (
              // As the report says it when nothing has a sure dollar figure yet.
              `${planItems} to look at`
            ) : (
              <>
                {dollars(saved.cents)}
                <span className="text-base font-normal text-zinc-500">/yr</span>
              </>
            )}
          </p>
          {/* What was said yes to, at its expected yearly value (one meaning of "saved", #587). */}
          {saved.label === "Saved so far" && <p className="text-xs text-zinc-500">Expected</p>}
          {saved.label === "Saved so far" && (
            <Meter
              share={saved.share}
              label={`${Math.round(saved.share * 100)}% of what Jane found`}
            />
          )}
          {planItems > 0 && (
            <Link
              href="/plan"
              className="relative z-10 self-start text-sm font-medium text-emerald-700 hover:underline"
            >
              {/* The plan's items, as the chat says them ("Your plan for this week is ready: 12
                things"); "ideas" are the tiles' suggestions, a different count (phone walk). */}
              Your plan: {planItems} {planItems === 1 ? "thing" : "things"} ›
            </Link>
          )}
        </div>
      </div>
    </section>
  );
}

export function AreaTiles({ tiles }: { tiles: AreaTile[] }) {
  return (
    <section aria-labelledby="areas-heading" className="flex flex-col gap-2">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3">
        <h2 id="areas-heading" className="text-base font-semibold">
          Your areas
        </h2>
        <Link href="/home/map" className="text-sm font-medium text-emerald-700 hover:underline">
          What Jane does ›
        </Link>
      </div>
      <ul className="grid grid-cols-2 gap-3 md:grid-cols-3">
        {tiles.map((tile, i) => (
          <li
            key={tile.key}
            data-area={tile.key}
            className={`${CARD} hub-pop`}
            style={{ animationDelay: `${i * 40}ms` }}
          >
            <Link
              href={tile.href}
              className={`${CARD_LINK} font-semibold text-zinc-900 dark:text-zinc-100`}
            >
              {tile.label}
            </Link>
            <HealthBadge health={tile.health} why={tile.healthWhy} />
            {tile.value !== null && (
              <p className="text-2xl font-semibold tracking-tight tabular-nums">{tile.value}</p>
            )}
            <p className="text-xs text-zinc-600 dark:text-zinc-400">{tile.caption}</p>
            <div className="mt-auto pt-1">
              <TinyChart chart={tile.chart} />
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function AreaTilesLoading() {
  return (
    <section
      aria-label="Your areas"
      aria-busy="true"
      className="grid grid-cols-2 gap-3 md:grid-cols-3"
    >
      {Array.from({ length: 6 }, (_, i) => (
        <div key={i} className="h-40 animate-pulse border border-zinc-200 dark:border-zinc-800" />
      ))}
    </section>
  );
}
