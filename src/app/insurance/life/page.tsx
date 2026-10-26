import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { AppHeader } from "@/components/app-header";
import { DemoAdviceLabel } from "@/components/demo-advice-label";
import { PREMIUM_FREQUENCIES } from "@/config/documents";
import { LIFE_HEALTH_QUESTIONS } from "@/config/insurance";
import { sizeLife } from "@/lib/insurance/life";
import { methodLines } from "@/lib/insurance/life-need";
import { nextLifeQuestion } from "@/lib/insurance/life-underwriting";
import {
  NOT_NEEDED,
  askingStep,
  bestQuote,
  decisionStep,
} from "@/lib/jane-agent/insurance/life-words";
import { formatCents } from "@/lib/money";
import { requireUser } from "@/lib/session";
import { answer, apply, buy, notNow, setDependants, submit } from "./actions";
import { SubmitButton } from "@/components/submit-button";
import { LoadingBar } from "@/components/loading-bar";

// Life cover (spec step 153), demo advice only: how much and for how long, with the method;
// term quotes; the application's health questions one at a time; the carrier's decision.
// Applying, sending and buying are each the person's own tap.

const LINK = "font-medium text-emerald-700 hover:underline";
const PRIMARY =
  "inline-flex h-10 items-center justify-center rounded-full bg-emerald-700 px-5 text-sm font-semibold text-white hover:bg-emerald-800";
const SMALL =
  "inline-flex h-10 items-center justify-center rounded-full border border-zinc-300 px-5 text-sm font-medium dark:border-zinc-700";

const Hidden = ({ id }: { id: string }) => <input type="hidden" name="applicationId" value={id} />;

async function LifeContent({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const user = await requireUser();
  await connection();
  const { error } = await searchParams;
  const now = new Date();
  const sized = await sizeLife(user.id, { now });
  const application =
    sized.kind === "sized" || sized.kind === "in_progress" ? sized.application : null;

  return (
    <>
      <AppHeader user={user} />
      <Link href="/insurance" className={`text-sm ${LINK}`}>
        ← Insurance
      </Link>
      <div className="flex flex-col gap-2">
        <h1 className="text-3xl font-semibold tracking-tight">Life cover</h1>
        <p className="text-zinc-600 dark:text-zinc-400">
          How much term life insurance your family would need, worked out from your own numbers,
          with quotes. Jane never applies or buys without your tap.
        </p>
      </div>
      {error && (
        <p role="alert" className="text-red-700 dark:text-red-400">
          {error}
        </p>
      )}

      {sized.kind === "no_advice" && (
        <p>
          Jane can&apos;t recommend an amount of life insurance on your real accounts yet:
          that&apos;s advice, which it&apos;ll only give once a licensed partner is connected.
        </p>
      )}
      {sized.kind === "ask_dependants" && (
        <form action={setDependants} className="flex flex-wrap items-end gap-3">
          <label htmlFor="dependants" className="flex flex-col gap-1 text-sm font-medium">
            How many people depend on your income?
            <select
              id="dependants"
              name="dependants"
              defaultValue="1"
              className="h-10 rounded-lg border border-zinc-300 bg-transparent px-3 dark:border-zinc-700"
            >
              <option value="0">No one</option>
              <option value="1">1 person</option>
              <option value="2">2 people</option>
              <option value="3">3 or more</option>
            </select>
          </label>
          <SubmitButton className={PRIMARY}>Work it out</SubmitButton>
        </form>
      )}
      {sized.kind === "not_needed" && <p>{NOT_NEEDED[sized.reason].replace(/^Thanks\. /, "")}</p>}
      {sized.kind === "dismissed" && (
        <p>You said not now. Jane will bring it up again if your numbers change.</p>
      )}

      {application && (
        <section className="flex flex-col gap-3" aria-labelledby="need">
          <h2 id="need" className="text-xl font-semibold">
            {formatCents(application.amountCents)} for {application.termYears} years
          </h2>
          <ul className="flex flex-col gap-1 text-sm">
            {methodLines({ ...application, lines: application.method }).map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
          <DemoAdviceLabel />
        </section>
      )}

      {application?.status === "sized" && (
        <section className="flex flex-col gap-3" aria-labelledby="quotes">
          <h2 id="quotes" className="text-xl font-semibold">
            Term quotes
          </h2>
          {application.quotes.length === 0 || !bestQuote(application, now.toISOString()) ? (
            <p className="text-sm">No quotes right now. Jane will try again.</p>
          ) : (
            <ul className="flex flex-col gap-3">
              {application.quotes
                .filter((q) => q.expiresAt > now.toISOString())
                .map((q) => (
                  <li
                    key={q.partnerQuoteId}
                    className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-zinc-200 p-4 dark:border-zinc-800"
                  >
                    <span>
                      <span className="font-medium">{q.carrier.name}</span>{" "}
                      {formatCents(q.premiumCents)} {PREMIUM_FREQUENCIES[q.premiumFrequency].label}
                      <span className="block text-xs text-zinc-600 dark:text-zinc-400">
                        Rated {q.carrier.rating}. Before their health questions.
                      </span>
                    </span>
                    <form action={apply}>
                      <Hidden id={application.id} />
                      <input type="hidden" name="quoteId" value={q.partnerQuoteId} />
                      <SubmitButton className={SMALL}>Apply</SubmitButton>
                    </form>
                  </li>
                ))}
            </ul>
          )}
          {application.quotes.some((q) => q.demo) && (
            <p className="text-xs text-zinc-600 dark:text-zinc-400">
              Sample quotes from Jane&apos;s demo carrier catalog. Not real insurance.
            </p>
          )}
          <form action={notNow}>
            <Hidden id={application.id} />
            <SubmitButton className={`text-sm ${LINK}`}>Not now</SubmitButton>
          </form>
        </section>
      )}

      {application?.status === "asking" && (
        <section className="flex flex-col gap-3" aria-labelledby="questions">
          <h2 id="questions" className="text-xl font-semibold">
            Your application
          </h2>
          <p>{askingStep(application).body}</p>
          {(() => {
            const key = nextLifeQuestion(application.answers);
            if (!key) {
              return (
                <form action={submit}>
                  <Hidden id={application.id} />
                  <SubmitButton className={PRIMARY}>Send application</SubmitButton>
                </form>
              );
            }
            return (
              <div className="flex gap-3">
                {(["yes", "no"] as const).map((value) => (
                  <form key={value} action={answer}>
                    <Hidden id={application.id} />
                    <input type="hidden" name="question" value={key} />
                    <input type="hidden" name="answer" value={value} />
                    <SubmitButton className={value === "no" ? PRIMARY : SMALL}>
                      {value === "yes" ? "Yes" : "No"}
                    </SubmitButton>
                  </form>
                ))}
              </div>
            );
          })()}
          <p className="text-xs text-zinc-600 dark:text-zinc-400">
            {LIFE_HEALTH_QUESTIONS.length} questions. Your answers go only to the carrier you
            picked.
          </p>
        </section>
      )}

      {(application?.status === "offered" || application?.status === "referred") && (
        <section className="flex flex-col gap-3" aria-labelledby="decision">
          <h2 id="decision" className="text-xl font-semibold">
            The carrier&apos;s answer
          </h2>
          {decisionStep(application)
            .body.split("\n")
            .map((line) => (
              <p key={line}>{line}</p>
            ))}
          {application.status === "offered" && (
            <div className="flex gap-3">
              <form action={buy}>
                <Hidden id={application.id} />
                <SubmitButton className={PRIMARY}>Buy it</SubmitButton>
              </form>
              <form action={notNow}>
                <Hidden id={application.id} />
                <SubmitButton className={SMALL}>No thanks</SubmitButton>
              </form>
            </div>
          )}
        </section>
      )}
    </>
  );
}

export default function LifePage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-4 py-10 sm:px-6 sm:py-12">
      <Suspense fallback={<LoadingBar />}>
        <LifeContent searchParams={searchParams} />
      </Suspense>
    </main>
  );
}
