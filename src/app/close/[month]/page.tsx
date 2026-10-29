import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense, type ReactNode } from "react";
import { AppHeader, PageLoading } from "@/components/app-header";
import { LedgerEntryRow } from "@/components/ledger-entry";
import { loadMonthClose } from "@/lib/close";
import { dayLabel, monthLabel } from "@/lib/day-label";
import type { LedgerEntry } from "@/lib/ledger";
import { formatCents } from "@/lib/money";
import { requireUser } from "@/lib/session";
import { todayOf } from "@/lib/today";
import { CHANGE_LABEL, monthStep, type CloseChange } from "@/planning/close";

// The monthly close (src/planning/close.ts): Jane closing one month of the person's books. Few
// words: a line of figures, at most three chips, then five short parts (found, did, verified
// with its lines, changed, still open), each line's detail behind a click. A month with nothing
// new leads with the checkup.

const MONTH = /^\d{4}-\d{2}$/;
const MUTED = "text-zinc-600 dark:text-zinc-400";
const LINK = "text-sm font-medium underline-offset-2 hover:underline";

function Part({
  id,
  title,
  count,
  children,
}: {
  id: string;
  title: string;
  count: number;
  children: ReactNode;
}) {
  return (
    <section id={id} aria-label={title} className="flex flex-col gap-2">
      <h2 className="flex items-baseline gap-2 text-xl font-semibold">
        {title}
        <span className={`font-mono text-sm font-normal ${MUTED}`}>[{count}]</span>
      </h2>
      {count === 0 ? <p className={`text-sm ${MUTED}`}>None.</p> : children}
    </section>
  );
}

function Entries({ entries }: { entries: LedgerEntry[] }) {
  return (
    <ul className="flex flex-col gap-2">
      {entries.map((e) => (
        <LedgerEntryRow key={e.key} entry={e} />
      ))}
    </ul>
  );
}

function ChangeRow({ change: c }: { change: CloseChange }) {
  return (
    <li data-close-change={c.kind}>
      <details className="rounded-xl border border-zinc-200 dark:border-zinc-800">
        <summary className="flex cursor-pointer flex-wrap items-baseline gap-x-3 gap-y-1 p-3">
          <span className="font-mono text-xs tracking-wide uppercase">
            ▲ [{CHANGE_LABEL[c.kind]}]
          </span>
          <span className="flex-1 font-medium">{formatCents(c.amountCents)}</span>
          <span className={`text-xs ${MUTED}`}>{c.sure} sure</span>
        </summary>
        <div className="flex flex-col gap-1 border-t border-zinc-200 p-3 text-sm dark:border-zinc-800">
          <p className="[overflow-wrap:anywhere]">{c.title}</p>
          <p className={`text-xs ${MUTED}`}>
            {dayLabel(c.date, { year: true })}
            {c.usualCents !== null ? ` · usually ${formatCents(c.usualCents)}` : ""}
          </p>
        </div>
      </details>
    </li>
  );
}

async function CloseContent({ params }: { params: PageProps<"/close/[month]">["params"] }) {
  const user = await requireUser();
  await connection();
  const { month } = await params;
  const thisMonth = (await todayOf(user.id)).slice(0, 7);
  if (!MONTH.test(month) || month > thisMonth) notFound();
  const close = await loadMonthClose(user.id, month);
  const before = monthStep(month, -1);
  const after = month < thisMonth ? monthStep(month, 1) : null;
  const c = close.checkup;
  const checkupLine = `Jane ran ${c.lines.length} checks: ${c.found} found something, ${c.passed} found nothing wrong${c.notEnoughData > 0 ? `, ${c.notEnoughData} need more data` : ""}.`;
  const checkupList = (
    <ul className="flex flex-col gap-1 text-sm">
      {c.lines.map((l) => (
        <li key={l.type} data-checkup-line={l.status}>
          <details>
            <summary className="cursor-pointer">
              {l.status === "found" ? "●" : l.status === "passed" ? "○" : "◌"} {l.label}: {l.line}
            </summary>
            <p className={`pl-5 text-xs ${MUTED}`}>{l.detail}</p>
          </details>
        </li>
      ))}
    </ul>
  );

  return (
    <>
      <AppHeader user={user} />
      <section className="flex flex-col gap-2">
        <h1 className="text-3xl font-semibold tracking-tight">
          {monthLabel(month, { long: true })} close{close.soFar ? ", so far" : ""}
        </h1>
        <p data-close-figures="" className="font-mono text-sm">
          Verified {formatCents(close.verifiedCents)} · Found {close.found.length} · Open{" "}
          {close.open.length}
        </p>
        {close.chips.length > 0 && (
          <div role="group" aria-label="What matters now" className="flex flex-wrap gap-2">
            {close.chips.map((chip, i) => (
              <a
                key={i}
                href={chip.href}
                className="rounded-full border border-zinc-300 px-3 py-1 font-mono text-xs dark:border-zinc-700"
              >
                ● {chip.label} {chip.figure}
                {chip.sure ? ` · ${chip.sure} sure` : ""}
              </a>
            ))}
          </div>
        )}
        <nav aria-label="Months" className="flex gap-4">
          <Link href={`/close/${before}`} className={LINK}>
            ‹ {monthLabel(before, { long: true })}
          </Link>
          {after && (
            <Link href={`/close/${after}`} className={LINK}>
              {monthLabel(after, { long: true })} ›
            </Link>
          )}
        </nav>
      </section>

      {close.quiet && (
        <section aria-label="Checkup" className="flex flex-col gap-2">
          <h2 className="text-xl font-semibold">
            {close.allGood ? "Nothing wrong this month" : "Nothing new this month"}
          </h2>
          <p className="text-sm">{checkupLine}</p>
          {checkupList}
        </section>
      )}

      <Part id="found" title="Found" count={close.found.length}>
        <Entries entries={close.found} />
      </Part>
      <Part id="did" title="You did" count={close.did.length}>
        <Entries entries={close.did} />
      </Part>
      <Part id="verified" title="Verified" count={close.verified.length}>
        <Entries entries={close.verified} />
      </Part>
      <Part id="changed" title="Changed" count={close.changed.length}>
        <ul className="flex flex-col gap-2">
          {close.changed.map((ch) => (
            <ChangeRow key={ch.key} change={ch} />
          ))}
        </ul>
      </Part>
      <Part id="open" title="Open for next month" count={close.open.length}>
        <Entries entries={close.open} />
      </Part>

      {!close.quiet && (
        <details className="text-sm">
          <summary className="cursor-pointer font-medium">{checkupLine}</summary>
          <div className="mt-2">{checkupList}</div>
        </details>
      )}
      <Link href="/saved" className={LINK}>
        Every saving ›
      </Link>
    </>
  );
}

export default function MonthClosePage({ params }: PageProps<"/close/[month]">) {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-4 py-8 sm:px-6">
      <Suspense fallback={<PageLoading />}>
        <CloseContent params={params} />
      </Suspense>
    </main>
  );
}
