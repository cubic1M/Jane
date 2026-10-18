import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { AppHeader } from "@/components/app-header";
import { ViewTracker } from "@/components/view-tracker";
import { DEADLINE_HORIZON_DAYS } from "@/config/deadlines";
import { isoDate } from "@/detection/units";
import {
  DEADLINE_KIND_LABELS,
  dueIn,
  groupDeadlines,
  shortDate,
  type Deadline,
} from "@/insights/deadlines";
import { listDeadlines } from "@/lib/deadlines";
import { formatCents } from "@/lib/money";
import { requireUser } from "@/lib/session";
import { finishDeadline, removeDeadline } from "./actions";
import { DeadlineForm } from "./deadline-form";

// Deadlines (spec step 71): return windows, trials, renewals, payments and the person's
// own dates, soonest first.

const LINK = "font-medium text-emerald-700 hover:underline";

function Row({ deadline, today }: { deadline: Deadline; today: string }) {
  return (
    <li className="flex flex-col gap-2 rounded-xl border border-zinc-200 p-4 [overflow-wrap:anywhere] dark:border-zinc-800">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div className="flex min-w-0 flex-col">
          <span className="text-xs font-medium tracking-wide text-zinc-500 uppercase">
            {DEADLINE_KIND_LABELS[deadline.kind]}
          </span>
          <span className="font-semibold">{deadline.title}</span>
        </div>
        <span className="text-sm">
          <span className="font-medium">{shortDate(deadline.date)}</span>
          <span className="text-zinc-500"> · {dueIn(deadline.date, today)}</span>
        </span>
      </div>
      {deadline.detail && (
        <p className="text-sm text-zinc-600 dark:text-zinc-400">{deadline.detail}</p>
      )}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
        {deadline.amountCents !== null && deadline.kind !== "return" && (
          <span>{formatCents(deadline.amountCents)}</span>
        )}
        {deadline.href && (
          <Link href={deadline.href} className={LINK}>
            {deadline.kind === "payment"
              ? "See the loan"
              : deadline.kind === "renewal"
                ? "See subscriptions"
                : "See the charge"}
          </Link>
        )}
        {deadline.entryId && (
          <>
            <form action={finishDeadline}>
              <input type="hidden" name="deadlineId" value={deadline.entryId} />
              <button type="submit" className={LINK}>
                Mark done
              </button>
            </form>
            <form action={removeDeadline}>
              <input type="hidden" name="deadlineId" value={deadline.entryId} />
              <button
                type="submit"
                className="text-zinc-500 hover:text-red-700 hover:underline"
                aria-label={`Delete ${deadline.title}`}
              >
                Delete
              </button>
            </form>
          </>
        )}
      </div>
    </li>
  );
}

async function DeadlinesContent() {
  const user = await requireUser();
  await connection();
  const now = new Date();
  const today = isoDate(now);
  const groups = groupDeadlines(await listDeadlines(user.id, { now }), today);

  return (
    <>
      <AppHeader email={user.email} />
      <ViewTracker event="deadlines_viewed" />
      <div className="flex flex-col gap-2">
        <h1 className="text-3xl font-semibold tracking-tight">Deadlines</h1>
        <p className="text-zinc-600 dark:text-zinc-400">
          Return windows, trials, renewals and payments Jane spots in your accounts, plus dates you
          add, for the next {DEADLINE_HORIZON_DAYS} days. Jane reminds you a few days before (
          <Link href="/settings#alerts" className={LINK}>
            change reminders
          </Link>
          ).
        </p>
      </div>

      {groups.length === 0 ? (
        <p className="text-zinc-600 dark:text-zinc-400">
          Nothing due in the next {DEADLINE_HORIZON_DAYS} days. Add an FSA deadline, a card benefit
          or a warranty below and it shows here.
        </p>
      ) : (
        groups.map((group) => (
          <section key={group.label} className="flex flex-col gap-3">
            <h2 className="text-xl font-semibold">{group.label}</h2>
            <ul className="flex flex-col gap-3">
              {group.deadlines.map((d) => (
                <Row key={d.key} deadline={d} today={today} />
              ))}
            </ul>
          </section>
        ))
      )}

      <section className="flex flex-col gap-3">
        <h2 className="text-xl font-semibold">Add a deadline</h2>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          An FSA deadline, a card benefit to use (like a travel credit by Dec 31), a warranty, or
          anything else with a date.
        </p>
        <DeadlineForm today={today} />
      </section>

      <p className="rounded-xl bg-zinc-100 p-4 text-sm text-zinc-700 dark:bg-zinc-900 dark:text-zinc-300">
        Return windows and trial dates are estimates from your charges; the shop&apos;s receipt or
        the company&apos;s terms have the exact date.
      </p>
    </>
  );
}

export default function DeadlinesPage() {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-4 py-10 sm:px-6 sm:py-12">
      <Suspense fallback={<p className="text-zinc-500">Loading…</p>}>
        <DeadlinesContent />
      </Suspense>
    </main>
  );
}
