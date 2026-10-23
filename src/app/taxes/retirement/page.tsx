import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { AppHeader } from "@/components/app-header";
import { DemoAdviceLabel } from "@/components/demo-advice-label";
import { RETIREMENT_PAYCHECK_HREF, retirementLines } from "@/lib/jane-agent/retirement-tax-message";
import { loadRetirementTaxes } from "@/lib/retirement-taxes";
import { requireUser } from "@/lib/session";

// Taxes on retirement income (spec step 271): how much of Social Security is taxable and what
// nothing withholds, Medicare's surcharge line two years ahead, and (demo advice) the order to
// draw tuned to stay under it. The same lines as the chat's answer (retirementLines).

const LINK = "font-medium text-emerald-700 underline";
const CARD = "flex flex-col gap-3 rounded-xl border border-zinc-200 p-4 dark:border-zinc-800";

async function Content() {
  const user = await requireUser();
  await connection();
  const { lines, tuned } = retirementLines(await loadRetirementTaxes(user.id));
  return (
    <>
      <AppHeader user={user} />
      <Link href="/taxes" className={`text-sm ${LINK}`}>
        ← Taxes
      </Link>
      <div className="flex flex-col gap-2">
        <h1 className="text-3xl font-semibold tracking-tight">Taxes on retirement income</h1>
        <p className="text-zinc-600 dark:text-zinc-400">
          Social Security, Medicare&apos;s income surcharge and the order to draw from your
          accounts, from your own deposits. Estimates for you and a tax professional to check; Jane
          moves no money and changes no withholding.
        </p>
      </div>
      <section aria-labelledby="retirement-heading" className={CARD}>
        <h2 id="retirement-heading" className="text-xl font-semibold">
          How your retirement income is taxed
        </h2>
        <ul className="flex list-disc flex-col gap-2 pl-5 text-sm">
          {lines.map((l) => (
            <li key={l}>{l}</li>
          ))}
        </ul>
        {tuned && <DemoAdviceLabel />}
        <Link href={RETIREMENT_PAYCHECK_HREF} className={`text-sm ${LINK}`}>
          See my retirement paycheck
        </Link>
      </section>
    </>
  );
}

export default function RetirementTaxesPage() {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-4 py-10 sm:px-6 sm:py-12">
      <Suspense fallback={<p className="text-zinc-500">Loading…</p>}>
        <Content />
      </Suspense>
    </main>
  );
}
