import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { AppHeader } from "@/components/app-header";
import { BudgetList } from "@/components/budget-list";
import { homeSummary } from "@/lib/home";
import { formatCents } from "@/lib/money";
import { requireUser } from "@/lib/session";
import { savingsPhrase } from "@/lib/savings-text";

const CARD = "flex flex-col gap-1 rounded-xl border border-zinc-200 p-4 dark:border-zinc-800";
const LINK = "font-medium text-emerald-700 hover:underline";

function shortDate(iso: string): string {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

async function HomeContent() {
  const user = await requireUser();
  const home = await homeSummary(user.id);
  if (!home) redirect("/connect");

  return (
    <>
      <AppHeader email={user.email} />
      <h1 className="text-3xl font-semibold tracking-tight">How you&apos;re doing</h1>

      <section className="grid gap-3 sm:grid-cols-3">
        <div className={CARD}>
          <span className="text-sm text-zinc-600 dark:text-zinc-400">Money found</span>
          <span className="text-2xl font-semibold">{formatCents(home.moneyFoundCents)}</span>
          <span className="text-xs text-zinc-500">a year, still to look at</span>
        </div>
        <div className={CARD}>
          <span className="text-sm text-zinc-600 dark:text-zinc-400">Saved so far</span>
          <span className="text-2xl font-semibold">{formatCents(home.savedToDateCents)}</span>
          <span className="text-xs text-zinc-500">a year, from finished actions</span>
        </div>
        <div className={CARD}>
          <span className="text-sm text-zinc-600 dark:text-zinc-400">In progress</span>
          <span className="text-2xl font-semibold">{home.openActions}</span>
          <Link href="/actions" className={`text-xs ${LINK}`}>
            See your actions
          </Link>
        </div>
      </section>

      {home.unreadAlerts > 0 && (
        <Link
          href="/alerts"
          className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-amber-50 p-4 font-semibold hover:bg-amber-100 dark:bg-amber-950 dark:hover:bg-amber-900"
        >
          <span>{home.unreadAlerts === 1 ? "1 new alert" : `${home.unreadAlerts} new alerts`}</span>
          <span className="text-sm text-emerald-700">See alerts</span>
        </Link>
      )}

      {home.waitingOnYou.length > 0 && (
        <section className="flex flex-col gap-2 rounded-xl bg-amber-50 p-4 dark:bg-amber-950">
          <h2 className="font-semibold">We need something from you</h2>
          <ul className="flex flex-col gap-1 text-sm">
            {home.waitingOnYou.map((a) => (
              <li key={a.id}>
                <strong>{a.title}:</strong> {a.todo ?? "see your actions page"}
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="flex flex-col gap-2">
        <div className="flex items-baseline justify-between gap-2">
          <h2 className="text-xl font-semibold">New for you</h2>
          <Link href="/report" className={`text-sm ${LINK}`}>
            Full report
          </Link>
        </div>
        {home.newestFindings.length === 0 ? (
          <p className="text-zinc-600 dark:text-zinc-400">Nothing new right now.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {home.newestFindings.map((f) => (
              <li key={f.id}>
                <Link
                  href={`/report/${f.id}`}
                  className="flex flex-wrap justify-between gap-2 rounded-lg border border-zinc-200 px-4 py-3 hover:bg-zinc-50 dark:border-zinc-800 dark:hover:bg-zinc-900"
                >
                  <span className="font-medium">{f.title}</span>
                  {f.annualSavingsCents !== null && (
                    <span className="text-sm text-zinc-600 dark:text-zinc-400">
                      {savingsPhrase(f.type, f.annualSavingsCents)}
                    </span>
                  )}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      {home.budgets && <BudgetList {...home.budgets} />}

      {home.goals.length > 0 && (
        <section className="flex flex-col gap-2">
          <div className="flex items-baseline justify-between gap-2">
            <h2 className="text-xl font-semibold">Your goals</h2>
            <Link href="/goals" className={`text-sm ${LINK}`}>
              All goals
            </Link>
          </div>
          <ul className="flex flex-col gap-1 text-sm">
            {home.goals.map((g) => (
              <li key={g.id} className="flex justify-between gap-2">
                <span>{g.name}</span>
                <span>{g.percent}%</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="flex flex-col gap-2">
        <div className="flex items-baseline justify-between gap-2">
          <h2 className="text-xl font-semibold">Coming up this month</h2>
          <Link href="/bills" className={`text-sm ${LINK}`}>
            All bills
          </Link>
        </div>
        {home.upcoming.length === 0 ? (
          <p className="text-zinc-600 dark:text-zinc-400">No regular charges expected.</p>
        ) : (
          <ul className="divide-y divide-zinc-200 rounded-xl border border-zinc-200 text-sm dark:divide-zinc-800 dark:border-zinc-800">
            {home.upcoming.map((c) => (
              <li key={`${c.merchant}-${c.date}`} className="flex justify-between gap-4 px-4 py-2">
                <span>
                  <span className="text-zinc-500">{shortDate(c.date)} · </span>
                  {c.merchant}
                </span>
                <span className="font-medium">{formatCents(c.amountCents)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <p className="text-xs text-zinc-500">
        {home.lastUpdated
          ? `Data last updated ${home.lastUpdated.toISOString().slice(0, 10)}.`
          : "Waiting for your first update."}{" "}
        <Link href="/connect" className="hover:underline">
          Manage accounts
        </Link>
      </p>
    </>
  );
}

export default function HomePage() {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-8 px-4 py-10 sm:px-6 sm:py-12">
      <Suspense fallback={<p className="text-zinc-500">Loading your summary…</p>}>
        <HomeContent />
      </Suspense>
    </main>
  );
}
