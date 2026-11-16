import Link from "next/link";
import { TAX_TAG_ORDER, TAX_TAGS } from "@/config/tax";
import type { TaxTagsView } from "@/lib/tax-organizer";
import { formatCents } from "@/lib/money";

// Tagged for the year on /taxes: the tags that hold something, with their totals. With nothing
// tagged yet, no list of $0.00 (debug 2, 11-15: a student saw seven tags, every one $0.00); the
// tree's summary above says so.

const CARD = "flex flex-col gap-3 border border-zinc-200 p-4 dark:border-zinc-800";
const LINK = "font-medium underline underline-offset-2 hover:no-underline";

export function TagsSection({ tags, year }: { tags: TaxTagsView; year: number }) {
  const held = TAX_TAG_ORDER.filter((tag) => tags.totals[tag].count > 0);
  return (
    <section aria-labelledby="organised" className={CARD}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="organised" className="text-xl font-semibold">
          Tagged for {year}
        </h2>
        <Link href="/taxes/tags" className={LINK}>
          See and change tags
        </Link>
      </div>
      {held.length > 0 && (
        <dl className="grid grid-cols-1 gap-x-4 gap-y-1 text-sm sm:grid-cols-2">
          {held.map((tag) => (
            <div key={tag} className="flex justify-between gap-2">
              <dt className="text-zinc-600 dark:text-zinc-400">{TAX_TAGS[tag].label}</dt>
              <dd className="whitespace-nowrap">{formatCents(tags.totals[tag].totalCents)}</dd>
            </div>
          ))}
        </dl>
      )}
      {tags.checks.length > 0 && (
        <p className="text-sm font-medium">
          Jane isn&apos;t sure about {tags.checks.length}{" "}
          {tags.checks.length === 1 ? "merchant" : "merchants"}.{" "}
          <Link href="/taxes/tags#checks" className={LINK}>
            Check them
          </Link>
        </p>
      )}
    </section>
  );
}
