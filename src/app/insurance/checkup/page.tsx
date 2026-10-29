import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { AppHeader, PageLoading } from "@/components/app-header";
import { DemoAdviceLabel } from "@/components/demo-advice-label";
import { CHECKUP_EVERY_DAYS } from "@/config/insurance";
import { adviceMode } from "@/lib/advice-mode";
import { latestCheckup, markCheckupSeen } from "@/lib/insurance/checkups";
import { requireUser } from "@/lib/session";
import { checkAgain } from "./actions";
import { SubmitButton } from "@/components/submit-button";

// The coverage checkup (spec step 106): Jane's recommendations on the person's cover, each
// with what it costs or saves and the risk it changes. Demo advice only, labelled.

const LINK = "font-medium text-emerald-700 hover:underline";
const BUTTON =
  "inline-flex h-11 items-center justify-center rounded-full bg-emerald-700 px-6 font-semibold text-white hover:bg-emerald-800";

const dateLabel = (date: Date) =>
  date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });

async function CheckupContent() {
  const user = await requireUser();
  await connection();
  const [advice, checkup] = await Promise.all([adviceMode(user.id), latestCheckup(user.id)]);
  // Opening the page counts as seeing it.
  if (advice && checkup && !checkup.seenAt) await markCheckupSeen(user.id, checkup.id);

  return (
    <>
      <AppHeader user={user} />
      <Link href="/insurance" className={`text-sm ${LINK}`}>
        ← Insurance
      </Link>
      <div className="flex flex-col gap-2">
        <h1 className="text-3xl font-semibold tracking-tight">Coverage checkup</h1>
        <p className="text-zinc-600 dark:text-zinc-400">
          Whether you have the right amount of cover: deductibles that fit your savings, too little
          or too much cover, bundling, and cover that no longer fits. Jane runs it on its own every{" "}
          {Math.round(CHECKUP_EVERY_DAYS / 30)} months and after a life event. Nothing changes
          unless you say so.
        </p>
      </div>
      {!advice ? (
        <p>
          The checkup recommends changes, so for now it&apos;s only for the demo bank&apos;s sample
          data. Your{" "}
          <Link href="/insurance" className={LINK}>
            insurance page
          </Link>{" "}
          still shows what each policy covers and what looks missing.
        </p>
      ) : (
        <>
          {!checkup ? (
            <p>No checkup yet. Add a policy, or check now.</p>
          ) : (
            <section aria-labelledby="recs" className="flex flex-col gap-3">
              <h2 id="recs" className="text-xl font-semibold">
                {checkup.recommendations.length === 0
                  ? "Nothing to change"
                  : `${checkup.recommendations.length} ${checkup.recommendations.length === 1 ? "thing" : "things"} worth a look`}
              </h2>
              <p className="text-sm text-zinc-500">Checked {dateLabel(checkup.createdAt)}.</p>
              <ul className="flex flex-col gap-3">
                {checkup.recommendations.map((r) => (
                  <li
                    key={`${r.key}-${r.policyId ?? ""}`}
                    className="flex flex-col gap-1 rounded-xl border border-zinc-200 p-4 [overflow-wrap:anywhere] dark:border-zinc-800"
                  >
                    <h3 className="font-semibold">{r.title}</h3>
                    <p className="text-sm font-medium">{r.cost}.</p>
                    <p className="text-sm text-zinc-600 dark:text-zinc-400">{r.risk}</p>
                  </li>
                ))}
              </ul>
              <DemoAdviceLabel />
            </section>
          )}
          <form action={checkAgain}>
            <SubmitButton className={BUTTON}>Check again</SubmitButton>
          </form>
        </>
      )}
    </>
  );
}

export default function CheckupPage() {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-4 py-10 sm:px-6 sm:py-12">
      <Suspense fallback={<PageLoading />}>
        <CheckupContent />
      </Suspense>
    </main>
  );
}
