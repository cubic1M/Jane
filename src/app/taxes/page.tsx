import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { AppHeader } from "@/components/app-header";
import { ViewTracker } from "@/components/view-tracker";
import {
  FILING_STATUSES,
  INCOME_KINDS,
  TAX_TAG_ORDER,
  TAX_TAGS,
  TAX_YEAR,
  whatJaneDoes,
} from "@/config/tax";
import { formatCents } from "@/lib/money";
import { requireUser } from "@/lib/session";
import { loadTaxTags } from "@/lib/tax-organizer";
import { adviceMode } from "@/lib/advice-mode";
import { loadTaxEstimate } from "@/lib/tax-estimate";
import { checkFrom } from "@/lib/tax-withholding";
import { loadTaxSavings } from "@/lib/tax-savings";
import { loadWorkingProfile } from "@/lib/tax-profile";
import { byHerself } from "@/lib/jane-agent/replies-autopilot";
import { defaultTaxYear } from "@/planning/tax-pack";
import { stateName, type FieldStatus } from "@/planning/tax-profile";
import { EstimateSection } from "./estimate-section";
import { SavingsSection } from "./savings-section";
import { InvestmentsSection } from "./investments-section";
import { loadInvestmentTaxes } from "@/lib/investment-taxes";
import { RefundSection } from "./refund-section";
import { loadRefunds } from "@/lib/tax-refund";
import { WithholdingSection } from "./withholding-section";
import { FormToggle } from "./form-toggle";
import { DocumentButtons } from "./document-buttons";
import { PlanSection } from "./plan-section";
import { GivingSection } from "./giving-section";
import { FamilySection } from "./family-section";
import { SideIncomeSection } from "./side-income-section";
import { loadSideIncome } from "@/lib/side-income";
import { RecordsSection } from "./records-section";
import { loadAuditRecords } from "@/lib/audit-records";
import { HomeSection } from "./home-section";
import { loadHomeTaxes } from "@/lib/home-taxes";
import { loadFamilyTaxes } from "@/lib/family-taxes";
import { loadGiving } from "@/lib/giving";
import { loadTaxPlan } from "@/lib/tax-plan";
import { loadTaxDocuments } from "@/lib/tax-documents";
import { COMPARED } from "@/planning/tax-document-check";

// Taxes (spec steps 118–127): Jane keeps the person's taxes organised all year. Step 118:
// the tax profile, and what Jane does by herself at their autopilot level.

const CARD = "flex flex-col gap-3 rounded-xl border border-zinc-200 p-4 dark:border-zinc-800";
const LINK = "font-medium text-emerald-700 hover:underline";

const BADGE: Readonly<Record<FieldStatus, string>> = {
  yours: "Your answer",
  found: "Found by Jane: check it",
  missing: "Not set yet",
};

function Row({ label, value, status }: { label: string; value: string; status: FieldStatus }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-t border-zinc-200 pt-2 first:border-0 first:pt-0 dark:border-zinc-800">
      <dt className="text-zinc-600 dark:text-zinc-400">{label}</dt>
      <dd className="flex flex-col items-end text-right">
        <span className="[overflow-wrap:anywhere]">{value}</span>
        <span
          className={`text-xs ${status === "yours" ? "text-zinc-500" : "font-medium text-amber-800 dark:text-amber-300"}`}
        >
          {BADGE[status]}
        </span>
      </dd>
    </div>
  );
}

async function TaxesContent() {
  const user = await requireUser();
  await connection();
  const now = new Date();
  // The year being gathered: last year until the end of April, then this one.
  const year = defaultTaxYear(now.toISOString().slice(0, 10));
  const [{ view, taxes }, tags, forms, estimate, advice] = await Promise.all([
    loadWorkingProfile(user.id, { now }),
    loadTaxTags(user.id, year),
    // Spec step 166: with what Jane collected and how each checked.
    loadTaxDocuments(user.id, year, { now }),
    loadTaxEstimate(user.id, { now }),
    adviceMode(user.id),
  ]);
  const kids = view.dependants;

  return (
    <>
      <AppHeader user={user} />
      <ViewTracker event="taxes_viewed" />
      <div className="flex flex-col gap-2">
        <h1 className="text-3xl font-semibold tracking-tight">Taxes: {TAX_YEAR}</h1>
        <p className="text-zinc-600 dark:text-zinc-400">
          Jane keeps your taxes organised all year from your accounts, and asks you only what she
          can&apos;t work out.
        </p>
      </div>

      <RefundSection refunds={(await loadRefunds(user.id, { now })).refunds} />
      <EstimateSection view={estimate} />
      <WithholdingSection view={{ estimate, check: checkFrom(estimate), advice }} />
      <InvestmentsSection
        view={await loadInvestmentTaxes(user.id, estimate.year, { now })}
        estimate={estimate}
        advice={advice}
      />
      <SavingsSection view={await loadTaxSavings(user.id, { now, loaded: { estimate, advice } })} />
      <section aria-labelledby="equity-heading" id="equity" className={CARD}>
        <h2 id="equity-heading" className="text-xl font-semibold">
          Crypto and equity pay
        </h2>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          Crypto gains by lot, ESPP sales, ISO exercises with the alternative minimum tax and RSU
          withholding, worked out and in your estimate.
        </p>
        <Link href="/taxes/equity" className={LINK}>
          See my crypto and equity
        </Link>
      </section>

      <section aria-labelledby="business-heading" id="business" className={CARD}>
        <h2 id="business-heading" className="text-xl font-semibold">
          Business taxes
        </h2>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          For your own business or side work: the qualified business income deduction, whether an S
          corporation would save more than it costs, and the home office and miles.
        </p>
        <Link href="/taxes/business" className={LINK}>
          See my business taxes
        </Link>
      </section>

      <section aria-labelledby="years-heading" id="years" className={CARD}>
        <h2 id="years-heading" className="text-xl font-semibold">
          Taxes over the years
        </h2>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          Your federal tax for each year ahead, and the moves, like a Roth conversion in a low year,
          that save the most over all of them.
        </p>
        <Link href="/taxes/years" className={LINK}>
          See my tax years
        </Link>
      </section>

      <section aria-labelledby="property-heading" id="property" className={CARD}>
        <h2 id="property-heading" className="text-xl font-semibold">
          Property tax
        </h2>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          Is your home assessed for more than it&apos;s worth? An appeal drafted with comparable
          sales, the county&apos;s deadline, and exemptions you may not have claimed.
        </p>
        <Link href="/taxes/property" className={LINK}>
          Check my property tax
        </Link>
      </section>

      <section aria-labelledby="accountant-heading" id="accountant" className={CARD}>
        <h2 id="accountant-heading" className="text-xl font-semibold">
          Working with an accountant
        </h2>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          One read-only link with your tax pack, the forms Jane collected and her questions. It ends
          when you say, and their answers come back here.
        </p>
        <Link href="/taxes/accountant" className={LINK}>
          Make a link for my accountant
        </Link>
      </section>

      <section aria-labelledby="retirement-heading" id="retirement" className={CARD}>
        <h2 id="retirement-heading" className="text-xl font-semibold">
          Taxes on retirement income
        </h2>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          How much of your Social Security is taxable, Medicare&apos;s income surcharge two years
          ahead, and the order to draw from your accounts.
        </p>
        <Link href="/taxes/retirement" className={LINK}>
          See my retirement taxes
        </Link>
      </section>

      <section aria-labelledby="inherited-heading" id="inherited" className={CARD}>
        <h2 id="inherited-heading" className="text-xl font-semibold">
          Inherited money and gifts
        </h2>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          An inherited IRA&apos;s deadline, gifts that need a gift tax return, the step-up in basis
          and the estate tax facts.
        </p>
        <Link href="/taxes/inherited" className={LINK}>
          See inherited money and gifts
        </Link>
      </section>

      <section aria-labelledby="disasters-heading" id="disasters" className={CARD}>
        <h2 id="disasters-heading" className="text-xl font-semibold">
          Disasters and losses
        </h2>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          When the IRS postpones deadlines for your county, Jane moves yours, and keeps a loss
          insurance didn&apos;t cover with the claim.
        </p>
        <Link href="/taxes/disasters" className={LINK}>
          See disaster relief
        </Link>
      </section>

      <section aria-labelledby="calendar-heading" id="calendar" className={CARD}>
        <h2 id="calendar-heading" className="text-xl font-semibold">
          Your tax calendar
        </h2>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          What Jane does each month of the tax year, by herself within your caps or with your tap.
        </p>
        <Link href="/taxes/calendar" className={LINK}>
          See my tax calendar
        </Link>
      </section>

      <section aria-labelledby="draft-heading" id="draft" className={CARD}>
        <h2 id="draft-heading" className="text-xl font-semibold">
          Your draft return, checked before you file
        </h2>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          Upload the draft from your software or accountant and Jane checks every line against your
          forms and accounts. She never files it.
        </p>
        <Link href="/taxes/draft" className={LINK}>
          Check my draft return
        </Link>
      </section>

      <section aria-labelledby="health-heading" id="health" className={CARD}>
        <h2 id="health-heading" className="text-xl font-semibold">
          Health insurance and taxes
        </h2>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          A Marketplace credit checked against your income, HSA deposits against the limit, and
          medical costs against the 7.5% floor.
        </p>
        <Link href="/taxes/health" className={LINK}>
          See the tax side of my health cover
        </Link>
      </section>

      <section aria-labelledby="identity-heading" id="identity" className={CARD}>
        <h2 id="identity-heading" className="text-xl font-semibold">
          Your tax identity
        </h2>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          An IRS Identity Protection PIN keeps anyone else from filing with your Social Security
          number. If a sign of theft shows up, Jane gives you the steps in order.
        </p>
        <Link href="/taxes/identity" className={LINK}>
          Protect my tax identity
        </Link>
      </section>

      <section aria-labelledby="letters-heading" id="letters" className={CARD}>
        <h2 id="letters-heading" className="text-xl font-semibold">
          Letters from the IRS or your state
        </h2>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          Photograph a notice and Jane explains it, puts its date on your deadlines, checks it
          against your records and drafts a reply for you to send.
        </p>
        <Link href="/taxes/letters" className={LINK}>
          Open my letters
        </Link>
      </section>

      <section aria-labelledby="last-return-heading" id="last-return" className={CARD}>
        <h2 id="last-return-heading" className="text-xl font-semibold">
          Last year&apos;s return
        </h2>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          Upload a return you filed and Jane reads it, checks it against your accounts for money
          left behind, and prepares an amended return for you to review and sign.
        </p>
        <Link href="/taxes/last-return" className={LINK}>
          Review a past return
        </Link>
      </section>

      <SideIncomeSection
        view={await loadSideIncome(user.id, { now, loaded: { estimate } })}
        advice={advice}
      />
      <RecordsSection view={await loadAuditRecords(user.id, year, { now })} />
      <HomeSection view={await loadHomeTaxes(user.id, { now, loaded: { estimate } })} />
      <FamilySection view={await loadFamilyTaxes(user.id, { now, loaded: { estimate, advice } })} />
      <GivingSection view={await loadGiving(user.id, { now, loaded: { estimate, advice } })} />
      <PlanSection
        view={await loadTaxPlan(user.id, { now, loaded: { estimate, advice } })}
        today={now.toISOString().slice(0, 10)}
      />

      <section aria-labelledby="profile" className={CARD}>
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 id="profile" className="text-xl font-semibold">
            Your tax profile
          </h2>
          <Link href="/taxes/profile" className={LINK}>
            {view.complete ? "Change it" : "Finish it"}
          </Link>
        </div>
        <dl className="flex flex-col gap-2 text-sm">
          <Row
            label="How you file"
            value={view.filingStatus.value ? FILING_STATUSES[view.filingStatus.value] : "—"}
            status={view.filingStatus.status}
          />
          <Row
            label="Dependants"
            value={
              kids.status === "yours"
                ? `${kids.childrenUnder17} under 17, ${kids.otherDependants} other`
                : "—"
            }
            status={kids.status}
          />
          <Row
            label="State"
            value={stateName(view.state.value) ?? "—"}
            status={view.state.status}
          />
          <Row
            label="Income"
            value={
              view.incomeKinds.value.length > 0
                ? view.incomeKinds.value
                    .map((k) => `${INCOME_KINDS[k].label} (${INCOME_KINDS[k].form})`)
                    .join("; ")
                : "—"
            }
            status={view.incomeKinds.status}
          />
        </dl>
        {view.newIncome.length > 0 && (
          <p className="text-sm text-amber-800 dark:text-amber-300">
            New since you answered:{" "}
            {view.newIncome.map((i) => INCOME_KINDS[i.kind].label.toLowerCase()).join("; ")}.{" "}
            <Link href="/taxes/profile#income" className={LINK}>
              Add it
            </Link>
          </p>
        )}
      </section>

      <section aria-labelledby="organised" className={CARD}>
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 id="organised" className="text-xl font-semibold">
            Tagged for {year}
          </h2>
          <Link href="/taxes/tags" className={LINK}>
            See and change tags
          </Link>
        </div>
        <dl className="grid grid-cols-1 gap-x-4 gap-y-1 text-sm sm:grid-cols-2">
          {TAX_TAG_ORDER.map((tag) => (
            <div key={tag} className="flex justify-between gap-2">
              <dt className="text-zinc-600 dark:text-zinc-400">{TAX_TAGS[tag].label}</dt>
              <dd className="whitespace-nowrap">{formatCents(tags.totals[tag].totalCents)}</dd>
            </div>
          ))}
        </dl>
        {tags.checks.length > 0 && (
          <p className="text-sm text-amber-800 dark:text-amber-300">
            Jane isn&apos;t sure about {tags.checks.length}{" "}
            {tags.checks.length === 1 ? "merchant" : "merchants"}.{" "}
            <Link href="/taxes/tags#checks" className={LINK}>
              Check them
            </Link>
          </p>
        )}
      </section>

      <section aria-labelledby="forms" className={CARD}>
        <h2 id="forms" className="text-xl font-semibold">
          Tax forms to expect for {year}
        </h2>
        {forms.forms.length === 0 ? (
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            None from what&apos;s in your accounts.
          </p>
        ) : (
          <ul className="flex flex-col gap-3 text-sm">
            {forms.forms.map((f) => (
              <li key={f.key} className="flex flex-col gap-1">
                <span className="[overflow-wrap:anywhere]">
                  <strong>{f.form}</strong> from {f.from}, for {f.what}
                </span>
                {f.document && f.check && (
                  <span
                    className={
                      f.usable
                        ? "text-emerald-800 dark:text-emerald-300"
                        : "text-red-800 dark:text-red-300"
                    }
                  >
                    {f.check.status === "differs"
                      ? `Collected by Jane: it shows ${COMPARED[f.formKey]} of ${formatCents(f.check.formCents)}; your accounts show ${formatCents(f.check.seenCents ?? 0)}. ${f.usable ? "You said it's right, so it's used." : "Not used until you say it's right."}`
                      : f.check.status === "unchecked"
                        ? "Collected by Jane. Nothing in your accounts to check it against."
                        : "Collected by Jane: matches your accounts."}
                  </span>
                )}
                {f.document && !f.usable && f.document.decision === null && (
                  <DocumentButtons year={year} formKey={f.key} label={`${f.form} from ${f.from}`} />
                )}
                <span className="text-zinc-600 dark:text-zinc-400">
                  {f.received
                    ? "Received"
                    : f.mayNotSend
                      ? "May not send one: below the reporting threshold. Your own records count."
                      : `Usually sent by ${new Date(`${f.by}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" })}`}
                </span>
                <FormToggle
                  year={year}
                  formKey={f.key}
                  received={f.received}
                  label={`${f.form} from ${f.from}`}
                />
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="by-herself" className={CARD}>
        <h2 id="by-herself" className="text-xl font-semibold">
          What Jane does by herself
        </h2>
        <ul className="flex list-disc flex-col gap-1 pl-5 text-sm">
          {whatJaneDoes(taxes.level).map((line) => (
            <li key={line}>{line}</li>
          ))}
          {/* Spec step 141: what the Taxes area may do by itself, as Settings has it. */}
          <li>{byHerself(taxes)} Nothing is ever filed or signed without your tap.</li>
        </ul>
        <Link href="/settings#sectors" className={`${LINK} text-sm`}>
          Change your autopilot
        </Link>
      </section>

      <p className="text-sm text-zinc-600 dark:text-zinc-400">
        <Link href="/taxes/file" className={LINK}>
          File your taxes
        </Link>
        . Freelance or gig work?{" "}
        <Link href="/taxes/self-employed" className={LINK}>
          Freelance taxes
        </Link>
        . The year&apos;s records are in your{" "}
        <Link href="/tax-pack" className={LINK}>
          tax-time pack
        </Link>
        .
      </p>
    </>
  );
}

export default function TaxesPage() {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-4 py-10 sm:px-6 sm:py-12">
      <Suspense fallback={<p className="text-zinc-500">Loading…</p>}>
        <TaxesContent />
      </Suspense>
    </main>
  );
}
