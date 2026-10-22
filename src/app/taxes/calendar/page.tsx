import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { AppHeader } from "@/components/app-header";
import { loadTaxCalendar } from "@/lib/tax-calendar";
import { loadTaxFound } from "@/lib/tax-scan";
import { requireUser } from "@/lib/session";

// The tax year that runs itself (spec step 223): what Jane does each month, and where this
// month's items stand. Moving money above the cap, signing and filing are always a tap.

const LINK = "font-medium text-emerald-700 underline";
const CARD = "flex flex-col gap-3 rounded-xl border border-zinc-200 p-4 dark:border-zinc-800";

const STATUS = {
  done: "Done",
  tap: "Needs you",
  waiting: "Coming",
  nothing: "Nothing to do",
} as const;

async function Content() {
  const user = await requireUser();
  await connection();
  const [v, found] = await Promise.all([loadTaxCalendar(user.id), loadTaxFound(user.id)]);
  const of = (month: number) => found.filter((f) => f.month === month);
  return (
    <>
      <AppHeader user={user} />
      <Link href="/taxes" className={`text-sm ${LINK}`}>
        ← Taxes
      </Link>
      <div className="flex flex-col gap-2">
        <h1 className="text-3xl font-semibold tracking-tight">Your tax calendar</h1>
        <p className="text-zinc-600 dark:text-zinc-400">
          {v.acts
            ? "Jane runs the safe parts of your tax year herself and asks for a tap on anything that moves money above your cap for taxes. Signing and filing your return are always yours."
            : "You asked Jane to ask first, so she tells you what is due each month and waits for your tap."}
        </p>
      </div>
      <section aria-labelledby="now" className={CARD}>
        <h2 id="now" className="text-xl font-semibold">
          {v.label}
        </h2>
        <ul className="flex flex-col gap-3 text-sm">
          {v.items.map((i) => (
            <li key={i.key} className="flex flex-col gap-1">
              <strong>
                {i.title}: {STATUS[i.status]}
              </strong>
              <span>{i.detail}</span>
            </li>
          ))}
        </ul>
        {of(v.month).length > 0 && (
          <>
            <h3 className="font-semibold">What Jane found for you this month</h3>
            <ul className="flex flex-col gap-2 text-sm">
              {of(v.month).map((f) => (
                <li key={f.topic} className="flex flex-col">
                  <Link href={f.href} className={LINK}>
                    {f.headline}
                  </Link>
                  <span>
                    {f.short} {f.percent}% sure; number {f.rank} of everything Jane found for you.
                  </span>
                </li>
              ))}
            </ul>
          </>
        )}
        {v.yearEnd && (
          <>
            <h3 className="font-semibold">Year-end moves</h3>
            <ul className="list-disc pl-5 text-sm">
              {v.yearEnd.lines.map((l) => (
                <li key={l}>{l}</li>
              ))}
            </ul>
          </>
        )}
      </section>
      <section aria-labelledby="year" className={CARD}>
        <h2 id="year" className="text-xl font-semibold">
          The whole year
        </h2>
        <ol className="flex flex-col gap-2 text-sm">
          {v.months.map((m) => (
            <li key={m.month} className="flex flex-col">
              <strong>{m.label}</strong>
              <span>{m.items.map((i) => (v.acts ? i.auto : i.ask)).join(" ")}</span>
              {m.month !== v.month && of(m.month).length > 0 && (
                <span className="text-zinc-600 dark:text-zinc-400">
                  For you:{" "}
                  {of(m.month)
                    .map((f) => f.headline)
                    .join("; ")}
                </span>
              )}
            </li>
          ))}
        </ol>
      </section>
    </>
  );
}

export default function CalendarPage() {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-4 py-10 sm:px-6 sm:py-12">
      <Suspense fallback={<p className="text-zinc-500">Loading…</p>}>
        <Content />
      </Suspense>
    </main>
  );
}
