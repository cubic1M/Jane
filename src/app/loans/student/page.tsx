import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { AppHeader } from "@/components/app-header";
import { DemoAdviceLabel } from "@/components/demo-advice-label";
import { STUDENT_SOURCES, STUDENT_STEPS } from "@/config/student-loans";
import { formatCents } from "@/lib/money";
import { requireUser } from "@/lib/session";
import { loadStudentLoans } from "@/lib/student-loans";
import { PLAN_NAMES } from "@/planning/student-loans";
import { loadStudentLongGame } from "@/lib/student-long-game";
import { saveProfile, stepDone } from "./actions";
import { LongGameSection } from "./long-game";
import { SubmitButton } from "@/components/submit-button";
import { LoadingBar } from "@/components/loading-bar";
import { formatRate } from "@/lib/percent";

// Student loans (spec step 114): the federal plans compared at the person's income, from
// the plans' published rules; forgiveness tracking; and studentaid.gov's steps, each with
// its official page. Changing plans happens on studentaid.gov.

const LINK = "font-medium text-emerald-700 hover:underline";
const INPUT =
  "h-11 w-full rounded-lg border border-zinc-300 bg-transparent px-3 text-base dark:border-zinc-700";

async function StudentContent({
  searchParams,
}: {
  searchParams: PageProps<"/loans/student">["searchParams"];
}) {
  const user = await requireUser();
  await connection();
  const params = await searchParams;
  const [data, game] = await Promise.all([loadStudentLoans(user.id), loadStudentLongGame(user.id)]);
  const error = typeof params.error === "string" ? params.error : "";
  const { loan, comparison, profile } = data;

  return (
    <>
      <AppHeader user={user} />
      <div className="flex flex-col gap-2">
        <h1 className="text-3xl font-semibold tracking-tight">Student loans</h1>
        <p className="text-zinc-600 dark:text-zinc-400">
          The federal repayment plans compared at your income, from their published rules (
          <a href={STUDENT_SOURCES.plans} className={LINK}>
            studentaid.gov
          </a>
          ), your progress toward forgiveness, and the official steps to switch.
        </p>
      </div>
      {params.saved === "1" && (
        <p role="status" className="text-sm text-emerald-800 dark:text-emerald-200">
          Saved. The plans are worked out again with it.
        </p>
      )}

      {!loan || !comparison ? (
        <p className="text-zinc-600 dark:text-zinc-400">
          No federal student loan with a balance and rate yet.{" "}
          <Link href="/loans" className={LINK}>
            See every debt
          </Link>
        </p>
      ) : (
        <>
          <section aria-labelledby="plans" className="flex flex-col gap-3">
            <h2 id="plans" className="text-xl font-semibold">
              Plans compared
            </h2>
            <p className="text-sm text-zinc-600 dark:text-zinc-400">
              {loan.name}: {formatCents(loan.balanceCents!)} at {formatRate(loan.aprBps!)}. At{" "}
              {formatCents(data.agiCents)} a year{" "}
              {data.agiFrom === "you"
                ? "(the income you gave)"
                : "(estimated from your paychecks: give your tax return's income below for a closer number)"}
              , income unchanged.
            </p>
            <table className="w-full text-left text-sm">
              <caption className="sr-only">Repayment plans</caption>
              <thead>
                <tr className="text-zinc-500">
                  <th scope="col" className="py-1 font-normal">
                    Plan
                  </th>
                  <th scope="col" className="py-1 font-normal">
                    A month now
                  </th>
                  <th scope="col" className="py-1 font-normal">
                    In all
                  </th>
                  <th scope="col" className="py-1 font-normal">
                    Forgiven
                  </th>
                </tr>
              </thead>
              <tbody>
                {comparison.results.map((r) => (
                  <tr key={r.plan} className="border-t border-zinc-200 dark:border-zinc-800">
                    <td className="py-1">{PLAN_NAMES[r.plan]}</td>
                    <td className="py-1">{formatCents(r.monthlyNowCents)}</td>
                    <td className="py-1">{formatCents(r.totalPaidCents)}</td>
                    <td className="py-1">
                      {r.forgivenCents > 0
                        ? `${formatCents(r.forgivenCents)}${r.viaPslf ? " (PSLF)" : ""}`
                        : "–"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {comparison.pick ? (
              <div className="flex flex-col gap-1 rounded-lg bg-emerald-50 p-3 text-sm dark:bg-emerald-950">
                <p className="font-medium">Jane&apos;s pick: {PLAN_NAMES[comparison.pick.plan]}</p>
                {comparison.pick.why.map((line) => (
                  <p key={line}>{line}</p>
                ))}
                <DemoAdviceLabel />
              </div>
            ) : (
              <p className="text-xs text-zinc-500">This is math, not a recommendation.</p>
            )}
            <p className="text-xs text-zinc-500">
              Rules from{" "}
              <a href={STUDENT_SOURCES.servicerPlans} className={LINK}>
                the plans as studentaid.gov&apos;s servicers describe them
              </a>{" "}
              and{" "}
              <a href={STUDENT_SOURCES.povertyGuidelines} className={LINK}>
                the 2026 poverty guidelines
              </a>
              . The Loan Simulator on studentaid.gov uses your exact loans.
            </p>
          </section>

          <section aria-labelledby="forgiveness" className="flex flex-col gap-2 text-sm">
            <h2 id="forgiveness" className="text-xl font-semibold">
              Toward forgiveness
            </h2>
            <p>
              {data.paymentsCounted} of {data.countingToward.needed} qualifying payments toward{" "}
              {data.countingToward.name}: {profile.countedBefore} counted before, and{" "}
              {data.paymentsSeen} Jane has seen you make. studentaid.gov&apos;s count is the one
              that counts.
            </p>
          </section>
        </>
      )}

      {game.available && <LongGameSection game={game} saved={params.dates === "1"} error={error} />}

      <section id="about-you" aria-labelledby="about" className="flex flex-col gap-3">
        <h2 id="about" className="text-xl font-semibold">
          About you
        </h2>
        {error && (
          <p role="alert" className="text-sm text-amber-800 dark:text-amber-300">
            {error}
          </p>
        )}
        <form action={saveProfile} className="grid gap-3 text-sm sm:grid-cols-2">
          <label className="flex flex-col gap-1 font-medium">
            Income from your last tax return ($)
            <input
              name="agi"
              inputMode="decimal"
              className={INPUT}
              defaultValue={profile.agiCents === null ? "" : (profile.agiCents / 100).toFixed(0)}
            />
          </label>
          <label className="flex flex-col gap-1 font-medium">
            Family size
            <input
              name="familySize"
              inputMode="numeric"
              className={INPUT}
              defaultValue={profile.familySize}
            />
          </label>
          <label className="flex flex-col gap-1 font-medium">
            Dependants
            <input
              name="dependants"
              inputMode="numeric"
              className={INPUT}
              defaultValue={profile.dependants}
            />
          </label>
          <label className="flex flex-col gap-1 font-medium">
            First federal loan
            <select name="borrower" className={INPUT} defaultValue={profile.borrower}>
              <option value="new">On or after July 1, 2014</option>
              <option value="old">Before July 1, 2014</option>
            </select>
          </label>
          <label className="flex flex-col gap-1 font-medium">
            Qualifying payments already counted
            <input
              name="countedBefore"
              inputMode="numeric"
              className={INPUT}
              defaultValue={profile.countedBefore}
            />
          </label>
          <label className="flex items-center gap-2 font-medium">
            <input
              type="checkbox"
              name="publicService"
              defaultChecked={profile.publicService}
              className="h-5 w-5"
            />
            I work full time in public service
          </label>
          <SubmitButton className="h-11 self-start rounded-full bg-emerald-700 px-5 font-medium text-white hover:bg-emerald-800">
            Save
          </SubmitButton>
        </form>
      </section>

      <section id="steps" aria-labelledby="steps-title" className="flex flex-col gap-2">
        <h2 id="steps-title" className="text-xl font-semibold">
          Steps on studentaid.gov
        </h2>
        <ol aria-label="Steps on studentaid.gov" className="flex flex-col gap-2 text-sm">
          {STUDENT_STEPS.map((s, i) => (
            <li key={s.key} className={i < profile.stepsDone ? "text-zinc-500" : ""}>
              <a href={s.url} className={LINK}>
                {i + 1}. {s.title}
              </a>
              {i < profile.stepsDone ? " (done)" : ""}
              <span className="block">{s.does}</span>
            </li>
          ))}
        </ol>
        {profile.stepsDone < STUDENT_STEPS.length && (
          <form action={stepDone}>
            <SubmitButton className={LINK}>
              I&apos;ve done step {profile.stepsDone + 1}
            </SubmitButton>
          </form>
        )}
      </section>
    </>
  );
}

export default function StudentLoansPage({ searchParams }: PageProps<"/loans/student">) {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-4 py-10 sm:px-6 sm:py-12">
      <Suspense fallback={<LoadingBar />}>
        <StudentContent searchParams={searchParams} />
      </Suspense>
    </main>
  );
}
