import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { AppHeader } from "@/components/app-header";
import { DemoAdviceLabel } from "@/components/demo-advice-label";
import { loadAccountPlan } from "@/lib/investments/accounts";
import { formatCents } from "@/lib/money";
import { requireUser } from "@/lib/session";
import { LoadingBar } from "@/components/loading-bar";

// The right account for each dollar (spec step 135): which account to fill first and why,
// where each holding is best kept, and gains and losses not yet realised in taxable
// accounts. The order and the moves are demo advice; the gains are facts for everyone.

const LINK = "font-medium text-emerald-700 hover:underline";

async function AccountsContent() {
  const user = await requireUser();
  await connection();
  const plan = await loadAccountPlan(user.id);

  return (
    <>
      <AppHeader user={user} />
      <div className="flex flex-col gap-2">
        <Link href="/investments" className={`text-sm ${LINK}`}>
          ← Investments
        </Link>
        <h1 className="text-3xl font-semibold tracking-tight">Which account first</h1>
        <p className="text-zinc-600 dark:text-zinc-400">
          The order to put money into your accounts, where each investment is best kept for tax, and
          what&apos;s gained or lost so far.
        </p>
      </div>

      {!plan.advice ? (
        <p className="text-zinc-600 dark:text-zinc-400">
          Jane&apos;s account order is only in demo advice mode for now.
        </p>
      ) : !plan.order ? (
        <p className="text-zinc-600 dark:text-zinc-400">
          The order depends on what the money is for.{" "}
          <Link href="/investments/profile" className={LINK}>
            Answer four quick questions
          </Link>
          .
        </p>
      ) : (
        <section className="flex flex-col gap-3 rounded-xl border border-amber-300 p-4 dark:border-amber-800">
          <h2 className="text-xl font-semibold">Fill them in this order</h2>
          <ol className="flex list-decimal flex-col gap-3 pl-5 text-sm">
            {plan.order.map((s) => (
              <li key={s.key}>
                <strong>{s.title}</strong>
                {s.roomCents !== null && ` (up to ${formatCents(s.roomCents)} a year)`}. {s.why}
              </li>
            ))}
          </ol>
          {plan.marginalRate === null && (
            <p className="text-xs text-zinc-500">
              Roth or traditional depends on your tax bracket.{" "}
              <Link href="/taxes/profile" className={LINK}>
                Fill in your tax profile
              </Link>{" "}
              and Jane will say which.
            </p>
          )}
          {plan.location.length > 0 && (
            <>
              <h3 className="font-semibold">Where to hold what</h3>
              <ul className="flex flex-col gap-2 text-sm">
                {plan.location.map((m) => (
                  <li key={m.holding.id}>
                    <strong>
                      {m.holding.name} ({m.accountName}) is better in {m.better}.
                    </strong>{" "}
                    {m.why}
                  </li>
                ))}
              </ul>
            </>
          )}
          <DemoAdviceLabel />
        </section>
      )}

      <section className="flex flex-col gap-2">
        <h2 className="text-xl font-semibold">Gains and losses not yet taxed</h2>
        {plan.gains.gainsCents === 0 && plan.gains.lossesCents === 0 ? (
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            Nothing in a taxable account yet.
          </p>
        ) : (
          <>
            <p className="text-sm">
              In your taxable accounts: {formatCents(plan.gains.gainsCents)} of gains and{" "}
              {formatCents(plan.gains.lossesCents)} of losses, from what you paid. They&apos;re
              taxed only when sold.
            </p>
            {plan.gains.losers.length > 0 && (
              <ul className="flex flex-col gap-1 text-sm text-zinc-600 dark:text-zinc-400">
                {plan.gains.losers.map((l) => (
                  <li key={`${l.accountName}-${l.name}`}>
                    {l.name} ({l.accountName}): down {formatCents(l.lossCents)}
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </section>
    </>
  );
}

export default function AccountsPage() {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-4 py-10 sm:px-6 sm:py-12">
      <Suspense fallback={<LoadingBar />}>
        <AccountsContent />
      </Suspense>
    </main>
  );
}
