import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { AppHeader } from "@/components/app-header";
import { DemoAdviceLabel } from "@/components/demo-advice-label";
import { SimulatedBanner } from "@/components/simulated-banner";
import { SUDDEN_KINDS } from "@/config/sudden-money";
import { loadSuddenMoney } from "@/lib/investments/sudden-money";
import { formatCents } from "@/lib/money";
import { requireUser } from "@/lib/session";
import { answerKind, demoDeposit, stage } from "./actions";
import { SubmitButton } from "@/components/submit-button";
import { LoadingBar } from "@/components/loading-bar";

// Sudden money (spec step 235, demo advice): a bonus, an inheritance or a sale, with a staged
// plan. Tax set aside first; every part is your tap.

const LINK = "font-medium text-emerald-700 hover:underline";
const BUTTON = "h-11 rounded-lg bg-emerald-700 px-5 font-medium text-white hover:bg-emerald-800";
const SECONDARY =
  "h-11 rounded-lg border border-zinc-300 px-5 font-medium hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-900";

async function Content({
  searchParams,
}: {
  searchParams: PageProps<"/investments/sudden-money">["searchParams"];
}) {
  const user = await requireUser();
  await connection();
  const { done } = await searchParams;
  const v = await loadSuddenMoney(user.id);
  return (
    <>
      <AppHeader user={user} />
      <div className="flex flex-col gap-2">
        <Link href="/investments" className={`text-sm ${LINK}`}>
          ← Investments
        </Link>
        <h1 className="text-3xl font-semibold tracking-tight">Sudden money</h1>
        <p className="text-zinc-600 dark:text-zinc-400">
          When a lot of money arrives that isn&apos;t pay, there&apos;s a good order to use it in:
          tax first, then high-interest debt, the emergency fund, your retirement limits, your
          goals, and last investing.
        </p>
      </div>
      {done && (
        <p
          role="status"
          className="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-900 dark:bg-emerald-950 dark:text-emerald-100"
        >
          {done === "moved"
            ? "Done through the stand-ins (no real money moves)."
            : "That changed since you last looked."}
        </p>
      )}
      {v.items.length === 0 && (
        <p className="text-zinc-600 dark:text-zinc-400">No large deposit to plan.</p>
      )}
      {v.items.map((i) => (
        <section
          key={i.id}
          className="flex flex-col gap-3 rounded-xl border border-zinc-200 p-4 dark:border-zinc-800"
        >
          <h2 className="text-xl font-semibold">
            {formatCents(i.amountCents)} deposited {i.depositedOn}
          </h2>
          {!i.kind ? (
            <form action={answerKind} className="flex flex-wrap items-center gap-2">
              <input type="hidden" name="id" value={i.id} />
              <span className="text-sm">What was it?</span>
              {Object.entries(SUDDEN_KINDS).map(([k, label]) => (
                <SubmitButton key={k} name="kind" value={k} className={SECONDARY}>
                  {label}
                </SubmitButton>
              ))}
              <SubmitButton name="kind" value="transfer" className={SECONDARY}>
                Just a transfer
              </SubmitButton>
            </form>
          ) : (
            <>
              {i.tax && (
                <p className="text-sm">
                  {SUDDEN_KINDS[i.kind]}. {i.tax.note}{" "}
                  <span className="text-xs text-zinc-500">({i.tax.source}.)</span>
                </p>
              )}
              <ol className="flex flex-col gap-2 text-sm">
                {i.stages.map((s, n) => {
                  const ready = !s.done && i.stages.slice(0, n).every((x) => x.done);
                  return (
                    <li key={s.key} className="flex flex-wrap items-center gap-3">
                      <span>
                        {n + 1}. {s.title}: {formatCents(s.cents)}.{" "}
                        <span className="text-zinc-500">{s.note}</span>
                      </span>
                      {s.done ? (
                        <span className="text-emerald-700">Done</span>
                      ) : v.advice && ready ? (
                        <form action={stage}>
                          <input type="hidden" name="id" value={i.id} />
                          <input type="hidden" name="stage" value={s.key} />
                          <SubmitButton className={BUTTON}>Do this part</SubmitButton>
                        </form>
                      ) : null}
                    </li>
                  );
                })}
              </ol>
              {i.cushionMonths !== null && (
                <p className="text-sm">
                  Your cash would cover about {i.cushionMonths} months of spending once the money to
                  invest and the retirement part have gone.
                </p>
              )}
              <SimulatedBanner />
              <DemoAdviceLabel />
            </>
          )}
        </section>
      ))}
      {v.demo && v.items.length === 0 && (
        <form action={demoDeposit}>
          <SubmitButton className={BUTTON}>Add a demo bonus deposit</SubmitButton>
        </form>
      )}
    </>
  );
}

export default function SuddenMoneyPage(props: PageProps<"/investments/sudden-money">) {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-4 py-10 sm:px-6 sm:py-12">
      <Suspense fallback={<LoadingBar />}>
        <Content searchParams={props.searchParams} />
      </Suspense>
    </main>
  );
}
