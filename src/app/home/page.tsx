import Link from "next/link";
import { redirect } from "next/navigation";
import { after } from "next/server";
import { Suspense } from "react";
import { AppHeader } from "@/components/app-header";
import { BudgetList } from "@/components/budget-list";
import { firstWeekChecklist, recordChecklistProgress } from "@/lib/checklist";
import { homeSummary } from "@/lib/home";
import type { SafeToSpend } from "@/planning/safe-to-spend";
import { formatCents } from "@/lib/money";
import { requireUser } from "@/lib/session";
import { savingsPhrase } from "@/lib/savings-text";
import { FirstWeekChecklist } from "./checklist";
import { AutopilotChooser } from "@/components/autopilot-chooser";
import { autopilotOf } from "@/lib/autopilot";
import { janeDidSomething, type JaneDid } from "@/lib/what-jane-did";

const CARD = "flex flex-col gap-1 rounded-xl border border-zinc-200 p-4 dark:border-zinc-800";
const LINK = "font-medium text-emerald-700 hover:underline";

function shortDate(iso: string): string {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

function SafeToSpendCard({ safe }: { safe: SafeToSpend }) {
  const short = safe.safeCents < 0;
  const rows: [string, number][] = [
    ["Checking balance today", safe.balanceCents],
    [
      `Regular bills from checking before ${safe.payday ? shortDate(safe.payday) : "then"}`,
      -safe.billsCents,
    ],
    ["Left in this month's budgets", -safe.budgetsLeftCents],
    ["Toward your goals this month", -safe.goalsCents],
  ];
  return (
    <section className="flex flex-col gap-2 rounded-xl border border-zinc-200 p-4 dark:border-zinc-800">
      <h2 className="text-sm text-zinc-600 dark:text-zinc-400">
        {safe.payday ? `Safe to spend until ${shortDate(safe.payday)}` : "Safe to spend"}
      </h2>
      <p className={`text-3xl font-semibold ${short ? "text-red-700" : ""}`}>
        {short ? `Short by ${formatCents(-safe.safeCents)}` : formatCents(safe.safeCents)}
      </p>
      {!safe.payday && (
        <p className="text-xs text-zinc-500">
          We don&apos;t see a deposit coming in the next month, so this covers the month&apos;s
          bills.
        </p>
      )}
      <details>
        <summary className="cursor-pointer text-sm font-medium text-emerald-700">
          How we worked it out
        </summary>
        <ul className="mt-2 flex flex-col gap-1 text-sm">
          {rows.map(([label, cents]) => (
            <li key={label} className="flex justify-between gap-2">
              <span>{label}</span>
              <span>{cents < 0 ? `−${formatCents(-cents)}` : formatCents(cents)}</span>
            </li>
          ))}
        </ul>
        <p className="mt-2 text-xs text-zinc-500">
          Bills are estimates from your past charges. This is math, not a recommendation.
        </p>
      </details>
    </section>
  );
}

// The action agent's week, in plain words. Money only from confirmed outcomes.
function JaneDidCard({ did }: { did: JaneDid }) {
  const lines = [
    did.finished.length > 0 &&
      `Finished ${did.finished.length} ${did.finished.length === 1 ? "thing" : "things"}${
        did.confirmedCents > 0
          ? `, with ${formatCents(did.confirmedCents)} confirmed back or saved`
          : ""
      }.`,
    did.contacts > 0 &&
      `Wrote or called ${did.contacts} ${did.contacts === 1 ? "time" : "times"} on your behalf.`,
    did.working > 0 && `Still working on ${did.working}.`,
  ].filter(Boolean) as string[];
  return (
    <section className="flex flex-col gap-2 rounded-xl border border-zinc-200 p-4 dark:border-zinc-800">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-semibold">What Jane did this week</h2>
        <Link href="/actions" className={`text-sm ${LINK}`}>
          See every step
        </Link>
      </div>
      {lines.length > 0 && (
        <ul className="flex flex-col gap-1 text-sm">
          {lines.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      )}
      {did.waiting.length > 0 && (
        <p className="rounded-lg bg-amber-50 p-3 text-sm dark:bg-amber-950">
          <strong>Waiting on you:</strong> {did.waiting.map((w) => w.title).join("; ")}
        </p>
      )}
    </section>
  );
}

async function HomeContent() {
  const user = await requireUser();
  const home = await homeSummary(user.id);
  if (!home) redirect("/connect");
  const checklist = await firstWeekChecklist(user.id);
  const autopilot = await autopilotOf(user.id);
  if (checklist?.newlyDone.length) {
    after(() => recordChecklistProgress(user.id, checklist));
  }

  return (
    <>
      <AppHeader email={user.email} />
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="text-3xl font-semibold tracking-tight">How you&apos;re doing</h1>
        <span className="flex flex-wrap gap-x-3 gap-y-1 text-sm">
          <Link href="/net-worth" className={LINK}>
            Net worth
          </Link>
          <Link href="/loans" className={LINK}>
            Loans
          </Link>
          <Link href="/budgets" className={LINK}>
            Budgets
          </Link>
          <Link href="/goals" className={LINK}>
            Goals
          </Link>
          <Link href="/subscriptions" className={LINK}>
            Subscriptions
          </Link>
          <Link href="/check-in" className={LINK}>
            Monthly check-in
          </Link>
          <Link href="/year" className={LINK}>
            Year in review
          </Link>
          <Link href="/life-events" className={LINK}>
            Life events
          </Link>
          <Link href="/tax-pack" className={LINK}>
            Tax-time pack
          </Link>
        </span>
      </div>

      {autopilot === null && <AutopilotChooser />}

      {checklist && !checklist.complete && <FirstWeekChecklist items={checklist.items} />}

      {home.plan.items > 0 && (
        <Link
          href="/plan"
          className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-emerald-700 p-4 font-semibold text-white hover:bg-emerald-800"
        >
          <span>
            Jane&apos;s plan: {home.plan.items} {home.plan.items === 1 ? "thing" : "things"} to say
            yes or no to
          </span>
          <span className="text-sm">Review your plan ›</span>
        </Link>
      )}

      {janeDidSomething(home.janeDid) && <JaneDidCard did={home.janeDid} />}

      {home.safeToSpend && <SafeToSpendCard safe={home.safeToSpend} />}

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
