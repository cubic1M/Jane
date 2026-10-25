import Link from "next/link";
import { Suspense } from "react";
import { AppHeader } from "@/components/app-header";
import { DemoAdviceLabel } from "@/components/demo-advice-label";
import { formatCents } from "@/lib/money";
import { cleanOverrides, loadLongView } from "@/lib/long-view";
import { requireUser } from "@/lib/session";
import { LoadingBar } from "@/components/loading-bar";

// The long view (spec step 209): net worth in 10, 20 and 30 years as a range, in today's
// dollars, with every assumption shown and editable. A range, never a promise.

const MUTED = "text-zinc-600 dark:text-zinc-400";
const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

async function LongViewContent({
  searchParams,
}: {
  searchParams: PageProps<"/long-view">["searchParams"];
}) {
  const user = await requireUser();
  const params = await searchParams;
  const overrides = cleanOverrides({
    low: first(params.low),
    high: first(params.high),
    extra: first(params.extra),
  });
  const view = await loadLongView(user.id, overrides);
  return (
    <>
      <AppHeader user={user} />
      <div className="flex flex-col gap-2">
        <h1 className="text-3xl font-semibold tracking-tight">The long view</h1>
        <p className={MUTED}>
          Where your net worth could be in 10, 20 and 30 years if things carry on as they are, as a
          range, in today&apos;s dollars. It isn&apos;t a promise.
        </p>
      </div>
      {!view ? (
        <p className={MUTED}>Link an account first, then I can look ahead.</p>
      ) : (
        <>
          <ul className="grid gap-3 sm:grid-cols-3">
            {view.horizons.map((h) => (
              <li
                key={h.years}
                className="flex flex-col gap-1 rounded-xl border border-zinc-200 p-4 dark:border-zinc-800"
              >
                <span className={`text-sm ${MUTED}`}>In {h.years} years</span>
                <span className="text-xl font-semibold">
                  {formatCents(h.lowCents)} to {formatCents(h.highCents)}
                </span>
                <span className={`text-xs ${MUTED}`}>
                  Invested {formatCents(h.parts.investedLowCents)} to{" "}
                  {formatCents(h.parts.investedHighCents)}; cash {formatCents(h.parts.cashCents)};
                  home {formatCents(h.parts.homeCents)}; owing {formatCents(h.parts.debtsCents)}.
                </span>
              </li>
            ))}
          </ul>

          <section className="flex flex-col gap-2">
            <h2 className="text-xl font-semibold">What I assumed</h2>
            <form method="get" className="flex flex-col gap-3 text-sm">
              <ul className="flex flex-col gap-2">
                {view.assumptions.map((a) => (
                  <li key={a.label} className="flex flex-wrap items-baseline justify-between gap-2">
                    <span>
                      <strong>{a.label}:</strong> {a.value}.{" "}
                      <span className={MUTED}>{a.source}.</span>
                    </span>
                    {a.editable && (
                      <label className="inline-flex items-center gap-2">
                        <span className="sr-only">Change {a.label}</span>
                        <input
                          name={a.editable}
                          inputMode="decimal"
                          defaultValue={first(params[a.editable]) ?? ""}
                          placeholder={a.editable === "extra" ? "$ a month" : "% a year"}
                          className="min-h-11 w-28 rounded-lg border border-zinc-300 px-2 dark:border-zinc-700 dark:bg-zinc-900"
                        />
                      </label>
                    )}
                  </li>
                ))}
              </ul>
              <div className="flex gap-3">
                <button
                  type="submit"
                  className="min-h-11 rounded-lg bg-emerald-700 px-4 font-medium text-white"
                >
                  Update
                </button>
                <Link
                  href="/long-view"
                  className="inline-flex min-h-11 items-center text-emerald-700 hover:underline"
                >
                  Back to the usual
                </Link>
              </div>
            </form>
          </section>

          {view.advice && (view.levers.length > 0 || view.retirement) && (
            <section className="flex flex-col gap-2">
              <h2 className="text-xl font-semibold">What moves it most</h2>
              <DemoAdviceLabel />
              <ul className="flex flex-col gap-2 text-sm">
                {view.levers.map((l) => (
                  <li key={l.key}>
                    {l.words}: about {formatCents(Math.abs(l.deltaCents))}{" "}
                    {l.deltaCents >= 0 ? "more" : "less"} in 30 years at the low end.{" "}
                    <Link href={l.href} className="font-medium text-emerald-700 hover:underline">
                      {l.key === "invest" ? "Set up automatic investing" : "See the debt plan"}
                    </Link>
                  </li>
                ))}
                {view.retirement && (
                  <li>
                    Retirement at {view.retirement.retirementAge}:{" "}
                    {formatCents(view.retirement.projection.lowCents)} to{" "}
                    {formatCents(view.retirement.projection.highCents)} in today&apos;s dollars (
                    {view.retirement.status === "on_track"
                      ? "on track"
                      : view.retirement.status === "maybe"
                        ? "possible"
                        : view.retirement.status === "behind"
                          ? "short of the guideline"
                          : "target unknown"}
                    ).{" "}
                    <Link
                      href="/investments/retirement"
                      className="font-medium text-emerald-700 hover:underline"
                    >
                      See the retirement plan
                    </Link>
                  </li>
                )}
              </ul>
            </section>
          )}
        </>
      )}
    </>
  );
}

export default function LongViewPage({ searchParams }: PageProps<"/long-view">) {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-4 py-10 sm:px-6 sm:py-12">
      <Suspense fallback={<LoadingBar />}>
        <LongViewContent searchParams={searchParams} />
      </Suspense>
    </main>
  );
}
