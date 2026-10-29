import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { AppHeader, PageLoading } from "@/components/app-header";
import { DemoAdviceLabel } from "@/components/demo-advice-label";
import { S_CORP } from "@/config/business-structure";
import { loadBusinessStructure } from "@/lib/business-structure";
import { formatCents } from "@/lib/money";
import { requireUser } from "@/lib/session";

// Business owners' tax structure (spec step 267): the qualified business income deduction,
// whether an S corporation would save more than it costs (demo advice), and the home office
// and miles on file.

const LINK = "font-medium text-emerald-700 underline";
const CARD = "flex flex-col gap-3 rounded-xl border border-zinc-200 p-4 dark:border-zinc-800";

async function Content() {
  const user = await requireUser();
  await connection();
  const v = await loadBusinessStructure(user.id);
  const s = v.structure;
  return (
    <>
      <AppHeader user={user} />
      <Link href="/taxes" className={`text-sm ${LINK}`}>
        ← Taxes
      </Link>
      <div className="flex flex-col gap-2">
        <h1 className="text-3xl font-semibold tracking-tight">Business taxes</h1>
        <p className="text-zinc-600 dark:text-zinc-400">
          Your qualified business income deduction, whether an S corporation would save more than it
          costs at your profit, and the home office and miles on file. Estimates for you and a tax
          professional to check.
        </p>
      </div>
      {!s ? (
        <p className="text-sm">I don&apos;t see profit from self-employment this year.</p>
      ) : (
        <>
          <section aria-labelledby="sole" className={CARD}>
            <h2 id="sole" className="text-xl font-semibold">
              As you are
            </h2>
            <p className="text-sm">
              Profit {formatCents(s.profitCents)}; federal tax about {formatCents(s.sole.taxCents)}.{" "}
              {s.sole.qbiLimited
                ? "Your income is above the line where the 20% deduction is simple."
                : `Your qualified business income deduction is about ${formatCents(s.sole.qbiCents)}, worth roughly ${formatCents(s.sole.qbiSavesCents)} of tax.`}
            </p>
          </section>
          {v.advice && (
            <section aria-labelledby="scorp" className={CARD}>
              <h2 id="scorp" className="text-xl font-semibold">
                As an S corporation
              </h2>
              <ul className="list-disc pl-5 text-sm">
                <li>
                  Salary range to start from: {formatCents(s.sCorp.salaryLowCents)} to{" "}
                  {formatCents(s.sCorp.salaryHighCents)} (the IRS looks at what the work would pay
                  someone else).
                </li>
                <li>
                  Income tax {formatCents(s.sCorp.incomeTaxCents)} plus payroll tax{" "}
                  {formatCents(s.sCorp.payrollTaxCents)}.
                </li>
                <li>
                  Costs: payroll service, the corporate return and state filing,{" "}
                  {formatCents(s.sCorp.costsCents)}.
                </li>
                <li>
                  {s.sCorp.worthIt
                    ? `About ${formatCents(s.sCorp.savesCents)} a year less than now.`
                    : `Not worth it at this profit (it needs to save at least ${formatCents(S_CORP.minSavingCents)}).`}
                </li>
              </ul>
              <DemoAdviceLabel />
            </section>
          )}
        </>
      )}
      <section aria-labelledby="deductions" className={CARD}>
        <h2 id="deductions" className="text-xl font-semibold">
          Home office and miles
        </h2>
        <p className="text-sm">
          {v.homeOffice.sqft
            ? `Home office: ${v.homeOffice.sqft} sq ft, a ${formatCents(v.homeOffice.deductionCents)} deduction.`
            : "No home office on file."}{" "}
          {v.mileage.miles > 0
            ? `Business miles: ${v.mileage.miles}, a ${formatCents(v.mileage.deductionCents)} deduction.`
            : "No business miles logged."}{" "}
          <Link href="/taxes/profile" className={LINK}>
            Add them
          </Link>
        </p>
      </section>
    </>
  );
}

export default function BusinessPage() {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-4 py-10 sm:px-6 sm:py-12">
      <Suspense fallback={<PageLoading />}>
        <Content />
      </Suspense>
    </main>
  );
}
