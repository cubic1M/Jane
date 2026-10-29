import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { AppHeader, PageLoading } from "@/components/app-header";
import { DemoAdviceLabel } from "@/components/demo-advice-label";
import { adviceMode } from "@/lib/advice-mode";
import { listBenefits, nextQuestion, openEnrollmentAtWork } from "@/lib/insurance/benefits";
import { latestCheckup } from "@/lib/insurance/checkups";
import { payrollFor } from "@/lib/insurance/payroll";
import { benefitLine, QUESTIONS } from "@/lib/jane-agent/insurance/benefit-words";
import { requireUser } from "@/lib/session";
import { answer, compareNow, confirm, notThis } from "./actions";
import { SubmitButton } from "@/components/submit-button";
import { dayLabel } from "@/lib/day-label";

// Benefits through work (spec step 150): what Jane found on the pay stub (confirmed with a
// tap), the cover the employer pays for (a few questions), the comparison with buying the
// same cover yourself, and open enrollment.

const LINK = "font-medium text-emerald-700 hover:underline";
const SMALL =
  "inline-flex h-9 items-center justify-center rounded-full border border-zinc-300 px-4 text-sm font-medium dark:border-zinc-700";
const PRIMARY =
  "inline-flex h-9 items-center justify-center rounded-full bg-emerald-700 px-4 text-sm font-semibold text-white hover:bg-emerald-800";

async function BenefitsContent() {
  const user = await requireUser();
  await connection();
  const [benefits, window, advice, review, payroll] = await Promise.all([
    listBenefits(user.id),
    openEnrollmentAtWork(user.id),
    adviceMode(user.id),
    latestCheckup(user.id),
    payrollFor(user.id),
  ]);
  const found = benefits.filter((b) => b.status === "found");
  const confirmed = benefits.filter((b) => b.status === "confirmed");
  const question = found.length === 0 ? nextQuestion(benefits) : null;
  const ready = review?.reason === "enrollment" ? review : null;

  return (
    <>
      <AppHeader user={user} />
      <Link href="/insurance" className={`text-sm ${LINK}`}>
        ← Insurance
      </Link>
      <div className="flex flex-col gap-2">
        <h1 className="text-3xl font-semibold tracking-tight">Benefits through work</h1>
        <p className="text-zinc-600 dark:text-zinc-400">
          The cover that comes with your job. Jane reads your pay stub on its own, compares each
          benefit with buying the same cover yourself, and gets ready for open enrollment. A benefit
          only counts once you confirm it, and enrolling is always yours to do.
        </p>
        {payroll?.demo && (
          <p
            role="note"
            className="rounded-lg bg-amber-50 p-3 text-sm text-amber-950 dark:bg-amber-950 dark:text-amber-50"
          >
            Sample pay stubs from the demo bank&apos;s employer, not real payroll data.
          </p>
        )}
        {window && (
          <p className="text-sm">
            Open enrollment at {window.employer}: {dayLabel(window.start, { year: true })} to{" "}
            {dayLabel(window.end, { year: true })}.
          </p>
        )}
      </div>

      {found.length > 0 && (
        <section aria-labelledby="found" className="flex flex-col gap-3">
          <h2 id="found" className="text-xl font-semibold">
            Found on your pay stub
          </h2>
          <ul className="flex flex-col gap-2">
            {found.map((b) => (
              <li
                key={b.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-zinc-200 p-3 text-sm [overflow-wrap:anywhere] dark:border-zinc-800"
              >
                <span>
                  {benefitLine(b)}
                  <span className="block text-xs text-zinc-500">
                    &ldquo;{b.label}&rdquo; on the pay stub
                  </span>
                </span>
                <span className="flex gap-2">
                  <form action={confirm}>
                    <input type="hidden" name="benefitId" value={b.id} />
                    <SubmitButton className={PRIMARY}>Confirm</SubmitButton>
                  </form>
                  <form action={notThis}>
                    <input type="hidden" name="benefitId" value={b.id} />
                    <SubmitButton className={SMALL}>Not this</SubmitButton>
                  </form>
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {question && (
        <section aria-labelledby="question" className="flex flex-col gap-3">
          <h2 id="question" className="text-xl font-semibold">
            A question about your job
          </h2>
          <p className="text-sm">{QUESTIONS[question].body}</p>
          <div className="flex flex-wrap gap-2">
            {QUESTIONS[question].actions.flatMap((a) => {
              if (a.kind === "link") return [];
              const value =
                a.id.split(/[._]/).at(-1) === "unsure" ? "unsure" : a.id.split("_").at(-1)!;
              return [
                <form key={a.id} action={answer}>
                  <input type="hidden" name="question" value={question} />
                  <input type="hidden" name="answer" value={value} />
                  <SubmitButton className={a.kind === "primary" ? PRIMARY : SMALL}>
                    {a.label}
                  </SubmitButton>
                </form>,
              ];
            })}
          </div>
        </section>
      )}

      <section aria-labelledby="confirmed" className="flex flex-col gap-3">
        <h2 id="confirmed" className="text-xl font-semibold">
          Your benefits
        </h2>
        {confirmed.length === 0 ? (
          <p className="text-zinc-600 dark:text-zinc-400">None confirmed yet.</p>
        ) : (
          <ul className="flex flex-col gap-1 text-sm">
            {confirmed.map((b) => (
              <li key={b.id}>{benefitLine(b)}</li>
            ))}
          </ul>
        )}
      </section>

      {advice && confirmed.length > 0 && (
        <section aria-labelledby="compare" className="flex flex-col gap-3">
          <h2 id="compare" className="text-xl font-semibold">
            Through work or on your own
          </h2>
          {ready ? (
            <ul className="flex flex-col gap-2">
              {ready.recommendations.map((r) => (
                <li
                  key={`${r.key}-${r.policyId ?? ""}`}
                  className="rounded-xl border border-zinc-200 p-3 text-sm dark:border-zinc-800"
                >
                  <p className="font-semibold">{r.title}</p>
                  <p>{r.cost}.</p>
                  <p className="text-zinc-600 dark:text-zinc-400">{r.risk}</p>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm">
              Jane compares each benefit with the same cover bought privately.
            </p>
          )}
          {ready && <DemoAdviceLabel />}
          <form action={compareNow}>
            <SubmitButton className={SMALL}>{ready ? "Compare again" : "Compare now"}</SubmitButton>
          </form>
        </section>
      )}
    </>
  );
}

export default function BenefitsPage() {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-4 py-10 sm:px-6 sm:py-12">
      <Suspense fallback={<PageLoading />}>
        <BenefitsContent />
      </Suspense>
    </main>
  );
}
