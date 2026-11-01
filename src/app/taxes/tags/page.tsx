import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { AppHeader, PageLoading } from "@/components/app-header";
import { TAX_TAG_ORDER, TAX_TAGS, TAX_TAG_SEARCH_LIMIT } from "@/config/tax";
import { formatCents } from "@/lib/money";
import { requireUser } from "@/lib/session";
import { todayOf } from "@/lib/today";
import { loadTaxTags, searchToTag } from "@/lib/tax-organizer";
import { taxYearFrom } from "@/planning/tax-pack";
import type { TagSource } from "@/planning/tax-tags";
import { CheckButtons, TagForm } from "./tag-form";
import { dayLabel } from "@/lib/day-label";
import { EmptyState } from "@/components/empty-state";

// Tax tags (spec step 119): what Jane tagged for the year, the ones it's unsure about,
// and a search to tag anything else (a work expense). Tags never change spending.

const CARD = "flex flex-col gap-3 rounded-xl border border-zinc-200 p-4 dark:border-zinc-800";
const LINK = "font-medium text-emerald-700 hover:underline";
const SOURCE: Readonly<Record<TagSource, string>> = {
  yours: "Tagged by you",
  jane: "Tagged by Jane",
  check: "Tagged by Jane: check it",
};

async function TagsContent({
  searchParams,
}: {
  searchParams: PageProps<"/taxes/tags">["searchParams"];
}) {
  const user = await requireUser();
  await connection();
  const params = await searchParams;
  const today = await todayOf(user.id);
  const year = taxYearFrom(typeof params.year === "string" ? params.year : undefined, today);
  const q = typeof params.q === "string" ? params.q : "";
  const [view, found] = await Promise.all([
    loadTaxTags(user.id, year),
    searchToTag(user.id, year, q, { limit: TAX_TAG_SEARCH_LIMIT }),
  ]);

  return (
    <>
      <AppHeader user={user} />
      <div className="flex flex-col gap-2">
        <h1 className="text-3xl font-semibold tracking-tight">Tax tags: {year}</h1>
        <p className="text-zinc-600 dark:text-zinc-400">
          Jane tags donations, medical, childcare and education spending as it comes in. You can
          change any tag, or tag something yourself. Tags never change your spending categories or
          totals; your{" "}
          <Link href={`/tax-pack?year=${year}`} className={LINK}>
            tax-time pack
          </Link>{" "}
          follows them.
        </p>
      </div>

      <section aria-labelledby="totals" className={CARD}>
        <h2 id="totals" className="text-xl font-semibold">
          This year so far
        </h2>
        {/* Nothing tagged yet: a line and the way to tag one, not a list of $0.00 (0). */}
        {TAX_TAG_ORDER.every((tag) => view.totals[tag].count === 0) ? (
          <EmptyState
            words={`Nothing tagged in ${year} yet. Jane tags donations, medical, childcare and education spending as it comes in.`}
            next={{ href: `/taxes/tags?year=${year}#search`, label: "Tag a charge yourself" }}
          />
        ) : (
          <dl className="grid grid-cols-1 gap-x-4 gap-y-1 text-sm sm:grid-cols-2">
            {TAX_TAG_ORDER.map((tag) => (
              <div key={tag} className="flex justify-between gap-2">
                <dt className="text-zinc-600 dark:text-zinc-400">{TAX_TAGS[tag].label}</dt>
                <dd className="whitespace-nowrap">
                  {formatCents(view.totals[tag].totalCents)} ({view.totals[tag].count})
                </dd>
              </div>
            ))}
          </dl>
        )}
      </section>

      {view.checks.length > 0 && (
        <section aria-labelledby="checks" className={CARD}>
          <h2 id="checks" className="text-xl font-semibold">
            Is Jane right about these?
          </h2>
          <ul className="flex flex-col gap-4">
            {view.checks.map((c) => (
              <li key={c.merchantKey} className="flex flex-col gap-2">
                <p>
                  {c.payee}: {formatCents(c.totalCents)} this year, tagged{" "}
                  {TAX_TAGS[c.tag].label.toLowerCase()}.
                </p>
                <CheckButtons merchantKey={c.merchantKey} tag={c.tag} />
              </li>
            ))}
          </ul>
        </section>
      )}

      {TAX_TAG_ORDER.map((tag) => {
        const rows = view.tagged.filter((t) => t.tag === tag);
        if (rows.length === 0) return null;
        return (
          <section key={tag} aria-labelledby={`tag-${tag}`} className={CARD}>
            <h2 id={`tag-${tag}`} className="text-xl font-semibold">
              {TAX_TAGS[tag].label}
            </h2>
            <ul className="flex flex-col gap-3">
              {rows.map((t) => (
                <li
                  key={t.id}
                  className="flex flex-col gap-1 border-t border-zinc-200 pt-2 first:border-0 first:pt-0 dark:border-zinc-800"
                >
                  <div className="flex flex-wrap justify-between gap-x-3">
                    <span className="[overflow-wrap:anywhere]">
                      {dayLabel(t.date)} · {t.payee}
                    </span>
                    <span className="whitespace-nowrap">{formatCents(t.amountCents)}</span>
                  </div>
                  <span className="text-xs text-zinc-500">{SOURCE[t.source]}</span>
                  <TagForm
                    target={{ transactionId: t.id }}
                    current={t.tag}
                    label={`Tax tag for ${t.payee}, ${dayLabel(t.date)}`}
                  />
                </li>
              ))}
            </ul>
          </section>
        );
      })}

      <section aria-labelledby="search" className={CARD}>
        <h2 id="search" className="text-xl font-semibold">
          Tag something else
        </h2>
        <form className="flex flex-wrap gap-2" role="search">
          <input type="hidden" name="year" value={year} />
          <label className="flex flex-1 flex-col gap-1">
            <span className="text-sm">Find a charge from {year}</span>
            <input
              name="q"
              defaultValue={q}
              placeholder="Staples, a uniform, a course…"
              className="h-11 rounded-lg border border-zinc-300 bg-white px-3 dark:border-zinc-700 dark:bg-zinc-950"
            />
          </label>
          <button
            type="submit"
            className="inline-flex h-11 items-center self-end rounded-full bg-emerald-700 px-5 text-sm font-medium text-white hover:bg-emerald-800"
          >
            Find
          </button>
        </form>
        {q && found.length === 0 && (
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            Nothing matches that in {year}.
          </p>
        )}
        <ul className="flex flex-col gap-3">
          {found.map((t) => (
            <li key={t.id} className="flex flex-col gap-1">
              <div className="flex flex-wrap justify-between gap-x-3">
                <span className="[overflow-wrap:anywhere]">
                  {dayLabel(t.date)} · {t.payee}
                </span>
                <span className="whitespace-nowrap">{formatCents(t.amountCents)}</span>
              </div>
              <TagForm
                target={{ transactionId: t.id }}
                current={t.tag}
                label={`Tax tag for ${t.payee}, ${dayLabel(t.date)}`}
              />
            </li>
          ))}
        </ul>
      </section>
    </>
  );
}

export default function TaxTagsPage({ searchParams }: PageProps<"/taxes/tags">) {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-4 py-10 sm:px-6 sm:py-12">
      <Suspense fallback={<PageLoading />}>
        <TagsContent searchParams={searchParams} />
      </Suspense>
    </main>
  );
}
