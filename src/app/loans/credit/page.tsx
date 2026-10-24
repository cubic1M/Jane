import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { AppHeader } from "@/components/app-header";
import { loadCredit, pullCredit } from "@/lib/credit";
import { loadCreditBuilding } from "@/lib/credit-building";
import { BuildCredit } from "./build-credit";
import { formatCents } from "@/lib/money";
import { requireUser } from "@/lib/session";
import { percent } from "@/planning/credit";
import { STAND_IN_LABEL } from "@/lib/jane-agent/credit-replies";
import { dayLabel } from "@/lib/day-label";
import { LoadingBar } from "@/components/loading-bar";

// The credit score (spec step 116): the score from Jane's monthly soft pull, what's helping
// and hurting, card use from the card balances, and what Jane is doing about it. The
// stand-in is labelled; nothing is pulled for a real account.

const LINK = "font-medium text-emerald-700 hover:underline";
const IMPACT = {
  helping: { word: "Helping", tone: "text-emerald-800 dark:text-emerald-200" },
  hurting: { word: "Hurting", tone: "text-amber-800 dark:text-amber-300" },
  neutral: { word: "Neither", tone: "text-zinc-600 dark:text-zinc-400" },
} as const;

async function CreditContent({ searchParams }: Pick<PageProps<"/loans/credit">, "searchParams">) {
  const user = await requireUser();
  await connection();
  let credit = await loadCredit(user.id);
  // Opened before Jane's first monthly pull: she pulls now (a soft pull).
  if (credit.available && !credit.latest) {
    await pullCredit(user.id);
    credit = await loadCredit(user.id);
  }
  const latest = credit.latest;
  // Spec step 175: building credit, from the same pull.
  const [building, raw] = await Promise.all([loadCreditBuilding(user.id), searchParams]);
  const param = (k: string) => {
    const v = raw[k];
    return Array.isArray(v) ? v[0] : v;
  };

  return (
    <>
      <AppHeader user={user} />
      <div className="flex flex-col gap-2">
        <h1 className="text-3xl font-semibold tracking-tight">Credit score</h1>
        <p className="text-zinc-600 dark:text-zinc-400">
          Jane checks it once a month with a soft pull, which never affects your score, and explains
          what moves it.
        </p>
      </div>
      {!credit.available || !latest ? (
        <p className="text-zinc-600 dark:text-zinc-400">
          A credit score comes from a credit partner, and there isn&apos;t one for your accounts
          yet. Nothing is pulled until there is.{" "}
          <Link href="/loans" className={LINK}>
            See every debt
          </Link>
        </p>
      ) : (
        <>
          {latest.demo && (
            <p
              role="note"
              className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-950 dark:text-amber-100"
            >
              {STAND_IN_LABEL}
            </p>
          )}
          <section aria-label="Your score" className="flex flex-col gap-1">
            <p className="text-5xl font-semibold">{latest.score}</p>
            <p className="text-sm text-zinc-600 dark:text-zinc-400">
              {latest.model}, checked {dayLabel(latest.pulledOn, { year: true })}
              {credit.previousScore !== null && credit.previousScore !== latest.score
                ? `: ${latest.score > credit.previousScore ? "up" : "down"} ${Math.abs(latest.score - credit.previousScore)} since last month`
                : ""}
              .
            </p>
          </section>
          <section aria-labelledby="factors" className="flex flex-col gap-2">
            <h2 id="factors" className="text-xl font-semibold">
              What&apos;s helping and hurting
            </h2>
            <ul aria-label="Factors" className="flex flex-col gap-2 text-sm">
              {latest.factors.map((f) => (
                <li
                  key={f.key}
                  className="rounded-xl border border-zinc-200 p-3 dark:border-zinc-800"
                >
                  <span className={`font-medium ${IMPACT[f.impact].tone}`}>
                    {IMPACT[f.impact].word}
                  </span>
                  : {f.label}. {f.detail}
                </li>
              ))}
            </ul>
          </section>
          {latest.utilisation && (
            <section aria-label="Card use" className="flex flex-col gap-1 text-sm">
              <h2 className="text-xl font-semibold">Card use</h2>
              <p>
                {percent(latest.utilisation.share)} of your card limits:{" "}
                {formatCents(latest.utilisation.balanceCents)} of{" "}
                {formatCents(latest.utilisation.limitCents)}.{" "}
                {latest.utilisation.toUnderHighCents > 0
                  ? `Paying ${formatCents(latest.utilisation.toUnderHighCents)} brings it under 30%; ${formatCents(latest.utilisation.toUnderGoodCents)} under 10%.`
                  : latest.utilisation.toUnderGoodCents > 0
                    ? `Paying ${formatCents(latest.utilisation.toUnderGoodCents)} brings it under 10%.`
                    : "That's low, which helps."}
              </p>
            </section>
          )}
          <section aria-labelledby="doing" className="flex flex-col gap-2 text-sm">
            <h2 id="doing" className="text-xl font-semibold">
              What Jane is doing about it
            </h2>
            <ul className="list-disc pl-5">
              {latest.doing.map((d) => (
                <li key={d}>{d}</li>
              ))}
            </ul>
          </section>
          {building.available && (
            <BuildCredit data={building} done={param("done")} error={param("error")} />
          )}
        </>
      )}
    </>
  );
}

export default function CreditPage({ searchParams }: PageProps<"/loans/credit">) {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-4 py-10 sm:px-6 sm:py-12">
      <Suspense fallback={<LoadingBar />}>
        <CreditContent searchParams={searchParams} />
      </Suspense>
    </main>
  );
}
