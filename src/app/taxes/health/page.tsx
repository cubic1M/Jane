import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { AppHeader, PageLoading } from "@/components/app-header";
import { DemoAdviceLabel } from "@/components/demo-advice-label";
import { loadHealthTaxes } from "@/lib/health-taxes";
import { formatCents } from "@/lib/money";
import { requireUser } from "@/lib/session";

// The tax side of health insurance (spec step 269): a Marketplace credit against real income
// (a mid-year rise caught before it becomes a bill), HSA deposits against the limit, and medical
// costs against the 7.5% floor. Limits and thresholds are in src/config with their sources.

const LINK = "font-medium text-emerald-700 underline";
const CARD = "flex flex-col gap-3 rounded-xl border border-zinc-200 p-4 dark:border-zinc-800";

async function Content() {
  const user = await requireUser();
  await connection();
  const v = await loadHealthTaxes(user.id);
  const c = v.marketplace.check;
  const h = v.hsa;
  const m = v.medical;
  return (
    <>
      <AppHeader user={user} />
      <Link href="/taxes" className={`text-sm ${LINK}`}>
        ← Taxes
      </Link>
      <div className="flex flex-col gap-2">
        <h1 className="text-3xl font-semibold tracking-tight">Health insurance and taxes</h1>
        <p className="text-zinc-600 dark:text-zinc-400">
          Estimates from your accounts for you and a tax professional to check. Your income this
          year is on pace for {formatCents(v.pace.projectedCents)}.
        </p>
      </div>

      <section aria-labelledby="marketplace" className={CARD}>
        <h2 id="marketplace" className="text-xl font-semibold">
          Marketplace credit
        </h2>
        {!c ? (
          <p className="text-sm">
            {v.marketplace.payments > 0
              ? "You pay a Marketplace premium, and your income doesn't point to an advance credit to repay."
              : "I don't see premiums to a Marketplace plan this year."}
          </p>
        ) : (
          <>
            <p className="text-sm">
              Your income is at {Math.round(c.fplShare * 100)}% of the poverty line for a household
              of {v.householdSize}.{" "}
              {c.overCliff
                ? "Over 400% the credit stops, so an advance credit is repaid in full."
                : `The credit at that income is ${formatCents(c.allowedCents)}.`}{" "}
              Advance credit for the year: {formatCents(c.advanceCents)}
              {v.marketplace.told ? "" : " (worked out from your income early in the year)"}. Repaid
              with your return: <strong>{formatCents(c.repayCents)}</strong>, with no cap from 2026.
            </p>
            {v.advice && c.repayCents > 0 && (
              <>
                <p className="text-sm">
                  Updating your income on the Marketplace now lowers the advance for the rest of the
                  year; a pre-tax retirement contribution lowers the income it&apos;s judged on.
                </p>
                <DemoAdviceLabel />
              </>
            )}
          </>
        )}
      </section>

      <section aria-labelledby="hsa" className={CARD}>
        <h2 id="hsa" className="text-xl font-semibold">
          HSA
        </h2>
        <p className="text-sm">
          {h.deposits > 0
            ? `${formatCents(h.contributedCents)} in this year, about ${formatCents(h.projectedCents)} by December at this pace, against the ${formatCents(h.limitCents)} ${h.family ? "family" : "self-only"} limit.`
            : "No deposits to an HSA seen this year."}{" "}
          {h.projectedExcessCents > 0 &&
            `${formatCents(Math.max(h.excessCents, h.projectedExcessCents))} over costs a 6% penalty (${formatCents(h.exciseCents)}) each year it stays in, unless it's taken out, with what it earned, before you file.`}
        </p>
      </section>

      <section aria-labelledby="medical" className={CARD}>
        <h2 id="medical" className="text-xl font-semibold">
          Medical costs
        </h2>
        <p className="text-sm">
          {m.spentCents > 0
            ? `${formatCents(m.spentCents)} so far this year, with health premiums. Only what's over ${formatCents(m.floorCents)} (7.5% of your income) counts, and only if you itemize: ${
                m.deductibleCents === 0
                  ? `you're ${formatCents(m.toFloorCents)} under it.`
                  : m.itemizing
                    ? `that's ${formatCents(m.deductibleCents)}, which with your other deductions beats the ${formatCents(m.standardCents)} standard deduction, saving about ${formatCents(m.savesCents)}.`
                    : `that's ${formatCents(m.deductibleCents)}, but the ${formatCents(m.standardCents)} standard deduction is still bigger.`
              }`
            : "No medical costs seen this year."}
        </p>
      </section>
    </>
  );
}

export default function HealthTaxesPage() {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-4 py-10 sm:px-6 sm:py-12">
      <Suspense fallback={<PageLoading />}>
        <Content />
      </Suspense>
    </main>
  );
}
