import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { AppHeader, PageLoading } from "@/components/app-header";
import { DemoAdviceLabel } from "@/components/demo-advice-label";
import { IRS_DIRECT_PAY_URL } from "@/config/tax";
import { HOME_OFFICE_SIMPLIFIED, MILEAGE_RATE_CENTS } from "@/config/tax-rates";
import { formatCents } from "@/lib/money";
import { loadSelfEmployed } from "@/lib/self-employed";
import { requireUser } from "@/lib/session";
import { roundDollars } from "@/planning/tax-estimate-copy";
import { HelperForm } from "./helper-form";
import { dayLabel } from "@/lib/day-label";

// Freelance taxes (spec step 123): business expenses, the home office and mileage helpers,
// what to set aside from each payment and the estimated tax payments left (demo advice).

const CARD = "flex flex-col gap-3 rounded-xl border border-zinc-200 p-4 dark:border-zinc-800";
const LINK = "font-medium text-emerald-700 hover:underline";

async function Content() {
  const user = await requireUser();
  await connection();
  const now = new Date();
  const v = await loadSelfEmployed(user.id, { now });
  return (
    <>
      <AppHeader user={user} />
      <div className="flex flex-col gap-2">
        <h1 className="text-3xl font-semibold tracking-tight">Freelance taxes: {v.year}</h1>
        <p className="text-zinc-600 dark:text-zinc-400">
          {v.active
            ? `${formatCents(v.freelanceInCents)} of freelance or gig income so far this year.`
            : "No freelance or gig income in your accounts this year."}
        </p>
      </div>

      <section aria-labelledby="business" className={CARD}>
        <h2 id="business" className="text-xl font-semibold">
          Business expenses
        </h2>
        <p className="text-sm">
          {formatCents(v.businessCents)} tagged so far.{" "}
          <Link href="/taxes/tags" className={LINK}>
            Tag business expenses
          </Link>
        </p>
      </section>

      <section aria-labelledby="office" className={CARD}>
        <h2 id="office" className="text-xl font-semibold">
          Home office
        </h2>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          Part of your home used only for this work:{" "}
          {formatCents(HOME_OFFICE_SIMPLIFIED.perSquareFoot)} a square foot, up to{" "}
          {HOME_OFFICE_SIMPLIFIED.maxSquareFeet} square feet (the simplified method).
          {v.homeOffice.sqft
            ? ` Now about ${roundDollars(v.homeOffice.deductionCents)} a year.`
            : ""}
        </p>
        <HelperForm
          intent="office"
          button="Save"
          fields={[
            {
              name: "sqft",
              label: "Square feet",
              value: v.homeOffice.sqft ? String(v.homeOffice.sqft) : "",
            },
          ]}
        />
      </section>

      <section aria-labelledby="miles" className={CARD}>
        <h2 id="miles" className="text-xl font-semibold">
          Business miles
        </h2>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          Miles driven for this work in {v.year}, at {MILEAGE_RATE_CENTS} cents a mile: about{" "}
          {roundDollars(v.mileage.deductionCents)} so far. You can also tell Jane in the chat
          (&ldquo;I drove 40 business miles&rdquo;).
        </p>
        <HelperForm
          intent="miles"
          button="Save"
          fields={[
            { name: "miles", label: `Miles so far in ${v.year}`, value: String(v.mileage.miles) },
          ]}
        />
      </section>

      {v.active && (
        <section aria-labelledby="quarterly" className={CARD}>
          <h2 id="quarterly" className="text-xl font-semibold">
            Estimated tax
          </h2>
          {v.advice ? (
            <>
              <p>
                Set aside about {Math.round(v.setAsideRate * 100)}% of each freelance payment.{" "}
                {v.federal.needed
                  ? `By my estimate you still owe about ${roundDollars(v.federal.owedCents)} federal for ${v.year}.`
                  : `By my estimate you'll owe under $1,000 for ${v.year}, so estimated payments aren't needed.`}
              </p>
              {v.federal.payments.length > 0 && (
                <table className="w-full text-sm">
                  <caption className="sr-only">Estimated payments left</caption>
                  <thead>
                    <tr className="text-left text-zinc-600 dark:text-zinc-400">
                      <th scope="col" className="py-1 font-medium">
                        Due
                      </th>
                      <th scope="col" className="py-1 text-right font-medium">
                        Federal
                      </th>
                      {v.state && (
                        <th scope="col" className="py-1 text-right font-medium">
                          State
                        </th>
                      )}
                    </tr>
                  </thead>
                  <tbody>
                    {v.federal.payments.map((p) => (
                      <tr key={p.date} className="border-t border-zinc-200 dark:border-zinc-800">
                        <td className="py-1">{dayLabel(p.date, { year: true })}</td>
                        <td className="py-1 text-right">{formatCents(p.cents)}</td>
                        {v.state && (
                          <td className="py-1 text-right">
                            {formatCents(
                              v.state.payments.find((s) => s.date === p.date)?.cents ?? 0,
                            )}
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              <p className="text-sm">
                Pay with{" "}
                <a href={IRS_DIRECT_PAY_URL} className={LINK} rel="noopener noreferrer">
                  IRS Direct Pay
                </a>
                . Paid from an account Jane can&apos;t see? Add it here:
              </p>
              <HelperForm
                intent="payment"
                button="Add payment"
                fields={[
                  {
                    name: "date",
                    label: "Paid on",
                    value: now.toISOString().slice(0, 10),
                    type: "date",
                  },
                  { name: "amount", label: "Amount ($)", value: "" },
                  {
                    name: "to",
                    label: "To",
                    value: "federal",
                    options: [
                      { value: "federal", label: "IRS" },
                      { value: "state", label: "State" },
                    ],
                  },
                ]}
              />
              <DemoAdviceLabel />
            </>
          ) : (
            <p className="text-sm">
              Estimated tax is usually due April 15, June 15, September 15 and January 15. Jane
              reminds you before each one.
            </p>
          )}
        </section>
      )}

      <Link href="/taxes" className={LINK}>
        Back to taxes
      </Link>
    </>
  );
}

export default function SelfEmployedPage() {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-4 py-10 sm:px-6 sm:py-12">
      <Suspense fallback={<PageLoading />}>
        <Content />
      </Suspense>
    </main>
  );
}
