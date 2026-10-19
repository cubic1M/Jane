import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { AppHeader } from "@/components/app-header";
import { DemoAdviceLabel } from "@/components/demo-advice-label";
import { ViewTracker } from "@/components/view-tracker";
import { PREMIUM_FREQUENCIES } from "@/config/documents";
import { HOUSING, POLICY_SOURCE_LABELS, RENEWAL_SOON_DAYS, isPolicyKind } from "@/config/insurance";
import { daysBetween } from "@/detection/units";
import { checkGuardrails } from "@/lib/guardrails";
import { coverageLines } from "@/lib/insurance/coverage";
import { gapAdvice, kindWords } from "@/lib/insurance/gaps";
import type { Household } from "@/lib/insurance/household";
import {
  EMPTY_POLICY_INPUT,
  nextRenewal,
  policyFormValues,
  yearlyPremium,
  type Policy,
} from "@/lib/insurance/policies";
import { isQuotable } from "@/lib/insurance/partner";
import { loadInsurance } from "@/lib/insurance/profile";
import { formatCents } from "@/lib/money";
import { requireUser } from "@/lib/session";
import { deletePolicy, notNeeded } from "./actions";
import { HouseholdForm, PolicyForm } from "./forms";

// Insurance (spec step 102): every policy in one place, the household facts that matter
// and the gaps, in plain words. Every figure comes from a policy record.

const LINK = "font-medium text-emerald-700 hover:underline";

const SAVED: Record<string, string> = {
  added: "Added to your insurance.",
  updated: "Saved.",
  removed: "Removed from your insurance.",
  household: "Saved. Jane checks your cover against it.",
  gap: "OK. Jane won't bring that one up again.",
};

const dateLabel = (day: string) =>
  new Date(`${day}T00:00:00Z`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });

function PolicyCard({ policy, asOf, editing }: { policy: Policy; asOf: string; editing: boolean }) {
  const renews = nextRenewal(policy, asOf);
  const days = renews ? daysBetween(asOf, renews) : null;
  const yearly = yearlyPremium(policy);
  const frequency = policy.premiumFrequency ? PREMIUM_FREQUENCIES[policy.premiumFrequency] : null;
  const covers =
    policy.covers && checkGuardrails(policy.covers, [policy.premiumCents ?? 0]).ok
      ? policy.covers
      : null;
  const limits = coverageLines(policy.kind, policy.coverage);
  return (
    <li
      id={`policy-${policy.id}`}
      className="flex flex-col gap-2 rounded-xl border border-zinc-200 p-4 [overflow-wrap:anywhere] dark:border-zinc-800"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div className="flex min-w-0 flex-col">
          <h3 className="font-semibold">
            {policy.carrier} {kindWords(policy.kind)}
          </h3>
          <span className="text-sm text-zinc-500">
            {POLICY_SOURCE_LABELS[policy.source]}
            {policy.status === "found" && " · not confirmed yet"}
            {policy.status === "pending" && " · starting, waiting for its first payment"}
          </span>
        </div>
        {policy.premiumCents !== null && frequency && (
          <span className="text-xl font-semibold">
            {formatCents(policy.premiumCents)}{" "}
            <span className="text-sm font-normal">{frequency.label}</span>
          </span>
        )}
      </div>
      <ul className="flex flex-col gap-1 text-sm">
        {yearly !== null && frequency && frequency.perYear > 1 && (
          <li>{formatCents(yearly)} a year</li>
        )}
        {policy.deductibleCents !== null && (
          <li>Deductible: {formatCents(policy.deductibleCents)}</li>
        )}
        {renews && (
          <li>
            Renews on {dateLabel(renews)}
            {days !== null && days <= RENEWAL_SOON_DAYS && ` (in ${days} days)`}
          </li>
        )}
        {covers && <li>Covers: {covers}</li>}
        {limits.map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>
      {limits.length === 0 && policy.deductibleCents === null && (
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          Add the deductible and limits from your policy so Jane can compare it like for like.
        </p>
      )}
      {isQuotable(policy.kind) && policy.status === "active" && (
        <Link href={`/insurance/quotes?policy=${policy.id}`} className={`text-sm ${LINK}`}>
          Compare quotes
        </Link>
      )}
      {policy.documentId && (
        <Link href="/documents" className={`text-sm ${LINK}`}>
          See the policy document
        </Link>
      )}
      <details open={editing}>
        <summary className="cursor-pointer text-sm text-emerald-700">
          {policy.status === "found" ? "Confirm and add details" : "Edit details"}
        </summary>
        <div className="mt-3">
          <PolicyForm policyId={policy.id} values={policyFormValues(policy)} />
        </div>
      </details>
      <form action={deletePolicy} className="self-end">
        <input type="hidden" name="policyId" value={policy.id} />
        <button type="submit" className="text-xs text-zinc-500 hover:text-red-700 hover:underline">
          {policy.status === "found" ? "Not insurance" : "Remove"}
        </button>
      </form>
    </li>
  );
}

function householdHints(household: Household) {
  const hint = (from: string | null, words: string | null) =>
    from === "accounts" && words ? `From your accounts: ${words}` : undefined;
  return {
    housing: hint(
      household.housing.from,
      household.housing.value ? HOUSING[household.housing.value].toLowerCase() : null,
    ),
    vehicles: hint(
      household.vehicles.from,
      household.vehicles.value === null ? null : String(household.vehicles.value),
    ),
  };
}

async function InsuranceContent({
  searchParams,
}: {
  searchParams: PageProps<"/insurance">["searchParams"];
}) {
  const user = await requireUser();
  await connection();
  const params = await searchParams;
  const one = (key: string) => {
    const v = params[key];
    return typeof v === "string" ? v : "";
  };
  const now = new Date();
  const asOf = now.toISOString().slice(0, 10);
  const { policies, household, gaps, advice } = await loadInsurance(user.id, { now });
  const saved = SAVED[one("saved")];
  const add = one("add");
  const typed = (fact: { value: number | string | null; from: string | null }) =>
    fact.from === "you" && fact.value !== null ? String(fact.value) : "";
  const yearlyTotal = policies
    .filter((p) => p.status === "active")
    .reduce((sum, p) => sum + (yearlyPremium(p) ?? 0), 0);

  return (
    <>
      <AppHeader user={user} />
      <ViewTracker event="insurance_viewed" />
      <div className="flex flex-col gap-2">
        <h1 className="text-3xl font-semibold tracking-tight">Insurance</h1>
        <p className="text-zinc-600 dark:text-zinc-400">
          Every policy you have, what it covers and when it renews, in one place. Jane adds the ones
          from your{" "}
          <Link href="/documents" className={LINK}>
            policy documents
          </Link>{" "}
          by herself and points out cover that looks missing. She never buys, changes or cancels
          insurance without your tap.
        </p>
      </div>

      {saved && (
        <p
          role="status"
          className="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-900 dark:bg-emerald-950 dark:text-emerald-100"
        >
          {saved}
        </p>
      )}

      {gaps.length > 0 && (
        <section className="flex flex-col gap-3" aria-labelledby="gaps">
          <h2 id="gaps" className="text-xl font-semibold">
            Cover that looks missing
          </h2>
          <ul className="flex flex-col gap-3">
            {gaps.map((gap) => (
              <li
                key={gap.key}
                className="flex flex-col gap-2 rounded-xl bg-amber-50 p-4 text-amber-950 dark:bg-amber-950 dark:text-amber-50"
              >
                <h3 className="font-semibold">{gap.title}</h3>
                <p className="text-sm">{gap.why}</p>
                {advice && (
                  <div className="flex flex-col gap-1">
                    <p className="text-sm font-medium">{gapAdvice(gap).text}</p>
                    <DemoAdviceLabel />
                  </div>
                )}
                <div className="flex flex-wrap items-center gap-4 text-sm">
                  {gap.policyId ? (
                    <Link
                      href={`/insurance?edit=${gap.policyId}#policy-${gap.policyId}`}
                      className={LINK}
                    >
                      Update the policy
                    </Link>
                  ) : (
                    <Link href={`/insurance?add=${gap.kind}#add`} className={LINK}>
                      I have this: add it
                    </Link>
                  )}
                  <form action={notNeeded}>
                    <input type="hidden" name="gap" value={gap.key} />
                    <button type="submit" className="underline">
                      I don&apos;t need it
                    </button>
                  </form>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="flex flex-col gap-3" aria-labelledby="policies">
        <h2 id="policies" className="text-xl font-semibold">
          Your policies
        </h2>
        {policies.length === 0 ? (
          <p className="text-zinc-600 dark:text-zinc-400">
            Nothing here yet. Add your car, home or renters policy below, or upload the policy
            document and Jane reads it for you.
          </p>
        ) : (
          <>
            {yearlyTotal > 0 && (
              <p className="text-sm text-zinc-600 dark:text-zinc-400">
                Together about {formatCents(yearlyTotal)} a year, from the prices on file.
              </p>
            )}
            <ul className="flex flex-col gap-3">
              {policies.map((p) => (
                <PolicyCard key={p.id} policy={p} asOf={asOf} editing={one("edit") === p.id} />
              ))}
            </ul>
          </>
        )}
      </section>

      <section className="flex flex-col gap-3" aria-labelledby="household">
        <h2 id="household" className="text-xl font-semibold">
          Your household
        </h2>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          What matters for your cover. Leave a box blank and Jane reads it from your accounts where
          she can.
        </p>
        <HouseholdForm
          values={{
            housing: household.housing.from === "you" ? (household.housing.value ?? "") : "",
            vehicles: typed(household.vehicles),
            dependants: typed(household.dependants),
            pets: typed(household.pets),
          }}
          hints={householdHints(household)}
        />
      </section>

      <section id="add" className="flex flex-col gap-3">
        <h2 className="text-xl font-semibold">
          {policies.length === 0 ? "Add a policy" : "Add another policy"}
        </h2>
        <PolicyForm
          key={add}
          policyId=""
          values={{ ...EMPTY_POLICY_INPUT, kind: isPolicyKind(add) ? add : "auto" }}
        />
      </section>
    </>
  );
}

export default function InsurancePage({ searchParams }: PageProps<"/insurance">) {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-4 py-10 sm:px-6 sm:py-12">
      <Suspense fallback={<p className="text-zinc-500">Loading…</p>}>
        <InsuranceContent searchParams={searchParams} />
      </Suspense>
    </main>
  );
}
