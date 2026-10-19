import Link from "next/link";
import { after, connection } from "next/server";
import { Suspense } from "react";
import { AppHeader } from "@/components/app-header";
import { isoDate } from "@/detection/units";
import { loadAffordNumbers } from "@/lib/afford";
import { track } from "@/lib/analytics";
import { formatCents } from "@/lib/money";
import { requireUser } from "@/lib/session";
import { affordCheck, affordWindow, type AffordResult, type MonthEnd } from "@/planning/afford";
import {
  AFFORD_COPY,
  monthlyNeededLine,
  reachedByLine,
  safeLine,
  shortLine,
} from "@/planning/afford-copy";
import { AFFORD_KINDS, parseAffordQuery } from "@/planning/afford-query";

// "Can I afford this?" (spec step 69). The form is a plain GET form, so the answer lives
// in the URL: it can be shared, and nothing is saved.

const INPUT =
  "h-11 rounded-lg border border-zinc-300 bg-transparent px-3 text-base dark:border-zinc-700";
const LINK = "font-medium text-emerald-700 hover:underline";

const fmt = (cents: number) => (cents < 0 ? `−${formatCents(-cents)}` : formatCents(cents));
const utc = (iso: string, options: Intl.DateTimeFormatOptions) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-US", { ...options, timeZone: "UTC" });
const shortDate = (iso: string) => utc(iso, { month: "short", day: "numeric" });
const longDate = (iso: string) => utc(iso, { month: "short", day: "numeric", year: "numeric" });
const monthName = (month: string, style: "short" | "long" = "short") =>
  utc(`${month}-01`, { month: style, year: "numeric" });

function Bar({ cents, max }: { cents: number; max: number }) {
  const width = max === 0 ? 0 : Math.round((Math.abs(cents) / max) * 100);
  return (
    <div className="h-2 rounded bg-zinc-100 dark:bg-zinc-800" aria-hidden="true">
      <div
        className={`h-2 rounded ${cents < 0 ? "bg-red-600" : "bg-emerald-600"}`}
        style={{ width: `${width}%` }}
      />
    </div>
  );
}

function MonthList({ months, firstShort }: { months: MonthEnd[]; firstShort: string | null }) {
  const max = Math.max(...months.flatMap((m) => [Math.abs(m.beforeCents), Math.abs(m.afterCents)]));
  return (
    <ol className="flex flex-col gap-3">
      {months.map((m) => (
        <li key={m.month} className="flex flex-col gap-1">
          <div className="flex flex-wrap justify-between gap-2 text-sm">
            <span className="font-medium">{monthName(m.month)}</span>
            {m.month === firstShort && (
              <span className="font-medium text-red-700 dark:text-red-400">
                First month below zero
              </span>
            )}
          </div>
          <div className="grid grid-cols-[3rem_1fr_minmax(6.5rem,auto)] items-center gap-x-2 gap-y-1 text-sm">
            <span className="text-zinc-600 dark:text-zinc-400">Before</span>
            <Bar cents={m.beforeCents} max={max} />
            <span
              className={`text-right ${m.beforeCents < 0 ? "text-red-700 dark:text-red-400" : ""}`}
            >
              {fmt(m.beforeCents)}
            </span>
            <span className="text-zinc-600 dark:text-zinc-400">After</span>
            <Bar cents={m.afterCents} max={max} />
            <span
              className={`text-right font-medium ${m.afterCents < 0 ? "text-red-700 dark:text-red-400" : ""}`}
            >
              {fmt(m.afterCents)}
            </span>
          </div>
        </li>
      ))}
    </ol>
  );
}

function Results({ result }: { result: AffordResult }) {
  return (
    <section aria-labelledby="afford-results" className="flex flex-col gap-6">
      <h2 id="afford-results" className="sr-only">
        What it does
      </h2>
      {result.safe ? (
        <p className="rounded-xl border border-zinc-200 p-4 text-lg font-semibold dark:border-zinc-800">
          {safeLine(
            result.safe.payday ? shortDate(result.safe.payday) : null,
            fmt(result.safe.beforeCents),
            fmt(result.safe.afterCents),
          )}
        </p>
      ) : (
        <p className="text-zinc-600 dark:text-zinc-400">
          {AFFORD_COPY.noChecking}{" "}
          <Link href="/connect" className={LINK}>
            Link a bank
          </Link>
        </p>
      )}

      <section aria-labelledby="afford-goals" className="flex flex-col gap-2">
        <h3 id="afford-goals" className="text-xl font-semibold">
          {AFFORD_COPY.goalsHeading}
        </h3>
        {result.goals.length === 0 ? (
          <p className="text-zinc-600 dark:text-zinc-400">{AFFORD_COPY.noGoals}</p>
        ) : (
          <>
            <ul className="flex flex-col gap-1 text-sm">
              {result.goals.map((g) => (
                <li key={g.id}>
                  {g.kind === "monthly_needed"
                    ? monthlyNeededLine(
                        g.name,
                        fmt(g.beforeCents),
                        fmt(g.afterCents),
                        longDate(g.targetDate),
                      )
                    : reachedByLine(
                        g.name,
                        { before: fmt(g.beforeMonthlyCents), after: fmt(g.afterMonthlyCents) },
                        g.before && monthName(g.before.slice(0, 7)),
                        g.after && monthName(g.after.slice(0, 7)),
                      )}
                </li>
              ))}
            </ul>
            <p className="text-xs text-zinc-500">{AFFORD_COPY.goalsNote}</p>
          </>
        )}
      </section>

      {result.months && result.firstShort && (
        <section aria-labelledby="afford-months" className="flex flex-col gap-2">
          <h3 id="afford-months" className="text-xl font-semibold">
            {AFFORD_COPY.monthsHeading}
          </h3>
          <p className="text-sm">
            {shortLine(
              result.firstShort.before && monthName(result.firstShort.before, "long"),
              result.firstShort.after && monthName(result.firstShort.after, "long"),
            )}
          </p>
          <MonthList months={result.months} firstShort={result.firstShort.after} />
        </section>
      )}
    </section>
  );
}

async function AffordContent({
  searchParams,
}: {
  searchParams: PageProps<"/afford">["searchParams"];
}) {
  const user = await requireUser();
  await connection();
  const now = new Date();
  const asOf = isoDate(now);
  const { months, until } = affordWindow(asOf);
  const query = parseAffordQuery(await searchParams, asOf);
  const result = query.change
    ? affordCheck(await loadAffordNumbers(user.id, { now }), query.change)
    : null;
  if (query.change) {
    // The kind only: amounts are never sent to analytics.
    after(() => track(user.id, "afford_checked", { kind: query.form.kind }));
  }

  return (
    <>
      <AppHeader user={user} />
      <div className="flex flex-col gap-2">
        <h1 className="text-3xl font-semibold tracking-tight">{AFFORD_COPY.title}</h1>
        <p className="text-zinc-600 dark:text-zinc-400">{AFFORD_COPY.intro}</p>
      </div>

      <form method="get" action="/afford" className="grid gap-3 sm:grid-cols-2">
        <label htmlFor="afford-kind" className="flex flex-col gap-1 text-sm font-medium">
          What it is
          <select id="afford-kind" name="kind" defaultValue={query.form.kind} className={INPUT}>
            {AFFORD_KINDS.map((kind) => (
              <option key={kind} value={kind}>
                {AFFORD_COPY.kinds[kind]}
              </option>
            ))}
          </select>
        </label>
        <label htmlFor="afford-amount" className="flex flex-col gap-1 text-sm font-medium">
          Amount ($)
          <input
            id="afford-amount"
            name="amount"
            inputMode="decimal"
            defaultValue={query.form.amount}
            placeholder="250"
            className={INPUT}
          />
        </label>
        <label htmlFor="afford-date" className="flex flex-col gap-1 text-sm font-medium">
          Date, for a purchase
          <input
            id="afford-date"
            name="date"
            type="date"
            min={asOf}
            max={until}
            defaultValue={query.form.date}
            className={INPUT}
          />
        </label>
        <label htmlFor="afford-month" className="flex flex-col gap-1 text-sm font-medium">
          Starting month, for a monthly change
          <select id="afford-month" name="month" defaultValue={query.form.month} className={INPUT}>
            {months.map((m) => (
              <option key={m} value={m}>
                {monthName(m, "long")}
              </option>
            ))}
          </select>
        </label>
        <button
          type="submit"
          className="h-11 rounded-lg bg-emerald-700 px-4 font-semibold text-white hover:bg-emerald-800 sm:col-span-2 sm:justify-self-start"
        >
          Show the math
        </button>
      </form>

      {query.error && (
        <p role="alert" className="text-sm font-medium text-red-700 dark:text-red-400">
          {query.error}
        </p>
      )}

      {result && <Results result={result} />}

      <p className="rounded-xl bg-zinc-100 p-4 text-sm text-zinc-700 dark:bg-zinc-900 dark:text-zinc-300">
        {AFFORD_COPY.disclaimer}
      </p>
    </>
  );
}

export default function AffordPage({ searchParams }: PageProps<"/afford">) {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-8 px-4 py-10 sm:px-6 sm:py-12">
      <Suspense fallback={<p className="text-zinc-500">Loading…</p>}>
        <AffordContent searchParams={searchParams} />
      </Suspense>
    </main>
  );
}
