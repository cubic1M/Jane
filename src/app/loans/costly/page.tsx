import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { AppHeader, PageLoading } from "@/components/app-header";
import { DemoAdviceLabel } from "@/components/demo-advice-label";
import { COSTLY_LABELS, COSTLY_SOURCES, PAL } from "@/config/costly-borrowing";
import { loadCostlyBorrowing } from "@/lib/costly-borrowing";
import { wayOutLines } from "@/lib/jane-agent/costly-borrowing-replies";
import { formatCents } from "@/lib/money";
import { requireUser } from "@/lib/session";
import { formatRate } from "@/lib/percent";

// Out of costly short-term borrowing (spec step 247): what payday loans, cash advances,
// overdrafts and pay advance apps cost over the last year, in dollars and as a yearly rate, and
// the cheaper ways out (demo advice). Nothing is borrowed, applied for or sent from here.

const LINK = "font-medium text-emerald-700 hover:underline";
const CARD = "flex flex-col gap-3 rounded-xl border border-zinc-200 p-4 dark:border-zinc-800";

async function CostlyContent() {
  const user = await requireUser();
  await connection();
  const d = await loadCostlyBorrowing(user.id);
  return (
    <>
      <AppHeader user={user} />
      <div className="flex flex-col gap-2">
        <h1 className="text-3xl font-semibold tracking-tight">Costly short-term borrowing</h1>
        <p className="text-zinc-600 dark:text-zinc-400">
          Payday loans, card cash advances, repeated overdrafts and pay advance apps in your last
          year of payments, and what they cost.
        </p>
      </div>
      {!d.any ? (
        <p className="text-zinc-600 dark:text-zinc-400">
          I don&apos;t see these costing you much in the last year.{" "}
          <Link href="/loans" className={LINK}>
            See every debt
          </Link>
        </p>
      ) : (
        <>
          <p role="status" className="text-lg">
            It cost you {formatCents(d.totalYearlyCents)} over the last year.
            {d.cycle ? " You've borrowed again within a few months: a cycle." : ""}
          </p>
          <ul aria-label="What you paid" className="flex flex-col gap-3">
            {d.kinds.map((k) => (
              <li key={k.kind} className={CARD}>
                <h2 className="text-lg font-semibold">{COSTLY_LABELS[k.kind]}</h2>
                <p>
                  {k.count} {k.count === 1 ? "time" : "times"}, {formatCents(k.costCents)} in fees
                  {k.aprBps !== null ? `, about ${formatRate(k.aprBps)} a year` : ""}.
                </p>
                <p className="text-sm text-zinc-600 dark:text-zinc-400">
                  Worked out from {k.basis}.
                </p>
              </li>
            ))}
          </ul>
          {d.advice ? (
            <section aria-label="Ways out" className={CARD}>
              <DemoAdviceLabel />
              <h2 className="text-xl font-semibold">Cheaper ways out</h2>
              <ul className="flex flex-col gap-2">
                {wayOutLines(d).map((l) => (
                  <li key={l}>{l.replace(/^- /, "")}</li>
                ))}
              </ul>
              <a href={PAL.source} className={`${LINK} text-sm`}>
                About payday alternative loans (NCUA)
              </a>
              <h2 className="text-xl font-semibold">To stop the cycle</h2>
              <ol className="list-decimal pl-5">
                {d.steps.map((s) => (
                  <li key={s}>{s}</li>
                ))}
              </ol>
            </section>
          ) : null}
          <ul className="flex flex-col gap-1 text-sm">
            {COSTLY_SOURCES.map((s) => (
              <li key={s.url}>
                <a href={s.url} className={LINK}>
                  {s.label}
                </a>
              </li>
            ))}
          </ul>
        </>
      )}
    </>
  );
}

export default function CostlyPage() {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-4 py-10 sm:px-6 sm:py-12">
      <Suspense fallback={<PageLoading />}>
        <CostlyContent />
      </Suspense>
    </main>
  );
}
