import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { AppHeader } from "@/components/app-header";
import { IRS_ESTIMATED_TAX_URL, type PreparerGroup } from "@/config/tax-pack";
import { formatCents } from "@/lib/money";
import { requireUser } from "@/lib/session";
import { loadTaxPack } from "@/lib/tax-pack";
import { selectableYears, taxYearFrom, type PackGroup } from "@/planning/tax-pack";
import { QUARTER_LABELS, TAX_PACK_COPY as COPY } from "@/planning/tax-pack-copy";

// The tax-time pack (spec step 72): organizing only, no tax advice and no Claude text.

const LINK = "font-medium text-emerald-700 hover:underline";
const CARD = "flex flex-col gap-3 rounded-xl border border-zinc-200 p-4 dark:border-zinc-800";

const day = (iso: string) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });

function Rows({ group, empty, label }: { group: PackGroup; empty: string; label: string }) {
  if (group.rows.length === 0) {
    return <p className="text-sm text-zinc-600 dark:text-zinc-400">{empty}</p>;
  }
  return (
    <table className="w-full text-sm">
      <caption className="sr-only">{label}</caption>
      <thead>
        <tr className="text-left text-zinc-600 dark:text-zinc-400">
          <th scope="col" className="py-1 pr-2 font-medium">
            {COPY.dateLabel}
          </th>
          <th scope="col" className="py-1 pr-2 font-medium">
            {COPY.payeeLabel}
          </th>
          <th scope="col" className="py-1 text-right font-medium">
            {COPY.amountLabel}
          </th>
        </tr>
      </thead>
      <tbody>
        {group.rows.map((r) => (
          <tr key={r.id} className="border-t border-zinc-200 dark:border-zinc-800">
            <td className="py-1 pr-2 whitespace-nowrap">{day(r.date)}</td>
            <td className="py-1 pr-2 [overflow-wrap:anywhere]">
              {r.payee}
              {r.source === "check" && (
                <span className="block text-xs text-amber-800 dark:text-amber-300">
                  {COPY.checkNote}
                </span>
              )}
            </td>
            <td className="py-1 text-right whitespace-nowrap">{formatCents(r.amountCents)}</td>
          </tr>
        ))}
      </tbody>
      <tfoot>
        <tr className="border-t border-zinc-300 font-semibold dark:border-zinc-700">
          <th scope="row" colSpan={2} className="py-1 text-left">
            {COPY.totalLabel}
          </th>
          <td className="py-1 text-right whitespace-nowrap">{formatCents(group.totalCents)}</td>
        </tr>
      </tfoot>
    </table>
  );
}

async function TaxPackContent({
  searchParams,
}: {
  searchParams: PageProps<"/tax-pack">["searchParams"];
}) {
  const user = await requireUser();
  await connection();
  const now = new Date();
  const today = now.toISOString().slice(0, 10);
  const { year: asked } = await searchParams;
  const year = taxYearFrom(typeof asked === "string" ? asked : undefined, today);
  const pack = await loadTaxPack(user.id, year, { now });
  const groups = Object.keys(pack.preparer) as PreparerGroup[];

  return (
    <>
      <AppHeader user={user} />
      <div className="flex flex-col gap-2">
        <h1 className="text-3xl font-semibold tracking-tight">
          {COPY.title}: {year}
        </h1>
        <p className="text-zinc-600 dark:text-zinc-400">{COPY.intro}</p>
      </div>
      <p className="rounded-xl bg-zinc-100 p-4 text-sm text-zinc-700 dark:bg-zinc-900 dark:text-zinc-300">
        {COPY.notAdvice}
      </p>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <nav aria-label={COPY.yearsLabel} className="flex flex-wrap gap-3 text-sm">
          {selectableYears(today).map((yr) => (
            <Link
              key={yr}
              href={`/tax-pack?year=${yr}`}
              aria-current={yr === year ? "page" : undefined}
              className={yr === year ? "font-semibold" : LINK}
            >
              {yr}
            </Link>
          ))}
        </nav>
        <a
          href={`/tax-pack/download?year=${year}`}
          download
          className="inline-flex h-11 items-center rounded-full bg-emerald-700 px-5 text-sm font-medium text-white hover:bg-emerald-800"
        >
          {COPY.downloadLabel}
        </a>
      </div>

      <section aria-labelledby="summary" className={CARD}>
        <h2 id="summary" className="text-xl font-semibold">
          {COPY.summaryHeading}
        </h2>
        <dl className="grid grid-cols-1 gap-x-4 gap-y-1 text-sm sm:grid-cols-2">
          {(
            [
              [COPY.charityHeading, pack.charity.totalCents],
              ...groups.map((g) => [COPY.groupLabels[g], pack.preparer[g].totalCents] as const),
              [COPY.incomeHeading, pack.income.totalCents],
            ] as const
          ).map(([label, cents]) => (
            <div key={label} className="flex justify-between gap-2">
              <dt className="text-zinc-600 dark:text-zinc-400">{label}</dt>
              <dd className="whitespace-nowrap">{formatCents(cents)}</dd>
            </div>
          ))}
        </dl>
        <p className="text-xs text-zinc-500">
          {COPY.tagsNote}{" "}
          <Link href="/taxes/tags" className={LINK}>
            {COPY.tagsLink}
          </Link>
        </p>
      </section>

      <section aria-labelledby="forms" className={CARD}>
        <h2 id="forms" className="text-xl font-semibold">
          {COPY.formsHeading}
        </h2>
        {pack.forms.length === 0 ? (
          <p className="text-sm text-zinc-600 dark:text-zinc-400">{COPY.formsEmpty}</p>
        ) : (
          <ul className="flex flex-col gap-1 text-sm">
            {pack.forms.map((f) => (
              <li key={f.key} className="flex flex-wrap justify-between gap-x-3">
                <span className="[overflow-wrap:anywhere]">
                  {f.form} from {f.from}
                </span>
                <span className="text-zinc-600 dark:text-zinc-400">
                  {f.received
                    ? COPY.formReceived
                    : f.mayNotSend
                      ? COPY.formMayNotSend
                      : `${COPY.formWaiting}, by about ${day(f.by)}`}
                </span>
              </li>
            ))}
          </ul>
        )}
        <p className="text-xs text-zinc-500">{COPY.formsNote}</p>
      </section>

      <section aria-labelledby="states" className={CARD}>
        <h2 id="states" className="text-xl font-semibold">
          {COPY.statesHeading}
        </h2>
        {pack.states.length === 0 ? (
          <p className="text-sm text-zinc-600 dark:text-zinc-400">{COPY.statesEmpty}</p>
        ) : (
          <ul className="flex flex-col gap-1 text-sm">
            {pack.states.map((st) => (
              <li key={st.code} className="flex flex-wrap justify-between gap-x-3">
                <a href={st.url} className={LINK} rel="noreferrer">
                  {st.agency}
                </a>
                <span className="text-zinc-600 dark:text-zinc-400">
                  {st.nonresident
                    ? COPY.statesNonresident
                    : st.code.length > 2
                      ? COPY.statesLocal
                      : st.from
                        ? `${day(st.from)} to ${day(st.to!)}`
                        : COPY.statesAllYear}
                </span>
              </li>
            ))}
          </ul>
        )}
        <p className="text-xs text-zinc-500">{COPY.statesNote}</p>
      </section>

      <section aria-labelledby="charity" className={CARD}>
        <h2 id="charity" className="text-xl font-semibold">
          {COPY.charityHeading}
        </h2>
        <Rows group={pack.charity} empty={COPY.charityEmpty} label={COPY.charityHeading} />
      </section>

      <section aria-labelledby="preparer" className={CARD}>
        <h2 id="preparer" className="text-xl font-semibold">
          {COPY.preparerHeading}
        </h2>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">{COPY.disclaimer}</p>
        {groups.map((g) => (
          <div key={g} className="flex flex-col gap-2">
            <h3 className="font-semibold">{COPY.groupLabels[g]}</h3>
            <Rows group={pack.preparer[g]} empty={COPY.groupEmpty} label={COPY.groupLabels[g]} />
          </div>
        ))}
        <div className="flex flex-col gap-2">
          <h3 className="font-semibold">{COPY.interestHeading}</h3>
          {pack.interest === null ? (
            <p className="text-sm text-zinc-600 dark:text-zinc-400">{COPY.interestPastYear}</p>
          ) : pack.interest.length === 0 ? (
            <p className="text-sm text-zinc-600 dark:text-zinc-400">{COPY.interestEmpty}</p>
          ) : (
            <>
              <ul className="flex flex-col gap-1 text-sm">
                {pack.interest.map((loan) => (
                  <li key={loan.name} className="flex justify-between gap-2">
                    <span className="[overflow-wrap:anywhere]">{loan.name}</span>
                    <span className="whitespace-nowrap">{formatCents(loan.cents)}</span>
                  </li>
                ))}
              </ul>
              <p className="text-xs text-zinc-500">{COPY.interestNote}</p>
            </>
          )}
        </div>
      </section>

      <section aria-labelledby="income" className={CARD}>
        <h2 id="income" className="text-xl font-semibold">
          {COPY.incomeHeading}
        </h2>
        {pack.income.rows.length === 0 ? (
          <p className="text-sm text-zinc-600 dark:text-zinc-400">{COPY.incomeEmpty}</p>
        ) : (
          <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-5">
            {QUARTER_LABELS.map((label, i) => (
              <div key={label}>
                <dt className="text-zinc-600 dark:text-zinc-400">{label}</dt>
                <dd>{formatCents(pack.income.quarterCents[i])}</dd>
              </div>
            ))}
            <div>
              <dt className="text-zinc-600 dark:text-zinc-400">{COPY.totalLabel}</dt>
              <dd className="font-semibold">{formatCents(pack.income.totalCents)}</dd>
            </div>
          </dl>
        )}
        <h3 className="font-semibold">{COPY.remindersHeading}</h3>
        <ul className="flex flex-col gap-1 text-sm">
          {pack.reminders.map((date) => (
            <li key={date}>{day(date)}</li>
          ))}
        </ul>
        <p className="text-xs text-zinc-500">
          {COPY.remindersNote}{" "}
          <a href={IRS_ESTIMATED_TAX_URL} className={LINK} rel="noopener noreferrer">
            {COPY.irsLinkLabel}
          </a>
        </p>
      </section>

      <p className="text-sm text-zinc-600 dark:text-zinc-400">
        {COPY.incomplete} {COPY.lifeEventsPrompt}{" "}
        <Link href="/life-events" className={LINK}>
          {COPY.lifeEventsLink}
        </Link>
      </p>
    </>
  );
}

export default function TaxPackPage({ searchParams }: PageProps<"/tax-pack">) {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-4 py-10 sm:px-6 sm:py-12">
      <Suspense fallback={<p className="text-zinc-500">Loading…</p>}>
        <TaxPackContent searchParams={searchParams} />
      </Suspense>
    </main>
  );
}
