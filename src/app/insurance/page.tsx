import Link from "next/link";
import { ShownLink } from "@/components/shown-link";
import { connection } from "next/server";
import { Suspense } from "react";
import { AppHeader } from "@/components/app-header";
import { DemoAdviceLabel } from "@/components/demo-advice-label";
import type { ReactNode } from "react";
import { AreaPage } from "@/components/area-page/area-page";
import { itemId } from "@/lib/area-pages/insurance";
import { NeedDetail, NeedWorking } from "./perfect-coverage";
import { needKey } from "@/lib/area-pages/insurance-coverage";
import { loadInsuranceArea } from "@/lib/area-pages/insurance-load";
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
import { healthYearLines } from "@/lib/jane-agent/insurance/health-year";
import { riskQuestion } from "@/lib/jane-agent/insurance/risk-words";
import { lowering } from "@/lib/jane-agent/insurance/saving-words";
import { askCallBody, callResultBody } from "@/lib/jane-agent/insurance/done-by-jane-words";
import { coverBody, coverActions } from "@/lib/jane-agent/insurance/cover-words";
import { conditionWords, limitWords } from "@/lib/insurance/card-cover";
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
import { SubmitButton } from "@/components/submit-button";
import { LoadingBar } from "@/components/loading-bar";

// Insurance (spec step 102): every policy in one place, the household facts that matter
// and the gaps, in plain words. Every figure comes from a policy record. Laid out as the area
// page pattern (docs/design/area-pages.md): what matters now, the area's tree, and the detail
// of the one thing picked; the forms and long text wait behind "More".

const LINK = "font-medium text-emerald-700 hover:underline";
const BUTTON =
  "inline-flex h-10 items-center rounded-full bg-emerald-700 px-5 text-sm font-semibold text-white hover:bg-emerald-800";
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
    <div id={`policy-${policy.id}`} className="flex flex-col gap-2 [overflow-wrap:anywhere]">
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
        <SubmitButton className="text-xs text-zinc-500 hover:text-red-700 hover:underline">
          {policy.status === "found" ? "Not insurance" : "Remove"}
        </SubmitButton>
      </form>
    </div>
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
  const [loaded, autopilot, insuranceArea] = await Promise.all([
    loadInsuranceArea(user.id, {
      now,
      refresh: true,
      need: one("need"),
      policyId: one("policy"),
    }),
    autopilotOf(user.id),
    // Spec step 141: what the Insurance area may do by itself.
    autopilotFor(user.id, "insurance", { now }),
  ]);
  const {
    policies,
    household,
    gaps,
    advice,
    readings,
    cards,
    partner,
    savings,
    family,
    healthYear,
    risks,
    renewals,
    changeGroups,
    payingTwice,
    coverage,
    policyById,
    area,
  } = loaded;
  const familyError = one("family");
  const saved = SAVED[one("saved")];
  const add = one("add");
  const typed = (fact: { value: number | string | null; from: string | null }) =>
    fact.from === "you" && fact.value !== null ? String(fact.value) : "";
  const totalLine = premiumTotalLine(policies);
  const result = one("picked");

  // Each item's detail: its actions (and its own card), and what sits behind More.
  const details: Record<string, ReactNode> = {};
  const more: Record<string, ReactNode> = {};

  for (const n of coverage.needs) {
    const id = itemId("needs", needKey(n));
    details[id] = (
      <NeedDetail need={n} coverage={coverage} advice={advice} policyId={one("policy")} />
    );
    more[id] = <NeedWorking need={n} />;
  }
  for (const gap of gaps) {
    const id = itemId("missing", gap.key + (gap.policyId ? `-${gap.policyId}` : ""));
    details[id] = (
      <div className="flex flex-col gap-2 text-sm">
        <h3 className="text-base font-semibold">{gap.title}</h3>
        {advice && (
          <div className="flex flex-col gap-1">
            <p className="font-medium">{gapAdvice(gap).text}</p>
            <DemoAdviceLabel />
          </div>
        )}
        <div className="flex flex-wrap items-center gap-4">
          {gap.policyId ? (
            <Link
              href={`/insurance?edit=${gap.policyId}&focus=${encodeURIComponent(itemId("policies", gap.policyId))}`}
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
            <SubmitButton className="underline">I don&apos;t need it</SubmitButton>
          </form>
        </div>
      </div>
    );
    more[id] = <p>{gap.why}</p>;
  }
  for (const s of savings) {
    const id = itemId("savings", s.id);
    details[id] = (
      <div className="flex flex-col gap-2 text-sm">
        {lowering([s]).length > 0 && (
          <p className="text-zinc-600 dark:text-zinc-400">
            This one lowers your cover: if you claim, you pay{" "}
            {formatCents((s.detail.toDeductibleCents ?? 0) - (s.detail.fromDeductibleCents ?? 0))}{" "}
            more yourself.
          </p>
        )}
        <div className="flex flex-wrap gap-3">
          <form action={applyOneSaving}>
            <input type="hidden" name="savingId" value={s.id} />
            <SubmitButton className={BUTTON}>
              {lowering([s]).length > 0 ? "Raise it" : "Do it"}
            </SubmitButton>
          </form>
          <form action={skipSaving}>
            <input type="hidden" name="savingId" value={s.id} />
            <SubmitButton className={`h-10 ${LINK}`}>No thanks</SubmitButton>
          </form>
        </div>
        <DemoAdviceLabel />
      </div>
    );
  }
  for (const n of renewals) {
    const id = itemId("renewals", n.id);
    const lines = (
      n.status === "asked"
        ? askCallBody(n, policyById(n.policyId))
        : callResultBody(n, policyById(n.policyId))
    ).split("\n");
    details[id] =
      n.status === "asked" ? (
        <div className="flex flex-wrap gap-3 text-sm">
          <form action={callRenewal}>
            <input type="hidden" name="negotiationId" value={n.id} />
            <SubmitButton className={BUTTON}>Call them</SubmitButton>
          </form>
          <form action={skipRenewal}>
            <input type="hidden" name="negotiationId" value={n.id} />
            <SubmitButton className={`h-10 ${LINK}`}>No thanks</SubmitButton>
          </form>
        </div>
      ) : null;
    if (lines.length > 1) {
      more[id] = lines.slice(1).map((line) => <p key={line}>{line}</p>);
    }
  }
  for (const [ref, changes] of changeGroups) {
    const id = itemId("changes", ref);
    // The first line is the event, which the summary already says.
    const [, ...lines] = coverBody(changes[0].event, changes, policies, partner !== null).split(
      "\n",
    );
    const [apply] = coverActions(changes, partner !== null);
    details[id] = (
      <div className="flex flex-col gap-2 text-sm">
        <ul className="flex flex-col gap-1">
          {lines.map((line) => (
            <li key={line}>{line.replace(/^- /, "")}</li>
          ))}
        </ul>
        <div className="flex flex-wrap gap-3">
          <form action={applyChanges}>
            <input type="hidden" name="coverEvent" value={ref} />
            <SubmitButton className={BUTTON}>{apply.label}</SubmitButton>
          </form>
          <form action={dismissChanges}>
            <input type="hidden" name="coverEvent" value={ref} />
            <SubmitButton className={`h-10 ${LINK}`}>Not now</SubmitButton>
          </form>
        </div>
      </div>
    );
  }
  for (const reading of readings) {
    details[itemId("documents", reading.id)] = (
      <Link href={`/insurance/read/${reading.id}`} className={`text-sm ${LINK}`}>
        Check and confirm
      </Link>
    );
  }
  for (const d of payingTwice) {
    details[itemId("cards", `twice-${d.findingId}`)] = (
      <Link href={`/report/${d.findingId}`} className={`text-sm ${LINK}`}>
        Cancel it
      </Link>
    );
  }
  for (const card of cards.cards) {
    const id = itemId("cards", card.accountId);
    details[id] = (
      <ul className="flex flex-col gap-1 text-sm">
        {card.benefits.map((b) => (
          <li key={b.kind}>
            <span className="font-medium">{b.label}:</span> {limitWords(b)}, when{" "}
            {conditionWords(b)}.
          </li>
        ))}
      </ul>
    );
    more[id] = (
      <p className="text-xs text-zinc-600 dark:text-zinc-400">
        From the card&apos;s benefit guide, checked by our team. The card company&apos;s terms
        decide what&apos;s covered.
      </p>
    );
  }
  for (const p of policies) {
    const id = itemId("policies", p.id);
    details[id] = <PolicyCard policy={p} asOf={asOf} editing={one("edit") === p.id} />;
  }
  for (const r of risks) {
    const id = itemId("questions", r.id);
    details[id] = (
      <form action={answerRiskForm} className="flex gap-3">
        <input type="hidden" name="riskId" value={r.id} />
        <SubmitButton name="answer" value="yes" className={BUTTON}>
          Yes
        </SubmitButton>
        <SubmitButton
          name="answer"
          value="no"
          className="inline-flex h-10 items-center rounded-full border border-zinc-300 px-5 text-sm font-medium dark:border-zinc-700"
        >
          No
        </SubmitButton>
      </form>
    );
    more[id] = <p>{riskQuestion(r)}</p>;
  }
  for (const row of family.rows) {
    details[itemId("household", row.name)] = (
      <div className="flex flex-col gap-1 text-sm">
        <p>
          {row.name}
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
        </p>
        {family.people.some((p) => p.name === row.name) && (
          <form action={removePersonForm}>
            <input type="hidden" name="name" value={row.name} />
            <SubmitButton className={`text-xs ${LINK}`}>Remove</SubmitButton>
          </form>
        )}
      </div>
    );
  }
  details[itemId("household", "add")] = (
    <div className="flex flex-col gap-3 text-sm">
      {familyError && (
        <p role="alert" className="text-red-700 dark:text-red-400">
          {familyError}
        </p>
      )}
      <form action={addPersonForm} className="flex flex-wrap items-end gap-3">
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
        <SubmitButton className={BUTTON}>Add them</SubmitButton>
      </form>
    </div>
  );
  more[itemId("household", "add")] = (
    <ul className="flex flex-col gap-2">
      {family.healthPlans.length > 1 && (
        <li>
          Health plans for the whole household, a year:{" "}
          {family.healthPlans
            .map((r) => `${r.label}: about ${formatCents(r.familyYearlyCents)}`)
            .join("; ")}
        </li>
      )}
      {policies
        .filter((p) => p.status === "active")
        .map((p) => {
          const mine = family.policies.find((f) => f.id === p.id);
          return (
            <li key={p.id}>
              <span className="font-medium">
                {p.carrier} {kindName(p.kind)}
              </span>
              <form action={setSharedForm} className="inline-block pl-3">
                <input type="hidden" name="policyId" value={p.id} />
                <input type="hidden" name="shared" value={p.sharedWithHousehold ? "no" : "yes"} />
                <SubmitButton className={LINK}>
                  {p.sharedWithHousehold ? "Shared: stop sharing" : "Share with my household"}
                </SubmitButton>
              </form>
              {family.people.map((person) => {
                const covers = (mine?.covered ?? []).some((c) => c.name === person.name);
                return (
                  <form key={person.name} action={setCoveredForm} className="inline-block pl-3">
                    <input type="hidden" name="policyId" value={p.id} />
                    <input type="hidden" name="name" value={person.name} />
                    <input type="hidden" name="covered" value={covers ? "no" : "yes"} />
                    <SubmitButton className={LINK}>
                      {covers ? `Covers ${person.name}: remove` : `Add ${person.name}`}
                    </SubmitButton>
                  </form>
                );
              })}
            </li>
          );
        })}
    </ul>
  );
  if (healthYear) {
    const id = itemId("health", "deductible");
    details[id] = (
      <div className="flex flex-col gap-2 text-sm">
        <progress
          className="w-full"
          aria-label="Deductible met"
          value={healthYear.progress.deductibleMetCents}
          max={healthYear.plan.deductibleCents}
        />
        <ul className="flex flex-col gap-1">
          {healthYearLines(healthYear).map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      </div>
    );
  }

  // Opened from a gap's "I have this: add it" or a policy's edit link: that part is open.
  const focus =
    one("focus") ||
    (one("need")
      ? itemId("needs", `${one("need")}${one("policy") ? `-${one("policy")}` : ""}`)
      : "") ||
    (one("edit") ? itemId("policies", one("edit")) : "");

  return (
    <>
      <AppHeader user={user} />
      <ViewTracker event="insurance_viewed" />
      <div className="flex flex-col gap-2">
        <h1 className="text-3xl font-semibold tracking-tight">Insurance</h1>
        <p className="text-zinc-600 dark:text-zinc-400">
          Your cover at a glance. Open a branch to see more.
        </p>
        <nav aria-label="Insurance pages" className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
          <Link prefetch={false} href="/insurance/checkup" className={LINK}>
            Checkup
          </Link>
          <ShownLink prefetch={false} href="/insurance/claims" className={LINK}>
            Claims
          </ShownLink>
          <ShownLink prefetch={false} href="/insurance/benefits" className={LINK}>
            Work benefits
          </ShownLink>
          {advice && (
            <ShownLink prefetch={false} href="/insurance/life" className={LINK}>
              Life cover
            </ShownLink>
          )}
        </nav>
      </div>

      {(saved || result) && (
        <p
          role="status"
          className="bg-emerald-50 p-3 text-sm text-emerald-900 dark:bg-emerald-950 dark:text-emerald-100"
        >
          {saved ?? result}
        </p>
      )}

      <AreaPage
        tree={area.tree}
        label="Insurance"
        chips={area.chips}
        summaries={area.summaries}
        details={details}
        more={more}
        focus={focus || undefined}
      />

      {/* Below the tree: nothing open by default (docs/design/area-pages.md). */}
      <div className="flex flex-col gap-2">
        <details className="border-t border-zinc-200 pt-2 dark:border-zinc-800">
          <summary className={`cursor-pointer text-sm ${LINK}`}>How Jane handles insurance</summary>
          <div className="mt-2 flex flex-col gap-2 text-sm text-zinc-600 dark:text-zinc-400">
            <p>
              Jane reads your{" "}
              <Link href="/documents" className={LINK}>
                policy documents
              </Link>{" "}
              and adds each one once you confirm what Jane read. Unless you let Jane switch for you
              in Settings, it never buys, changes or cancels insurance without your tap.
            </p>
            {/* Spec steps 108 and 141: what Jane does with insurance on its own. */}
            <p>
              On autopilot: {autopilotReply(autopilot, insuranceArea).body}{" "}
              <Link href="/settings#sectors" className={LINK}>
                Change it
              </Link>
            </p>
            {totalLine && <p>{totalLine}</p>}
          </div>
        </details>
        <details className="border-t border-zinc-200 pt-2 dark:border-zinc-800">
          <summary className={`cursor-pointer text-sm ${LINK}`}>Your household details</summary>
          <div className="mt-2 flex flex-col gap-2">
            <p className="text-sm text-zinc-600 dark:text-zinc-400">
              Leave a box blank and Jane reads it from your accounts where it can.
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
          </div>
        </details>
        <details
          id="add"
          open={add !== "" || policies.length === 0}
          className="border-t border-zinc-200 pt-2 dark:border-zinc-800"
        >
          <summary className={`cursor-pointer text-sm ${LINK}`}>
            {policies.length === 0 ? "Add a policy" : "Add another policy"}
          </summary>
          <div className="mt-2">
            <PolicyForm
              key={add}
              policyId=""
              values={{ ...EMPTY_POLICY_INPUT, kind: isPolicyKind(add) ? add : "auto" }}
            />
          </div>
        </details>
      </div>
    </>
  );
}

export default function InsurancePage({ searchParams }: PageProps<"/insurance">) {
  return (
    <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-5 px-4 py-6 sm:px-6 sm:py-8">
      <Suspense fallback={<LoadingBar />}>
        <InsuranceContent searchParams={searchParams} />
      </Suspense>
    </main>
  );
}
