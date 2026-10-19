import Link from "next/link";
import { redirect } from "next/navigation";
import { after, connection } from "next/server";
import { Suspense } from "react";
import { AppHeader } from "@/components/app-header";
import { firstWeekChecklist, recordChecklistProgress } from "@/lib/checklist";
import { homeSummary, type HomeSummary } from "@/lib/home";
import type { ComingUpRow } from "@/insights/coming-up";
import type { SafeToSpend } from "@/planning/safe-to-spend";
import { formatCents } from "@/lib/money";
import { requireUser } from "@/lib/session";
import { FirstWeekChecklist } from "./checklist";
import { AutopilotChooser } from "@/components/autopilot-chooser";
import { autopilotOf } from "@/lib/autopilot";
import { janeDidSomething, type JaneDid } from "@/lib/what-jane-did";

// Today (spec step 79): only what needs the person now. Everything else Jane found is on
// the Jane tab, the picture of their money on Money, and planning on Ahead.

const LINK = "font-medium text-emerald-700 hover:underline";
const SECTION = "flex flex-col gap-2";
const HEADING_ROW = "flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1";

function shortDate(iso: string): string {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

const things = (n: number) => `${n} ${n === 1 ? "thing" : "things"}`;

function PlanCard({ plan }: { plan: HomeSummary["plan"] }) {
  if (plan.items === 0) {
    return (
      <section className="flex flex-col gap-1 rounded-xl border border-zinc-200 p-4 dark:border-zinc-800">
        <h2 className="font-semibold">Jane&apos;s plan this week</h2>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          Nothing to approve right now. Jane keeps watching and adds to your plan when it finds
          something.
        </p>
      </section>
    );
  }
  return (
    <section className="flex flex-col gap-3 rounded-xl bg-emerald-700 p-5 text-white">
      <div className="flex flex-col gap-1">
        <h2 className="text-sm font-medium text-emerald-50">Jane&apos;s plan this week</h2>
        <p className="text-2xl font-semibold">
          {plan.annualSavingsCents > 0
            ? `${things(plan.items)}, could save ${formatCents(plan.annualSavingsCents)} a year`
            : things(plan.items)}
        </p>
      </div>
      <Link
        href="/plan"
        className="inline-flex h-11 items-center justify-center self-start rounded-full bg-white px-6 font-semibold text-emerald-900 hover:bg-emerald-50"
      >
        Review and approve
      </Link>
    </section>
  );
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
    // Spec step 70: yearly and irregular bills, as this month's share.
    ...(safe.setAsideCents > 0
      ? [["Set aside for yearly bills", -safe.setAsideCents] as [string, number]]
      : []),
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

function NeedsYou({
  waiting,
  unreadAlerts,
}: {
  waiting: HomeSummary["waitingOnYou"];
  unreadAlerts: number;
}) {
  if (waiting.length === 0 && unreadAlerts === 0) return null;
  return (
    <section className="flex flex-col gap-2 rounded-xl bg-amber-50 p-4 dark:bg-amber-950">
      <h2 className="font-semibold">Needs you</h2>
      <ul className="flex flex-col gap-2 text-sm">
        {waiting.map((a) => (
          <li key={a.id}>
            <strong>{a.title}:</strong> {a.todo ?? "see your actions."}{" "}
            <Link href="/actions" className="font-medium text-emerald-800 hover:underline">
              Open
            </Link>
          </li>
        ))}
        {unreadAlerts > 0 && (
          <li>
            <Link href="/alerts" className="font-medium text-emerald-800 hover:underline">
              {unreadAlerts === 1 ? "1 new alert" : `${unreadAlerts} new alerts`}
            </Link>
          </li>
        )}
      </ul>
    </section>
  );
}

function daysLeft(days: number): string {
  if (days === 0) return "Today";
  return days === 1 ? "1 day left" : `${days} days left`;
}

function ComingUp({ rows }: { rows: ComingUpRow[] }) {
  return (
    <section className={SECTION}>
      <div className={HEADING_ROW}>
        <h2 className="text-xl font-semibold">Coming up</h2>
        <span className="flex gap-3 text-sm">
          <Link href="/bills" className={LINK}>
            All bills
          </Link>
          <Link href="/deadlines" className={LINK}>
            All deadlines
          </Link>
        </span>
      </div>
      {rows.length === 0 ? (
        <p className="text-zinc-600 dark:text-zinc-400">Nothing due in the next month.</p>
      ) : (
        <ul className="divide-y divide-zinc-200 rounded-xl border border-zinc-200 text-sm dark:divide-zinc-800 dark:border-zinc-800">
          {rows.map((row) => (
            <li key={row.key}>
              <Link
                href={row.href}
                className="flex min-h-11 items-center justify-between gap-4 px-4 py-2 hover:bg-zinc-50 dark:hover:bg-zinc-900"
              >
                <span className="min-w-0 [overflow-wrap:anywhere]">
                  <span className="text-zinc-500">{shortDate(row.date)} · </span>
                  {row.label}
                </span>
                <span className="shrink-0 font-medium">
                  {row.amountCents === null ? daysLeft(row.daysLeft) : formatCents(row.amountCents)}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

// The action agent's week, in plain words. Money only from confirmed outcomes. What waits
// on the person is under "Needs you".
function JaneDidCard({ did }: { did: JaneDid }) {
  const lines = [
    did.finished.length > 0 &&
      `Finished ${things(did.finished.length)}${
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
      <div className={HEADING_ROW}>
        <h2 className="font-semibold">What Jane did this week</h2>
        <Link href="/actions" className={`text-sm ${LINK}`}>
          See every step
        </Link>
      </div>
      <ul className="flex flex-col gap-1 text-sm">
        {lines.map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>
    </section>
  );
}

// Money found, saved and in progress, in one quiet line.
function Totals({ home }: { home: HomeSummary }) {
  return (
    <p className="text-sm text-zinc-600 dark:text-zinc-400">
      Jane found <span className="font-semibold">{formatCents(home.moneyFoundCents)}</span> a year
      to look at · <span className="font-semibold">{formatCents(home.savedToDateCents)}</span> a
      year saved so far
      {home.openActions > 0 && (
        <>
          {" "}
          ·{" "}
          <Link href="/actions" className={LINK}>
            {home.openActions} in progress
          </Link>
        </>
      )}
    </p>
  );
}

async function HomeContent() {
  await connection();
  const user = await requireUser();
  const home = await homeSummary(user.id);
  if (!home) redirect("/connect");
  const checklist = await firstWeekChecklist(user.id);
  const autopilot = await autopilotOf(user.id);
  if (checklist?.newlyDone.length) {
    after(() => recordChecklistProgress(user.id, checklist));
  }
  const did = { ...home.janeDid, waiting: [] };

  return (
    <>
      <AppHeader user={user} />
      <div className="flex flex-col gap-1">
        <h1 className="text-3xl font-semibold tracking-tight">Today</h1>
        <Totals home={home} />
      </div>

      {autopilot === null && <AutopilotChooser />}

      <PlanCard plan={home.plan} />

      {home.safeToSpend && <SafeToSpendCard safe={home.safeToSpend} />}

      <NeedsYou waiting={home.waitingOnYou} unreadAlerts={home.unreadAlerts} />

      <ComingUp rows={home.comingUp} />

      {janeDidSomething(did) && <JaneDidCard did={did} />}

      {checklist && !checklist.complete && <FirstWeekChecklist items={checklist.items} />}

      {home.newToDecide > 0 && (
        <Link href="/jane" className={`self-start ${LINK}`}>
          {home.newToDecide} new {home.newToDecide === 1 ? "thing" : "things"} to decide ›
        </Link>
      )}

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
