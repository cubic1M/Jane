import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { AppHeader } from "@/components/app-header";
import { DemoAdviceLabel } from "@/components/demo-advice-label";
import { SimulatedBanner } from "@/components/simulated-banner";
import { SAFE_TO_SPEND_FLOOR_CENTS } from "@/config/auto-invest";
import { loadAutoInvest } from "@/lib/investments/auto-invest";
import { formatCents } from "@/lib/money";
import { requireUser } from "@/lib/session";
import { toggleAutoInvest } from "./actions";
import { AutoInvestForm } from "./auto-form";
import { SubmitButton } from "@/components/submit-button";
import { LoadingBar } from "@/components/loading-bar";
import { dayLabel } from "@/lib/day-label";

// Automatic investing (spec step 134): set it up once, see every payday's contribution
// (or why it was paused), pause and resume. Through the simulated brokerage, and said so.

const LINK = "font-medium text-emerald-700 hover:underline";

async function AutoContent({
  searchParams,
}: {
  searchParams: PageProps<"/investments/auto">["searchParams"];
}) {
  const user = await requireUser();
  await connection();
  const { saved } = await searchParams;
  const data = await loadAutoInvest(user.id);
  const account = data.accounts.find((a) => a.id === data.plan?.accountId);

  return (
    <>
      <AppHeader user={user} />
      <div className="flex flex-col gap-2">
        <Link href="/investments" className={`text-sm ${LINK}`}>
          ← Investments
        </Link>
        <h1 className="text-3xl font-semibold tracking-tight">Automatic investing</h1>
        <p className="text-zinc-600 dark:text-zinc-400">
          Every payday, Jane invests for you, but only what safe to spend doesn&apos;t need: Jane
          keeps at least {formatCents(SAFE_TO_SPEND_FLOOR_CENTS)} of it and pauses that payday by
          itself when it&apos;s low.
        </p>
      </div>
      <SimulatedBanner />
      {saved && (
        <p
          role="status"
          className="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-900 dark:bg-emerald-950 dark:text-emerald-100"
        >
          Saved.
        </p>
      )}

      {!data.advice ? (
        <p className="text-zinc-600 dark:text-zinc-400">
          Automatic investing is only in demo advice mode for now.
        </p>
      ) : !data.profileComplete ? (
        <p className="text-zinc-600 dark:text-zinc-400">
          First, four quick questions about what the money is for.{" "}
          <Link href="/investments/profile" className={LINK}>
            Answer them
          </Link>
          .
        </p>
      ) : data.accounts.length === 0 ? (
        <p className="text-zinc-600 dark:text-zinc-400">
          You need an investment account that isn&apos;t a workplace plan to invest into.
        </p>
      ) : (
        <>
          {data.plan && (
            <section className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-zinc-200 p-4 dark:border-zinc-800">
              <p className="text-sm">
                {data.plan.status === "active" ? "On" : "Paused"}:{" "}
                {data.plan.mode === "leftover"
                  ? "the rest after bills and goals"
                  : `${formatCents(data.plan.amountCents ?? 0)} every payday`}
                {account ? ` into ${account.name}` : ""}.
              </p>
              <form action={toggleAutoInvest}>
                <input
                  type="hidden"
                  name="status"
                  value={data.plan.status === "active" ? "paused" : "active"}
                />
                <SubmitButton className="h-11 rounded-lg border border-zinc-300 px-4 text-sm font-medium dark:border-zinc-700">
                  {data.plan.status === "active" ? "Pause" : "Resume"}
                </SubmitButton>
              </form>
            </section>
          )}
          <AutoInvestForm
            accounts={data.accounts}
            values={{
              mode: data.plan?.mode ?? "fixed",
              amount: String(
                ((data.plan?.amountCents ?? data.suggestion?.amountCents ?? 0) / 100).toFixed(2),
              ),
              accountId: data.plan?.accountId ?? data.suggestion?.accountId ?? data.accounts[0].id,
            }}
          />
          <DemoAdviceLabel />
        </>
      )}

      {data.runs.length > 0 && (
        <section className="flex flex-col gap-2">
          <h2 className="text-xl font-semibold">Every payday</h2>
          <ul className="flex flex-col gap-1 text-sm">
            {data.runs.map((r) => (
              <li key={r.id} className="flex flex-wrap justify-between gap-2">
                <span>
                  {dayLabel(r.paydayOn, { year: true })} ·{" "}
                  {r.status === "invested" ? "Invested (simulated)" : `Paused: ${r.reason ?? ""}`}
                </span>
                <span>{r.status === "invested" ? formatCents(r.amountCents) : "–"}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}

export default function AutoInvestPage(props: PageProps<"/investments/auto">) {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-4 py-10 sm:px-6 sm:py-12">
      <Suspense fallback={<LoadingBar />}>
        <AutoContent searchParams={props.searchParams} />
      </Suspense>
    </main>
  );
}
