import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { AppHeader } from "@/components/app-header";
import { FIGURE_IDS, FIGURE_LABELS, type FigureId } from "@/config/figures";
import { explainFigure } from "@/lib/figures";
import { incomeOverride, listPreferences } from "@/lib/jane-agent/preferences";
import { categoryOptions } from "@/lib/categories";
import { formatCents } from "@/lib/money";
import { requireUser } from "@/lib/session";
import { CategoryForm } from "@/app/transactions/category-form";
import { IncomeForm } from "../income-form";
import { LoadingBar } from "@/components/loading-bar";

// How I got this (spec step 239): the working behind a headline figure, and "that's wrong".
const MUTED = "text-zinc-600 dark:text-zinc-400";

async function Figure({ params }: { params: PageProps<"/figures/[id]">["params"] }) {
  const user = await requireUser();
  const { id } = await params;
  if (!(FIGURE_IDS as readonly string[]).includes(id)) notFound();
  const working = await explainFigure(user.id, id as FigureId);
  const said = incomeOverride(await listPreferences(user.id));
  const groups = categoryOptions();
  return (
    <>
      <AppHeader user={user} />
      <div className="flex flex-col gap-2">
        <h1 className="text-3xl font-semibold tracking-tight">How I got this</h1>
        <p className={MUTED}>
          {FIGURE_LABELS[id as FigureId]}:{" "}
          {working ? <strong>{working.value}</strong> : "nothing to show yet"}
          {working && <> as of {working.asOf}</>}.
        </p>
      </div>
      {!working ? (
        <p className={MUTED}>Link an account first, then I can show my working.</p>
      ) : (
        <>
          <p>{working.summary}</p>
          <ul className="flex flex-col divide-y divide-zinc-200 rounded-xl border border-zinc-200 text-sm dark:divide-zinc-800 dark:border-zinc-800">
            {working.rows.map((r, i) => (
              <li
                key={`${r.label}-${i}`}
                className="flex flex-wrap justify-between gap-2 px-4 py-2"
              >
                <span>
                  {r.label}
                  {r.note && <span className={`block text-xs ${MUTED}`}>{r.note}</span>}
                </span>
                <span className="font-medium">{r.value}</span>
              </li>
            ))}
          </ul>
          {working.transactions.length > 0 && (
            <section className="flex flex-col gap-2">
              <h2 className="text-xl font-semibold">The transactions behind it</h2>
              <ul className="flex flex-col gap-2 text-sm">
                {working.transactions.map((t) => (
                  <li key={t.id}>
                    <details className="rounded-lg border border-zinc-200 px-3 py-2 dark:border-zinc-800">
                      <summary className="cursor-pointer">
                        {t.date} · {t.description} · {formatCents(Math.abs(t.amountCents))} ·{" "}
                        {t.category_label}
                      </summary>
                      {working.corrections.includes("category") && (
                        <CategoryForm transactionId={t.id} current={t.detailed} groups={groups} />
                      )}
                    </details>
                  </li>
                ))}
              </ul>
            </section>
          )}
          {working.rules.length > 0 && (
            <section className="flex flex-col gap-1 text-sm">
              <h2 className="text-xl font-semibold">The rules and rates I used</h2>
              <ul className={`flex flex-col gap-1 ${MUTED}`}>
                {working.rules.map((r) => (
                  <li key={r.label}>
                    {r.label}: {r.value}
                  </li>
                ))}
              </ul>
            </section>
          )}
          {working.corrections.includes("income") && (
            <section className="flex flex-col gap-2">
              <h2 className="text-xl font-semibold">That&apos;s wrong</h2>
              <p className={`text-sm ${MUTED}`}>
                If your income isn&apos;t what I worked out, tell me and I&apos;ll use it
                everywhere: your health score, the year plan, what-ifs and the long view.
              </p>
              <IncomeForm said={said === null ? null : String(said / 100)} />
            </section>
          )}
          {working.corrections.includes("category") && working.transactions.length > 0 && (
            <p className={`text-sm ${MUTED}`}>
              Open a transaction above to fix its category. It sticks, and everything that used it
              updates.
            </p>
          )}
          <Link href="/chat" className="text-sm font-medium text-emerald-700 hover:underline">
            Ask Jane
          </Link>
        </>
      )}
    </>
  );
}

export default function FigurePage({ params }: PageProps<"/figures/[id]">) {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-4 py-10 sm:px-6 sm:py-12">
      <Suspense fallback={<LoadingBar />}>
        <Figure params={params} />
      </Suspense>
    </main>
  );
}
