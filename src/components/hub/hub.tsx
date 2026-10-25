import Link from "next/link";
import type { ReactNode } from "react";
import type { AreaTile, HeroView } from "@/lib/hub/view";
import { HealthBadge, TinyChart } from "./charts";
import { SafeTile, SavedTile } from "./hero-tiles";

// The home hub's hero row and area tiles (docs/design/home-hub.md): a big number and one
// small graphic each, the whole card a link to where the number comes from. The links don't
// prefetch: each target reads the person's data, and prefetching them all competed with the
// hub's own loads (speed pass, 2026-10-24).

const CARD =
  "group relative flex min-w-0 flex-col gap-2 border border-zinc-300 bg-white p-4 hover:border-emerald-700 dark:border-zinc-700 dark:bg-zinc-950 dark:hover:border-emerald-500";
const CARD_LINK =
  "text-sm font-medium text-zinc-600 after:absolute after:inset-0 hover:text-emerald-700 dark:text-zinc-400";

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
  const { safe, saved, plan } = hero;
  return (
    <section aria-label="Your money at a glance" className="flex flex-col gap-3">
      {chart}
      <div className="grid grid-cols-2 gap-3">
        {safe && <SafeTile safe={safe} />}
        <SavedTile saved={saved} planItems={planItems} plan={plan} />
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
        <Link
          prefetch={false}
          href="/home/map"
          className="text-sm font-medium text-emerald-700 hover:underline"
        >
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
              prefetch={false}
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
