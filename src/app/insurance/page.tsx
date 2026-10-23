import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { AppHeader } from "@/components/app-header";
import { DemoAdviceLabel } from "@/components/demo-advice-label";
import { PerfectCoverage } from "./perfect-coverage";
import { ViewTracker } from "@/components/view-tracker";
import { PREMIUM_FREQUENCIES } from "@/config/documents";
import {
  HOUSEHOLD_RELATIONS,
  HOUSING,
  POLICY_KINDS,
  POLICY_SOURCE_LABELS,
  RENEWAL_SOON_DAYS,
  isPolicyKind,
} from "@/config/insurance";
import { daysBetween } from "@/detection/units";
import { checkGuardrails } from "@/lib/guardrails";
import { coverageLines } from "@/lib/insurance/coverage";
import { gapAdvice, kindWords } from "@/lib/insurance/gaps";
import type { Household } from "@/lib/insurance/household";
import {
  EMPTY_POLICY_INPUT,
  nextRenewal,
  policyFormValues,
  premiumTotalLine,
  yearlyPremium,
  type Policy,
} from "@/lib/insurance/policies";
import { isQuotable } from "@/lib/insurance/partner";
import { loadInsurance } from "@/lib/insurance/profile";
import { listReadings } from "@/lib/insurance/readings";
import { listCoverChanges } from "@/lib/insurance/cover-changes";
import { listNegotiations } from "@/lib/insurance/negotiate";
import { refreshSavings } from "@/lib/insurance/savings";
import { listRisks, refreshRisks } from "@/lib/insurance/risks";
import { loadFamily } from "@/lib/insurance/family";
import { loadHealthYear } from "@/lib/insurance/health-year";
import { healthYearLines } from "@/lib/jane-agent/insurance/health-year";
import { riskQuestion } from "@/lib/jane-agent/insurance/risk-words";
import { lowering, savingLine } from "@/lib/jane-agent/insurance/saving-words";
import { askCallBody, callResultBody } from "@/lib/jane-agent/insurance/done-by-jane-words";
import { partnerFor } from "@/lib/insurance/partner";
import { coverBody, coverActions, coverEventRef } from "@/lib/jane-agent/insurance/cover-words";
import { cardCover, conditionWords, limitWords } from "@/lib/insurance/card-cover";
import { formatCents } from "@/lib/money";
import { requireUser } from "@/lib/session";
import { autopilotOf } from "@/lib/autopilot";
import { autopilotFor } from "@/lib/sector-autopilot";
import { autopilotReply } from "@/lib/jane-agent/insurance/autopilot";
import {
  addPersonForm,
  removePersonForm,
  setCoveredForm,
  setSharedForm,
  answerRiskForm,
  applyChanges,
  applyOneSaving,
  skipSaving,
  callRenewal,
  deletePolicy,
  dismissChanges,
  notNeeded,
  skipRenewal,
} from "./actions";
import { HouseholdForm, PolicyForm } from "./forms";

// Insurance (spec step 102): every policy in one place, the household facts that matter
// and the gaps, in plain words. Every figure comes from a policy record.

const LINK = "font-medium text-emerald-700 hover:underline";
const kindName = (kind: keyof typeof POLICY_KINDS) => POLICY_KINDS[kind].toLowerCase();
const INPUT =
  "h-11 min-w-0 rounded-lg border border-zinc-300 bg-transparent px-3 text-base dark:border-zinc-700";

const SAVED: Record<string, string> = {
  added: "Added to your insurance.",
  updated: "Saved.",
  removed: "Removed from your insurance.",
  household: "Saved. Jane checks your cover against it.",
  gap: "OK. Jane won't bring that one up again.",
  read: "Confirmed. It's on your insurance now.",
  changes: "Done. Your insurance is up to date.",
  called: "Jane called your insurer. What they said is below and in the chat.",
  saving: "Done. Your policy is updated and your insurer confirmed it.",
  risk: "Thanks. Jane has noted it.",
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
  const [{ policies, household, gaps, advice }, autopilot, insuranceArea] = await Promise.all([
    loadInsurance(user.id, { now }),
    autopilotOf(user.id),
    // Spec step 141: what the Insurance area may do by itself.
    autopilotFor(user.id, "insurance", { now }),
  ]);
  // Read after loadInsurance, which reads any policy document not read yet.
  const [readings, cards, prepared, partner, negotiations] = await Promise.all([
    listReadings(user.id, { status: "waiting" }),
    cardCover(user.id),
    listCoverChanges(user.id, { status: "prepared" }),
    partnerFor(user.id),
    listNegotiations(user.id),
  ]);
  // Spec step 196: looked at again whenever the page opens.
  const savings = await refreshSavings(user.id);
  // Spec step 198: the household's cover, what's shared with them and who is covered.
  const family = await loadFamily(user.id);
  const healthYear = await loadHealthYear(user.id);
  const familyError = one("family");
  // Spec step 197: the questions about how they live, read from their payments.
  await refreshRisks(user.id);
  const risks = await listRisks(user.id, { status: "asked" });
  const policyById = (id: string) => policies.find((p) => p.id === id);
  const renewals = negotiations.filter((n) => n.status !== "declined").slice(-3);
  // Spec step 154: one group per life event.
  const changeGroups = [
    ...prepared
      .reduce((groups, c) => {
        const ref = coverEventRef(c.event, c.eventKey);
        return groups.set(ref, [...(groups.get(ref) ?? []), c]);
      }, new Map<string, typeof prepared>())
      .entries(),
  ];
  const payingTwice = cards.duplicates.filter((d) => d.status === "new" || d.status === "shown");
  const saved = SAVED[one("saved")];
  const add = one("add");
  const typed = (fact: { value: number | string | null; from: string | null }) =>
    fact.from === "you" && fact.value !== null ? String(fact.value) : "";
  const totalLine = premiumTotalLine(policies);

  return (
    <>
      <AppHeader user={user} />
      <ViewTracker event="insurance_viewed" />
      <div className="flex flex-col gap-2">
        <h1 className="text-3xl font-semibold tracking-tight">Insurance</h1>
        <p className="text-zinc-600 dark:text-zinc-400">
          Every policy you have, what it covers and when it renews, in one place. Jane reads your{" "}
          <Link href="/documents" className={LINK}>
            policy documents
          </Link>{" "}
          and adds each one once you confirm what she read, and points out cover that looks missing.
          Unless you let her switch for you in Settings, she never buys, changes or cancels
          insurance without your tap.
        </p>
        {/* Spec steps 108 and 141: what Jane does with insurance by herself. */}
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          On autopilot: {autopilotReply(autopilot, insuranceArea).body}{" "}
          <Link href="/settings#sectors" className={LINK}>
            Change it
          </Link>
        </p>
        <div className="flex flex-wrap gap-4">
          <Link href="/insurance/checkup" className={`text-sm ${LINK}`}>
            Coverage checkup
          </Link>
          <Link href="/insurance/claims" className={`text-sm ${LINK}`}>
            Something happened? Claims
          </Link>
          <Link href="/insurance/benefits" className={`text-sm ${LINK}`}>
            Benefits through work
          </Link>
          {advice && (
            <Link href="/insurance/life" className={`text-sm ${LINK}`}>
              Life cover
            </Link>
          )}
        </div>
      </div>

      {saved && (
        <p
          role="status"
          className="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-900 dark:bg-emerald-950 dark:text-emerald-100"
        >
          {saved}
        </p>
      )}

      <PerfectCoverage
        userId={user.id}
        advice={advice}
        selected={one("need")}
        policyId={one("policy")}
        result={one("picked")}
      />

      {healthYear && (
        <section id="health-year" className="flex flex-col gap-3" aria-labelledby="health-year-h">
          <h2 id="health-year-h" className="text-xl font-semibold">
            Your health plan this year
          </h2>
          <progress
            className="w-full"
            aria-label="Deductible met"
            value={healthYear.progress.deductibleMetCents}
            max={healthYear.plan.deductibleCents}
          />
          <ul className="flex flex-col gap-1 text-sm">
            {healthYearLines(healthYear).map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </section>
      )}

      <section id="household" className="flex flex-col gap-3" aria-labelledby="household-heading">
        <h2 id="household-heading" className="text-xl font-semibold">
          Your household&apos;s cover
        </h2>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          Who is covered by what. A partner in your household sees only the policies you choose to
          share, and only to read.
        </p>
        {familyError && (
          <p role="alert" className="text-red-700 dark:text-red-400">
            {familyError}
          </p>
        )}
        <ul className="flex flex-col gap-2 text-sm">
          {family.rows.map((row) => (
            <li
              key={row.name}
              className="rounded-xl border border-zinc-200 p-3 dark:border-zinc-800"
            >
              <span className="font-medium">{row.name}</span>
              {row.relation !== "you" && row.relation !== "spouse" && (
                <span className="text-zinc-600 dark:text-zinc-400">
                  {" "}
                  ({HOUSEHOLD_RELATIONS[row.relation].toLowerCase()})
                </span>
              )}
              :{" "}
              {row.policies.length > 0
                ? row.policies
                    .map(
                      (p) =>
                        `${p.carrier} ${kindName(p.kind)}${p.owner === "You" ? "" : ` (${p.owner}'s)`}`,
                    )
                    .join(", ")
                : "no policy on file"}
              {family.people.some((p) => p.name === row.name) && (
                <form action={removePersonForm} className="mt-1 inline-block pl-2">
                  <input type="hidden" name="name" value={row.name} />
                  <button type="submit" className={`text-xs ${LINK}`}>
                    Remove
                  </button>
                </form>
              )}
            </li>
          ))}
        </ul>
        {family.healthPlans.length > 1 && (
          <div className="rounded-xl border border-zinc-200 p-3 text-sm dark:border-zinc-800">
            <p className="font-medium">Health plans for the whole household, a year</p>
            <ul>
              {family.healthPlans.map((r) => (
                <li key={r.policyId}>
                  {r.label}: about {formatCents(r.familyYearlyCents)}
                </li>
              ))}
            </ul>
          </div>
        )}
        <details className="text-sm">
          <summary className={`cursor-pointer ${LINK}`}>
            Add someone, or choose what to share
          </summary>
          <form action={addPersonForm} className="mt-3 flex flex-wrap items-end gap-3">
            <label className="flex flex-col gap-1 font-medium" htmlFor="person-name">
              Name
              <input id="person-name" name="name" className={INPUT} />
            </label>
            <label className="flex flex-col gap-1 font-medium" htmlFor="person-relation">
              Who they are to you
              <select id="person-relation" name="relation" className={INPUT} defaultValue="child">
                {Object.entries(HOUSEHOLD_RELATIONS).map(([k, label]) => (
                  <option key={k} value={k}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1 font-medium" htmlFor="person-age">
              Age
              <input id="person-age" name="age" inputMode="numeric" className={`${INPUT} w-20`} />
            </label>
            <label className="flex items-center gap-2 pb-3 font-medium">
              <input type="checkbox" name="driver" /> Drives
            </label>
            <button
              type="submit"
              className="inline-flex h-11 items-center rounded-full bg-emerald-700 px-5 font-semibold text-white"
            >
              Add them
            </button>
          </form>
          <ul className="mt-3 flex flex-col gap-2">
            {policies
              .filter((p) => p.status === "active")
              .map((p) => {
                const mine = family.policies.find((f) => f.id === p.id);
                return (
                  <li
                    key={p.id}
                    className="rounded-xl border border-zinc-200 p-3 dark:border-zinc-800"
                  >
                    <span className="font-medium">
                      {p.carrier} {kindName(p.kind)}
                    </span>
                    <form action={setSharedForm} className="inline-block pl-3">
                      <input type="hidden" name="policyId" value={p.id} />
                      <input
                        type="hidden"
                        name="shared"
                        value={p.sharedWithHousehold ? "no" : "yes"}
                      />
                      <button type="submit" className={LINK}>
                        {p.sharedWithHousehold ? "Shared: stop sharing" : "Share with my household"}
                      </button>
                    </form>
                    {family.people.map((person) => {
                      const covers = (mine?.covered ?? []).some((c) => c.name === person.name);
                      return (
                        <form
                          key={person.name}
                          action={setCoveredForm}
                          className="inline-block pl-3"
                        >
                          <input type="hidden" name="policyId" value={p.id} />
                          <input type="hidden" name="name" value={person.name} />
                          <input type="hidden" name="covered" value={covers ? "no" : "yes"} />
                          <button type="submit" className={LINK}>
                            {covers ? `Covers ${person.name}: remove` : `Add ${person.name}`}
                          </button>
                        </form>
                      );
                    })}
                  </li>
                );
              })}
          </ul>
        </details>
      </section>

      {risks.length > 0 && (
        <section id="risks" className="flex flex-col gap-3" aria-labelledby="risks-heading">
          <h2 id="risks-heading" className="text-xl font-semibold">
            A few questions about how you live
          </h2>
          <ul className="flex flex-col gap-3">
            {risks.map((r) => (
              <li
                key={r.id}
                className="flex flex-col gap-2 rounded-xl border border-zinc-200 p-4 text-sm dark:border-zinc-800"
              >
                <p>{riskQuestion(r)}</p>
                <form action={answerRiskForm} className="flex gap-3">
                  <input type="hidden" name="riskId" value={r.id} />
                  <button
                    type="submit"
                    name="answer"
                    value="yes"
                    className="inline-flex h-10 items-center rounded-full bg-emerald-700 px-5 font-semibold text-white hover:bg-emerald-800"
                  >
                    Yes
                  </button>
                  <button
                    type="submit"
                    name="answer"
                    value="no"
                    className="inline-flex h-10 items-center rounded-full border border-zinc-300 px-5 font-medium dark:border-zinc-700"
                  >
                    No
                  </button>
                </form>
              </li>
            ))}
          </ul>
        </section>
      )}

      {savings.length > 0 && (
        <section id="savings" className="flex flex-col gap-3" aria-labelledby="savings-heading">
          <h2 id="savings-heading" className="text-xl font-semibold">
            Pay less for the same cover
          </h2>
          <ul className="flex flex-col gap-3">
            {savings.map((s) => (
              <li
                key={s.id}
                className="flex flex-col gap-2 rounded-xl border border-zinc-200 p-4 text-sm dark:border-zinc-800"
              >
                <p>{savingLine(s, policyById(s.policyId))}</p>
                {lowering([s]).length > 0 && (
                  <p className="text-zinc-600 dark:text-zinc-400">
                    This one lowers your cover: if you claim, you pay{" "}
                    {formatCents(
                      (s.detail.toDeductibleCents ?? 0) - (s.detail.fromDeductibleCents ?? 0),
                    )}{" "}
                    more yourself.
                  </p>
                )}
                <div className="flex flex-wrap gap-3">
                  <form action={applyOneSaving}>
                    <input type="hidden" name="savingId" value={s.id} />
                    <button
                      type="submit"
                      className="inline-flex h-10 items-center rounded-full bg-emerald-700 px-5 font-semibold text-white hover:bg-emerald-800"
                    >
                      {lowering([s]).length > 0 ? "Raise it" : "Do it"}
                    </button>
                  </form>
                  <form action={skipSaving}>
                    <input type="hidden" name="savingId" value={s.id} />
                    <button type="submit" className={`h-10 ${LINK}`}>
                      No thanks
                    </button>
                  </form>
                </div>
              </li>
            ))}
          </ul>
          <DemoAdviceLabel />
        </section>
      )}

      {renewals.length > 0 && (
        <section id="renewals" className="flex flex-col gap-3" aria-labelledby="renewals-heading">
          <h2 id="renewals-heading" className="text-xl font-semibold">
            Renewals going up
          </h2>
          {renewals.map((n) => (
            <div
              key={n.id}
              className="flex flex-col gap-2 rounded-xl border border-zinc-200 p-4 text-sm dark:border-zinc-800"
            >
              {(n.status === "asked"
                ? askCallBody(n, policyById(n.policyId))
                : callResultBody(n, policyById(n.policyId))
              )
                .split("\n")
                .map((line) => (
                  <p key={line}>{line}</p>
                ))}
              {n.status === "asked" && (
                <div className="flex flex-wrap gap-3">
                  <form action={callRenewal}>
                    <input type="hidden" name="negotiationId" value={n.id} />
                    <button
                      type="submit"
                      className="inline-flex h-10 items-center rounded-full bg-emerald-700 px-5 font-semibold text-white hover:bg-emerald-800"
                    >
                      Call them
                    </button>
                  </form>
                  <form action={skipRenewal}>
                    <input type="hidden" name="negotiationId" value={n.id} />
                    <button type="submit" className={`h-10 ${LINK}`}>
                      No thanks
                    </button>
                  </form>
                </div>
              )}
            </div>
          ))}
        </section>
      )}

      {changeGroups.length > 0 && (
        <section id="changes" className="flex flex-col gap-3" aria-labelledby="changes-heading">
          <h2 id="changes-heading" className="text-xl font-semibold">
            After life events
          </h2>
          {changeGroups.map(([ref, changes]) => {
            const [intro, ...lines] = coverBody(
              changes[0].event,
              changes,
              policies,
              partner !== null,
            ).split("\n");
            const [apply] = coverActions(changes, partner !== null);
            return (
              <div
                key={ref}
                className="flex flex-col gap-2 rounded-xl border border-zinc-200 p-4 dark:border-zinc-800"
              >
                <p className="font-medium">{intro}</p>
                <ul className="flex flex-col gap-1 text-sm">
                  {lines.map((line) => (
                    <li key={line}>{line.replace(/^- /, "")}</li>
                  ))}
                </ul>
                <div className="flex flex-wrap gap-3">
                  <form action={applyChanges}>
                    <input type="hidden" name="coverEvent" value={ref} />
                    <button
                      type="submit"
                      className="inline-flex h-10 items-center rounded-full bg-emerald-700 px-5 text-sm font-semibold text-white hover:bg-emerald-800"
                    >
                      {apply.label}
                    </button>
                  </form>
                  <form action={dismissChanges}>
                    <input type="hidden" name="coverEvent" value={ref} />
                    <button type="submit" className={`h-10 text-sm ${LINK}`}>
                      Not now
                    </button>
                  </form>
                </div>
              </div>
            );
          })}
        </section>
      )}

      {readings.length > 0 && (
        <section className="flex flex-col gap-3" aria-labelledby="readings">
          <h2 id="readings" className="text-xl font-semibold">
            Read from your documents
          </h2>
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            Nothing here is on your insurance until you confirm it.
          </p>
          <ul className="flex flex-col gap-3">
            {readings.map((reading) => (
              <li
                key={reading.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-zinc-200 p-4 dark:border-zinc-800"
              >
                <span className="font-medium">{reading.title}</span>
                <Link href={`/insurance/read/${reading.id}`} className={`text-sm ${LINK}`}>
                  Check and confirm
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      {cards.cards.length > 0 && (
        <section id="cards" className="flex flex-col gap-3" aria-labelledby="cards-heading">
          <h2 id="cards-heading" className="text-xl font-semibold">
            Cover through your cards
          </h2>
          {payingTwice.map((d) => (
            <p
              key={d.findingId}
              className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-xl bg-amber-50 p-4 text-sm text-amber-950 dark:bg-amber-950 dark:text-amber-50"
            >
              <span>
                You pay {d.merchant}
                {d.annualSavingsCents ? ` ${formatCents(d.annualSavingsCents)} a year` : ""} for
                cover your {d.card} already gives you.
              </span>
              <Link href={`/report/${d.findingId}`} className={LINK}>
                Cancel it
              </Link>
            </p>
          ))}
          {cards.cards.map((card) => (
            <div
              key={card.accountId}
              className="flex flex-col gap-2 rounded-xl border border-zinc-200 p-4 dark:border-zinc-800"
            >
              <h3 className="font-semibold">{card.card}</h3>
              <ul className="flex flex-col gap-1 text-sm">
                {card.benefits.map((b) => (
                  <li key={b.kind}>
                    <span className="font-medium">{b.label}:</span> {limitWords(b)}, when{" "}
                    {conditionWords(b)}.
                  </li>
                ))}
              </ul>
              <p className="text-xs text-zinc-600 dark:text-zinc-400">
                From the card&apos;s benefit guide, checked by our team. The card company&apos;s
                terms decide what&apos;s covered.
              </p>
            </div>
          ))}
        </section>
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
            {totalLine && <p className="text-sm text-zinc-600 dark:text-zinc-400">{totalLine}</p>}
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
