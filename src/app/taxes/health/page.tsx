import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { AppHeader } from "@/components/app-header";
import { formatCents } from "@/lib/money";
import { loadHealthTaxes } from "@/lib/health-taxes";
import { requireUser } from "@/lib/session";

// The tax side of health insurance (spec step 269): the Marketplace credit against real
// income, HSA contributions against their limit, and medical costs against the 7.5% floor.

const LINK = "font-medium text-emerald-700 underline";
const CARD = "flex flex-col gap-3 rounded-xl border border-zinc-200 p-4 dark:border-zinc-800";

async function Content() {
  const user = await requireUser();
  await connection();
  const v = await loadHealthTaxes(user.id);
  const c = v.marketplace.check;
  return (
    <>
      <AppHeader user={user} />
      <Link href="/taxes" className={`text-sm ${LINK}`}>
        ← Taxes
      </Link>
      <div className="flex flex-col gap-2">
        <h1 className="text-3xl font-semibold tracking-tight">Health insurance and taxes</h1>
        <p className="text-zinc-600 dark:text-zinc-400">
          Estimates for you and a tax professional to check. Limits and thresholds are in
          Jane&apos;s config with their sources.
        </p>
      </div>
      <section aria-labelledby="marketplace" className={CARD}>
        <h2 id="marketplace" className="text-xl font-semibold">
          Marketplace credit
        </h2>
        {!c ? (
          <p className="text-sm">I don&apos;t see premiums to a Marketplace plan this year.</p>
        ) : (
          <p className="text-sm">
            Your income is at {Math.round(c.fplShare * 100)}% of the poverty line for a household of{" "}
            {v.marketplace.householdSize}.{" "}
            {c.overCliff
              ? "Above 400% the credit stops, so any advance credit is repaid in full."
              : c.repayCents > 0
                ? `The advance credit may be about ${formatCents(c.repayCents)} too large.`
                : "Your advance credit looks in line with your income."}{" "}
            {v.marketplace.told
              ? ""
              : "I used typical amounts for your credit and plan premium; tell me yours on the profile page."}
          </p>
        )}
      </section>
      <section aria-labelledby="hsa" className={CARD}>
        <h2 id="hsa" className="text-xl font-semibold">
          HSA
        </h2>
        <p className="text-sm">
          {v.hsa.contributedCents > 0
            ? `${formatCents(v.hsa.contributedCents)} in this year against a limit of ${formatCents(v.hsa.limitCents)}${v.hsa.excessCents > 0 ? `: ${formatCents(v.hsa.excessCents)} is over.` : "."}`
            : "No contributions seen this year."}
        </p>
      </section>
      <section aria-labelledby="medical" className={CARD}>
        <h2 id="medical" className="text-xl font-semibold">
          Medical costs
        </h2>
        <p className="text-sm">
          {v.medical.spentCents > 0
            ? `${formatCents(v.medical.spentCents)} so far; only what is over ${formatCents(v.medical.floorCents)} counts, and only if you itemize.`
            : "None seen this year."}
        </p>
      </section>
    </>
  );
}

export default function HealthPage() {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-4 py-10 sm:px-6 sm:py-12">
      <Suspense fallback={<p className="text-zinc-500">Loading…</p>}>
        <Content />
      </Suspense>
    </main>
  );
}
