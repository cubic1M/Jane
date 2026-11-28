import Link from "next/link";
import { orNoParams } from "../no-params";
import { connection } from "next/server";
import { AppHeader } from "@/components/app-header";
import { DemoAdviceLabel } from "@/components/demo-advice-label";
import { IRS_DIRECT_PAY_URL } from "@/config/tax";
import { HOME_OFFICE_SIMPLIFIED, mileageRateNote, undatedMileageCentsIn } from "@/config/tax-rates";
import { formatCents, formatWholeDollars } from "@/lib/money";
import { loadSelfEmployed } from "@/lib/self-employed";
import { requireUser } from "@/lib/session";
import { todayOf } from "@/lib/today";
import { HelperForm } from "./helper-form";
import { dayLabel } from "@/lib/day-label";
import { PageShell } from "@/components/page-shell";
import { CARD_ROOMY } from "@/components/card";

// Freelance taxes (spec step 123): business expenses, the home office and mileage helpers,
// what to set aside from each payment and the estimated tax payments left (demo advice).

const LINK = "font-medium text-emerald-700 hover:underline";

async function Content() {
  const user = await requireUser();
  await connection();
  const now = new Date();
  const today = await todayOf(user.id, { now });
  const loaded = await orNoParams(user, () => loadSelfEmployed(user.id, { now }));
  if (loaded.page) return loaded.page;
  const v = loaded.value;
  // Every date a federal or a state payment is due (the state plan can have one when the federal
  // plan has none).
  const dueDates = [
    ...new Set([...v.federal.payments, ...(v.state?.payments ?? [])].map((p) => p.date)),
  ].sort();
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

      <section aria-labelledby="business" className={CARD_ROOMY}>
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

      <section aria-labelledby="office" className={CARD_ROOMY}>
        <h2 id="office" className="text-xl font-semibold">
          Home office
        </h2>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          Part of your home used only for this work:{" "}
          {formatCents(HOME_OFFICE_SIMPLIFIED.perSquareFoot)} a square foot, up to{" "}
          {HOME_OFFICE_SIMPLIFIED.maxSquareFeet} square feet (the simplified method).
          {v.homeOffice.sqft
            ? ` Now about ${formatWholeDollars(v.homeOffice.deductionCents)} a year.`
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

      <section aria-labelledby="miles" className={CARD_ROOMY}>
        <h2 id="miles" className="text-xl font-semibold">
          Business miles
        </h2>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          {v.mileage.awaited
            ? `Miles driven for this work in ${v.year}. ${v.mileage.awaited}`
            : `Miles driven for this work in ${v.year}, at ${undatedMileageCentsIn(v.year)} cents a mile: about ${formatWholeDollars(v.mileage.deductionCents)} so far. ${mileageRateNote(v.year)}`}{" "}
          You can also tell Jane in the chat (&ldquo;I drove 40 business miles&rdquo;).
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
        <section aria-labelledby="quarterly" className={CARD_ROOMY}>
          <h2 id="quarterly" className="text-xl font-semibold">
            Estimated tax
          </h2>
          {v.advice ? (
            <>
              <p>
                Set aside about {Math.round(v.setAsideRate * 100)}% of each freelance payment.{" "}
                {v.federal.needed
                  ? `By my estimate you still owe about ${formatWholeDollars(v.federal.owedCents)} federal for ${v.year}.`
                  : `By my estimate you'll owe under $1,000 for ${v.year}, so federal estimated payments aren't needed.`}
              </p>
              {dueDates.length > 0 && (
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
                    {dueDates.map((date) => (
                      <tr key={date} className="border-t border-zinc-200 dark:border-zinc-800">
                        <td className="py-1">{dayLabel(date, { year: true })}</td>
                        <td className="py-1 text-right">
                          {formatCents(v.federal.payments.find((f) => f.date === date)?.cents ?? 0)}
                        </td>
                        {v.state && (
                          <td className="py-1 text-right">
                            {formatCents(v.state.payments.find((s) => s.date === date)?.cents ?? 0)}
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
                    value: today,
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
    <PageShell>
      <Content />
    </PageShell>
  );
}
