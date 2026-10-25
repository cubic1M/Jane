import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { AppHeader } from "@/components/app-header";
import { Assumptions } from "@/components/assumptions";
import { DemoAdviceLabel } from "@/components/demo-advice-label";
import {
  LIMITS_SOURCE,
  LIMITS_YEAR,
  RETIREMENT_AGE_SOURCE,
  TARGET_SOURCE,
  WITHDRAWAL_RATE,
  WITHDRAWAL_SOURCE,
  EMPLOYEE_DEFERRAL_LIMIT_CENTS,
  RETIREMENT_AGE,
  TARGET_TIMES_PAY,
} from "@/config/retirement";
import { adviceMode } from "@/lib/advice-mode";
import { loadRetirement } from "@/lib/investments/retirement";
import { formatCents } from "@/lib/money";
import { requireUser } from "@/lib/session";
import { ROTH_WORDS, type Range } from "@/planning/retirement";
import { LoadingBar } from "@/components/loading-bar";

// On track for retirement? (spec step 132, demo advice). What the retirement accounts
// could grow to by 67 as a range in today's dollars, against a target; the match, Roth or
// traditional, catch-up, and what to change. Every assumption is listed with its source.

const LINK = "font-medium text-emerald-700 hover:underline";
const CARD = "flex flex-col gap-1 rounded-xl border border-zinc-200 p-4 dark:border-zinc-800";
const span = (r: Range) => `${formatCents(r.lowCents)} to ${formatCents(r.highCents)}`;
const STATUS = {
  on_track: "On track, even at the low end",
  maybe: "On track only if returns are good",
  behind: "Behind, even if returns are good",
  unknown: "Not known: Jane doesn't know your pay",
} as const;

async function RetirementContent() {
  const user = await requireUser();
  await connection();
  const [{ profile, balanceCents, accounts, retirement }, advice] = await Promise.all([
    loadRetirement(user.id),
    adviceMode(user.id),
  ]);

  return (
    <>
      <AppHeader user={user} />
      <div className="flex flex-col gap-2">
        <Link href="/investments" className={`text-sm ${LINK}`}>
          ← Investments
        </Link>
        <h1 className="text-3xl font-semibold tracking-tight">Retirement</h1>
        <p className="text-zinc-600 dark:text-zinc-400">
          What your retirement accounts could grow to, as a range in today&apos;s dollars. A range,
          never a promise.
        </p>
      </div>

      {accounts.length === 0 ? (
        <p className="text-zinc-600 dark:text-zinc-400">
          No retirement accounts yet. Link a 401(k) or IRA and Jane can plan with it.
        </p>
      ) : !advice ? (
        <p className="text-zinc-600 dark:text-zinc-400">
          In your retirement accounts ({accounts.join(", ")}): {formatCents(balanceCents)}.
          Jane&apos;s retirement planner is only in demo advice mode for now.
        </p>
      ) : !profile.complete || !retirement ? (
        <p className="text-zinc-600 dark:text-zinc-400">
          First, four quick questions, including your age.{" "}
          <Link href="/investments/profile" className={LINK}>
            Answer them
          </Link>
          .
        </p>
      ) : (
        <>
          <section className="grid gap-3 sm:grid-cols-2">
            <div className={CARD}>
              <span className="text-sm text-zinc-600 dark:text-zinc-400">
                By {retirement.retirementAge}, in today&apos;s dollars
              </span>
              <span className="text-2xl font-semibold">{span(retirement.projection)}</span>
              <span className="text-xs text-zinc-500">
                From {formatCents(balanceCents)} now and what goes in each year
              </span>
            </div>
            <div className={CARD}>
              <span className="text-sm text-zinc-600 dark:text-zinc-400">Could pay out a year</span>
              <span className="text-2xl font-semibold">{span(retirement.yearlyIncome)}</span>
              <span className="text-xs text-zinc-500">At {WITHDRAWAL_RATE * 100}% a year</span>
            </div>
          </section>
          {retirement.targetCents !== null && (
            <p className="text-sm">
              Target: <strong>{formatCents(retirement.targetCents)}</strong> ({TARGET_TIMES_PAY}{" "}
              times your pay). <strong>{STATUS[retirement.status]}.</strong>
            </p>
          )}
          {retirement.match && (
            <p className="text-sm">
              Your employer match:{" "}
              {retirement.match.captured
                ? "you get all of it."
                : `you put in ${Math.round(retirement.match.employeeRate * 1000) / 10}% of your pay and miss about ${formatCents(retirement.match.missedCents)} a year.`}
            </p>
          )}

          <section className="flex flex-col gap-3 rounded-xl border border-amber-300 p-4 dark:border-amber-800">
            <h2 className="text-xl font-semibold">What to change</h2>
            {retirement.changes.length === 0 ? (
              <p className="text-sm">Nothing: keep going as you are.</p>
            ) : (
              <ol className="flex list-decimal flex-col gap-3 pl-5 text-sm">
                {retirement.changes.map((c) => (
                  <li key={c.what}>
                    <strong>{c.what}</strong> {c.why}
                  </li>
                ))}
              </ol>
            )}
            {retirement.rothOrTraditional && (
              <p className="text-sm">{ROTH_WORDS[retirement.rothOrTraditional]}</p>
            )}
            <p className="text-sm text-zinc-600 dark:text-zinc-400">
              Room left this year: {formatCents(retirement.roomCents)} (the {LIMITS_YEAR} limit is{" "}
              {formatCents(EMPLOYEE_DEFERRAL_LIMIT_CENTS)}
              {retirement.catchUpCents > 0
                ? `, plus ${formatCents(retirement.catchUpCents)} catch-up at your age`
                : ""}
              ).
            </p>
            <DemoAdviceLabel />
          </section>

          <Assumptions
            extra={[
              {
                label: "Retirement age",
                value: String(RETIREMENT_AGE),
                source: RETIREMENT_AGE_SOURCE,
              },
              { label: "Target", value: `${TARGET_TIMES_PAY} times pay`, source: TARGET_SOURCE },
              {
                label: "Paying out",
                value: `${WITHDRAWAL_RATE * 100}% a year`,
                source: WITHDRAWAL_SOURCE,
              },
              {
                label: "Limits",
                value: formatCents(EMPLOYEE_DEFERRAL_LIMIT_CENTS),
                source: LIMITS_SOURCE,
              },
              {
                label: "Contributions",
                value: "the last 12 months, kept up with inflation",
                source: "Your accounts' contribution records",
              },
            ]}
          />
        </>
      )}
    </>
  );
}

export default function RetirementPage() {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-4 py-10 sm:px-6 sm:py-12">
      <Suspense fallback={<LoadingBar />}>
        <RetirementContent />
      </Suspense>
    </main>
  );
}
