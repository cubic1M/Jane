import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { AppHeader } from "@/components/app-header";
import { DemoAdviceLabel } from "@/components/demo-advice-label";
import { SimulatedBanner } from "@/components/simulated-banner";
import { HSA_LIMITS } from "@/config/hsa";
import { loadHsa } from "@/lib/investments/hsa";
import { formatCents } from "@/lib/money";
import { requireUser } from "@/lib/session";
import { investHsa, linkHsa, reimburse } from "./actions";

// The HSA as an investment (spec step 159): cash and invested, the cash cushion, room under
// the limit, and the receipts vault of medical charges to pay back tax-free later.

const LINK = "font-medium text-emerald-700 hover:underline";
const BUTTON = "h-11 rounded-lg bg-emerald-700 px-5 font-medium text-white hover:bg-emerald-800";
const day = (iso: string) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });

async function HsaContent({
  searchParams,
}: {
  searchParams: PageProps<"/investments/hsa">["searchParams"];
}) {
  const user = await requireUser();
  await connection();
  const { done } = await searchParams;
  const hsa = await loadHsa(user.id);

  return (
    <>
      <AppHeader user={user} />
      <div className="flex flex-col gap-2">
        <Link href="/investments" className={`text-sm ${LINK}`}>
          ← Investments
        </Link>
        <h1 className="text-3xl font-semibold tracking-tight">HSA</h1>
        <p className="text-zinc-600 dark:text-zinc-400">
          The account with three tax breaks: money goes in before tax, grows untaxed and comes out
          tax-free for health costs, even years later.
        </p>
      </div>
      {done === "invested" && <SimulatedBanner />}
      {!hsa.account ? (
        hsa.demo ? (
          <form action={linkHsa} className="flex flex-col gap-2">
            <p className="text-sm text-zinc-600 dark:text-zinc-400">
              No HSA linked. Try a demo one.
            </p>
            <button type="submit" className={`${BUTTON} self-start`}>
              Link a demo HSA
            </button>
          </form>
        ) : (
          <p className="text-zinc-600 dark:text-zinc-400">No HSA linked yet.</p>
        )
      ) : (
        <section className="flex flex-col gap-3 rounded-xl border border-zinc-200 p-4 dark:border-zinc-800">
          <h2 className="text-xl font-semibold">
            {hsa.account.name}: {formatCents(hsa.account.balanceCents)}
          </h2>
          {hsa.plan && (
            <>
              <p className="text-sm">
                {formatCents(hsa.plan.cashCents)} in cash, {formatCents(hsa.plan.investedCents)}{" "}
                invested. A cushion of {formatCents(hsa.plan.cushionCents)} stays in cash for this
                year&apos;s health costs.
              </p>
              <p className="text-sm">
                The {HSA_LIMITS.year} limit for {hsa.coverage === "family" ? "family" : "self-only"}{" "}
                cover is {formatCents(hsa.plan.limitCents)}; there&apos;s{" "}
                {formatCents(hsa.plan.roomCents)} of room left
                {hsa.plan.roomCents > 0
                  ? `, about ${formatCents(hsa.plan.perPaycheckCents)} a paycheck`
                  : ""}
                .
              </p>
              {hsa.advice && hsa.plan.toInvestCents > 0 && (
                <form
                  action={investHsa}
                  className="flex flex-col gap-2 rounded-lg border border-amber-300 p-3 dark:border-amber-800"
                >
                  <p className="text-sm">
                    Invest the {formatCents(hsa.plan.toInvestCents)} beyond the cushion in a
                    low-cost index fund, through the simulated brokerage (no real money moves).
                  </p>
                  <button type="submit" className={`${BUTTON} self-start`}>
                    Invest {formatCents(hsa.plan.toInvestCents)}
                  </button>
                  <DemoAdviceLabel />
                </form>
              )}
            </>
          )}
          <p className="text-xs text-zinc-500">Limits: {HSA_LIMITS.source}.</p>
        </section>
      )}

      <section className="flex flex-col gap-2">
        <h2 className="text-xl font-semibold">Receipts vault</h2>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          Medical costs Jane found in your transactions. Paid out of pocket now, they can be paid
          back from an HSA tax-free later. {formatCents(hsa.savedCents)} saved so far.
        </p>
        {hsa.receipts.length === 0 ? (
          <p className="text-sm text-zinc-500">None yet.</p>
        ) : (
          <ul className="flex flex-col gap-2 text-sm">
            {hsa.receipts.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center justify-between gap-2">
                <span>
                  {day(r.date)} · {r.merchant} ·{" "}
                  <Link href={`/transactions?q=${encodeURIComponent(r.merchant)}`} className={LINK}>
                    the charge
                  </Link>
                </span>
                <span className="flex items-center gap-2">
                  {formatCents(r.amountCents)}
                  {r.status === "saved" ? (
                    <form action={reimburse}>
                      <input type="hidden" name="receiptId" value={r.id} />
                      <button
                        type="submit"
                        className="text-xs font-medium text-emerald-700 hover:underline"
                      >
                        Mark paid back
                      </button>
                    </form>
                  ) : (
                    <span className="text-xs text-zinc-500">paid back</span>
                  )}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}

export default function HsaPage(props: PageProps<"/investments/hsa">) {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-4 py-10 sm:px-6 sm:py-12">
      <Suspense fallback={<p className="text-zinc-500">Loading…</p>}>
        <HsaContent searchParams={props.searchParams} />
      </Suspense>
    </main>
  );
}
