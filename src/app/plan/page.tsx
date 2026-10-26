import Link from "next/link";
import { isHiddenPage } from "@/config/hidden-pages";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { AppHeader } from "@/components/app-header";
import { ViewTracker } from "@/components/view-tracker";
import { scopedDb } from "@/lib/db-scoped";
import { formatCents } from "@/lib/money";
import { markPlanShown, planFor } from "@/lib/plan";
import { savingsLine } from "@/lib/savings-text";
import { requireUser } from "@/lib/session";
import { conciergeMode } from "@/lib/concierge-mode";
import { selfServe } from "@/lib/diy";
import { recentRuleApprovals } from "@/lib/standing-rules";
import { openProposals, recentAutoCategories, refreshProposals } from "@/lib/proposals";
import { categoryOptions } from "@/lib/categories";
import { BUDGET_SUGGESTION_MONTHS } from "@/config/budgets";
import { EMERGENCY_FUND_MONTHS } from "@/config/proposals";

const sentenceStart = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);
import type { Proposal } from "@/planning/proposals";
import { PlanItem } from "./plan-item";
import { RuleApprovals } from "./rule-approvals";
import { SetupItem, type SetupView } from "./setup-item";
import { UseAllSuggestions } from "./use-all";
import { AutopilotChooser } from "@/components/autopilot-chooser";
import { autopilotOf } from "@/lib/autopilot";
import { YesToAll } from "./yes-to-all";
import { loadYearPlan } from "@/lib/year-plan";
import { YearPlanSection } from "./year-plan-section";
import { LoadingBar } from "@/components/loading-bar";

// How many items the plan opens with; the rest are behind "More" (founder: "show what matters,
// hide the rest").
const TOP = 3;
const MORE = "cursor-pointer text-sm font-medium underline underline-offset-2 hover:no-underline";

async function Plan({ searchParams }: { searchParams: PageProps<"/plan">["searchParams"] }) {
  const user = await requireUser();
  const db = await scopedDb();
  if ((await db.accounts.count()) === 0) redirect("/connect");
  await refreshProposals(user.id);
  const [items, byRules, setup, autopilot, filed, concierge] = await Promise.all([
    planFor(user.id),
    recentRuleApprovals(user.id),
    openProposals(user.id),
    autopilotOf(user.id),
    recentAutoCategories(user.id),
    conciergeMode(user.id),
  ]);
  // Read-only mode: for a real account nobody acts for them, so each item is theirs to do,
  // with Jane's steps on its page; no "Yes to all" and no autopilot.
  const readOnly = !concierge;
  const year = await loadYearPlan(user.id).catch(() => null);
  const setupMoney = setup.filter((p) => p.kind !== "category").length;
  await markPlanShown(
    user.id,
    items.map((i) => i.card.findingId),
  );
  const total = items.reduce(
    (sum, i) => sum + (i.countedElsewhere ? 0 : (i.card.annualSavingsCents ?? 0)),
    0,
  );
  // After "Yes to all".
  const params = await searchParams;
  const count = (value: unknown) => {
    const n = Number(typeof value === "string" ? value : NaN);
    return Number.isInteger(n) && n >= 0 ? n : null;
  };
  const approved = count(params.approved);
  const skipped = count(params.skipped) ?? 0;
  // The plan comes urgent first, then by what it's worth (src/lib/plan.ts).
  const top = items.slice(0, TOP);
  const rest = items.slice(TOP);
  const itemOf = (i: (typeof items)[number]) => (
    <PlanItem
      key={i.card.findingId}
      item={{
        findingId: i.card.findingId,
        cardHash: i.cardHash,
        actionType: i.card.actionType,
        title: i.card.title,
        whatChanges: (readOnly ? selfServe(i.card) : i.card).whatChanges,
        savings: savingsLine(i.card.findingType, i.card.annualSavingsCents),
        urgent: i.urgent,
        options: i.options,
      }}
      readOnly={readOnly}
    />
  );

  return (
    <>
      <AppHeader user={user} />
      <ViewTracker event="plan_viewed" />
      {approved !== null && (
        <p role="status" className="rounded-xl bg-emerald-50 p-4 dark:bg-emerald-950">
          Approved {approved} {approved === 1 ? "thing" : "things"}. Jane is on it
          {!isHiddenPage("/actions") && (
            <>
              ; follow along on{" "}
              <Link href="/actions" className="font-medium text-emerald-700 underline">
                your actions
              </Link>
            </>
          )}
          .
          {skipped > 0 &&
            ` ${skipped} changed or were already answered, so they were left for you to look at again.`}
        </p>
      )}
      <div className="flex flex-col gap-2">
        <h1 className="text-3xl font-semibold tracking-tight">Jane&apos;s plan</h1>
        {items.length === 0 ? (
          <p className="text-zinc-600 dark:text-zinc-400">
            Nothing to decide right now. Jane keeps watching and adds to your plan when it finds
            something.
            {!isHiddenPage("/actions") && (
              <>
                {" "}
                See what&apos;s underway on{" "}
                <Link href="/actions" className="font-medium text-emerald-700 hover:underline">
                  your actions
                </Link>
                .
              </>
            )}
          </p>
        ) : (
          <p className="text-zinc-600 dark:text-zinc-400">
            {items.length} {items.length === 1 ? "thing" : "things"}{" "}
            {readOnly ? "you could do" : "Jane can do for you"}
            {total > 0
              ? `, worth up to about ${formatCents(total)} a year if you say yes to all`
              : ""}
            .{" "}
            {readOnly
              ? "Each has Jane's steps and drafts. Nothing changes unless you do it."
              : "The three that matter most are first; one tap to go ahead, and Revert if you change your mind."}
          </p>
        )}
        {!readOnly && (
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            Want Jane to do more without asking?{" "}
            <Link
              href="/settings#autopilot"
              className="font-medium text-emerald-700 hover:underline"
            >
              Autopilot settings
            </Link>
            .
          </p>
        )}
      </div>
      {/* What matters now (docs/design/area-pages.md): the three that matter most, open; the
          rest of the plan and everything else behind closed "More" sections. */}
      {top.length > 0 && (
        <section aria-labelledby="plan-top" className="flex flex-col gap-3">
          <h2 id="plan-top" className="text-xl font-semibold">
            What matters now
          </h2>
          <ul className="flex flex-col gap-3">{top.map(itemOf)}</ul>
        </section>
      )}
      {rest.length > 0 && (
        <details data-plan-more="" className="border-t border-zinc-200 pt-3 dark:border-zinc-800">
          <summary className={MORE}>{rest.length} more on your plan</summary>
          <ul className="mt-3 flex flex-col gap-3">{rest.map(itemOf)}</ul>
        </details>
      )}
      {items.length > 1 && !readOnly && (
        <details className="border-t border-zinc-200 pt-3 dark:border-zinc-800">
          <summary className={MORE}>Go ahead with several at once</summary>
          <div className="mt-3">
            <YesToAll
              items={items.map((i) => ({
                findingId: i.card.findingId,
                cardHash: i.cardHash,
                title: i.card.title,
                savings: savingsLine(i.card.findingType, i.card.annualSavingsCents),
                preselected: i.preselected,
              }))}
            />
          </div>
        </details>
      )}
      {autopilot === null && !readOnly && (
        <details className="border-t border-zinc-200 pt-3 dark:border-zinc-800">
          <summary className={MORE}>How much Jane does on its own</summary>
          <div className="mt-3">
            <AutopilotChooser compact />
          </div>
        </details>
      )}
      {byRules.length > 0 && (
        <details className="border-t border-zinc-200 pt-3 dark:border-zinc-800">
          <summary className={MORE}>Done by your rules ({byRules.length})</summary>
          <div className="mt-3">
            <RuleApprovals
              approvals={byRules.map((a) => ({
                decisionId: a.decisionId,
                title: a.title,
                ruleLabel: a.ruleLabel,
                canUndo: a.canUndo,
              }))}
            />
          </div>
        </details>
      )}
      {(setup.length > 0 || filed.length > 0) && (
        <details className="border-t border-zinc-200 pt-3 dark:border-zinc-800">
          <summary className={MORE}>Set up, from your own numbers ({setup.length})</summary>
          <div className="mt-3 flex flex-col gap-3">
            {setupMoney > 1 && <UseAllSuggestions count={setupMoney} />}
            <ul className="flex flex-col gap-3">
              {setup.map((p) => (
                <SetupItem key={p.key} item={setupView(p)} />
              ))}
            </ul>
            {filed.length > 0 && (
              <p className="text-sm text-zinc-600 dark:text-zinc-400">
                Jane filed {filed.map((f) => f.merchantName).join(", ")} into{" "}
                {filed.length === 1 ? "a category" : "categories"} from our merchant directory.{" "}
                <Link href="/transactions" className="font-medium text-emerald-700 hover:underline">
                  Change or undo
                </Link>
              </p>
            )}
          </div>
        </details>
      )}
      {year && (
        <details className="border-t border-zinc-200 pt-3 dark:border-zinc-800">
          <summary className={MORE}>Your year</summary>
          <div className="mt-3">
            <YearPlanSection plan={year} />
          </div>
        </details>
      )}
    </>
  );
}

const CATEGORIES = categoryOptions().flatMap((group) =>
  group.options.map((o) => ({ value: o.value, label: `${group.label}: ${o.label}` })),
);
const monthYear = (iso: string) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });

// A proposal as the plan shows it: what Jane would set up, and the numbers behind it.
function setupView(p: Proposal): SetupView {
  if (p.kind === "budget") {
    return {
      key: p.key,
      title: `Set a ${formatCents(p.amountCents)} monthly budget for ${p.category}`,
      basis: `Your own average over the last ${BUDGET_SUGGESTION_MONTHS} complete months, rounded up. Math from your data, not advice.`,
      fields: [{ kind: "amount", label: "Monthly budget ($)", value: String(p.amountCents / 100) }],
    };
  }
  if (p.kind === "goal" && p.monthlySetAsideCents !== undefined) {
    // Spec step 70: the yearly and irregular bills, a month at a time.
    return {
      key: p.key,
      title: `Save for yearly bills: ${formatCents(p.targetCents)} by ${monthYear(p.targetDate)}`,
      basis: `Your yearly and irregular bills come to ${formatCents(p.monthlySetAsideCents)} a month (see Budgets), so a year of that. Math from your data, not a recommendation.`,
      fields: [
        { kind: "amount", label: "Amount ($)", value: String(p.targetCents / 100) },
        { kind: "date", label: "By", value: p.targetDate },
      ],
    };
  }
  if (p.kind === "goal") {
    return {
      key: p.key,
      title: `Start an emergency fund: ${formatCents(p.targetCents)} by ${monthYear(p.targetDate)}`,
      basis: `${sentenceStart(p.basis ?? `${EMERGENCY_FUND_MONTHS} months of your own average spending`)} (${formatCents(p.monthlySpendingCents)} a month). Math from your data, not advice.`,
      fields: [
        { kind: "amount", label: "Amount ($)", value: String(p.targetCents / 100) },
        { kind: "date", label: "By", value: p.targetDate },
      ],
    };
  }
  const label = CATEGORIES.find((c) => c.value === p.detailed)?.label ?? p.detailed;
  return {
    key: p.key,
    title: `Put ${p.merchantName} under ${label}`,
    basis: `${p.transactions} charges with no category. This is the category our merchant directory has for it.`,
    fields: [{ kind: "category", label: "Category", value: p.detailed, options: CATEGORIES }],
  };
}

export default function PlanPage({ searchParams }: PageProps<"/plan">) {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-4 py-10 sm:px-6 sm:py-12">
      <Suspense fallback={<LoadingBar label="Putting your plan together" />}>
        <Plan searchParams={searchParams} />
      </Suspense>
    </main>
  );
}
