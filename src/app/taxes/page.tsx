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
import { loadTaxForms, loadTaxTags } from "@/lib/tax-organizer";
import { adviceMode } from "@/lib/advice-mode";
import { loadTaxEstimate } from "@/lib/tax-estimate";
import { checkFrom } from "@/lib/tax-withholding";
import { loadWorkingProfile } from "@/lib/tax-profile";
import { defaultTaxYear } from "@/planning/tax-pack";
import { stateName, type FieldStatus } from "@/planning/tax-profile";
import { EstimateSection } from "./estimate-section";
import { WithholdingSection } from "./withholding-section";
import { FormToggle } from "./form-toggle";

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
  const [{ view, autopilot }, tags, forms, estimate, advice] = await Promise.all([
    loadWorkingProfile(user.id, { now }),
    loadTaxTags(user.id, year),
    loadTaxForms(user.id, year, { now }),
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

      <EstimateSection view={estimate} />
      <WithholdingSection view={{ estimate, check: checkFrom(estimate), advice }} />

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
          {whatJaneDoes(autopilot).map((line) => (
            <li key={line}>{line}</li>
          ))}
          <li>Nothing is ever filed, signed or paid without your tap.</li>
        </ul>
        <Link href="/settings#autopilot" className={`${LINK} text-sm`}>
          Change your autopilot
        </Link>
      </section>

      <p className="text-sm text-zinc-600 dark:text-zinc-400">
        The year&apos;s records are in your{" "}
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
