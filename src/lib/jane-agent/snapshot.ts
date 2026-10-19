import { createHash } from "node:crypto";
import { PLAN_URGENT_FINDING_TYPES } from "@/config/plan";
import { loadDetectionInput } from "@/detection/engine";
import type { DetectionInput } from "@/detection/types";
import type { AlertType, FindingType, PrismaClient } from "@/generated/prisma/client";
import type { ComingUpRow } from "@/insights/coming-up";
import type { Deadline } from "@/insights/deadlines";
import type { LifeGuess } from "@/insights/life-signals";
import { isUrgent, newestUnreadAlerts } from "@/lib/alerts";
import { loadChanges, type ChangeView } from "@/lib/changes";
import { lastControllerRun, type LastRun } from "@/lib/controller-log";
import { latestPaycheckPlan, type PaycheckPlanView } from "@/lib/money-movement/paycheck";
import { lifeGuessesFor } from "@/lib/life-guesses";
import { loadUpkeep, type UpkeepSnapshot } from "@/lib/plan-upkeep";
import { provenSavings } from "@/lib/savings-proof";
import { comparisonsFor } from "@/lib/compare";
import { db as defaultClient } from "@/lib/db";
import { scopedFor } from "@/lib/db-scoped";
import { weekStart } from "@/lib/digest/week";
import { homeSummary, type HomeSummary } from "@/lib/home";
import { planFor } from "@/lib/plan";
import { isNoRisk } from "@/lib/plan-links";
import { savingsLine } from "@/lib/savings-text";
import { recentRuleApprovals } from "@/lib/standing-rules";
import { loadInvestmentSnapshot, type InvestmentSnapshot } from "./investments/snapshot";
import { loadMore, type MoreSnapshot } from "./snapshot-more";
import { loadTaxSnapshot, type TaxSnapshot } from "./snapshot-tax";
import { nameMatches } from "./names";
import { keeps, listPreferences, neverKeys } from "./preferences";

// Everything Jane's brain looks at for one person (spec step 82), loaded with the same
// code as the pages that show it: Today (src/lib/home.ts), the plan, the comparisons, the
// standing rules and the alerts. Null when the person has no accounts yet.

export type SnapshotFinding = {
  findingId: string;
  type: FindingType;
  title: string;
  annualSavingsCents: number | null;
  // "Could save about $X a year", as the cards say it.
  savings: string;
  fingerprint: string;
  urgent: boolean;
  // Jane's pick when the finding compares options (spec step 76): what it saves in the
  // first year (bills) or earns more a year (savings).
  pick: { optionId: string; name: string; savingCents: number; savings: boolean } | null;
  // Spec step 143: how sure detection is, for the priority engine. Optional for snapshots
  // built by hand.
  confidence?: "high" | "medium" | "low";
};

export type Snapshot = {
  timezone: string | null;
  // The day the loaders worked from (UTC), YYYY-MM-DD.
  asOf: string;
  // The Monday of the person's week, for the weekly plan.
  weekStart: string;
  safeToSpend: { safeCents: number; payday: string | null } | null;
  comingUp: ComingUpRow[];
  waitingOnYou: { id: string; title: string; todo: string | null }[];
  // Open findings, in the plan's order.
  findings: SnapshotFinding[];
  plan: {
    items: number;
    annualSavingsCents: number;
    // Ticked, no-risk items: what "Approve all safe ones" would approve.
    safeItems: number;
  };
  ruleApprovals: {
    decisionId: string;
    title: string;
    ruleLabel: string;
    createdAt: Date;
    canUndo: boolean;
  }[];
  finished: {
    actionId: string;
    title: string;
    confirmedCents: number | null;
    completedAt: Date | null;
  }[];
  deadlines: Deadline[];
  budgetsOver: { category: string; overCents: number; month: string }[];
  goalsBehind: { id: string; name: string; leftCents: number }[];
  urgentAlerts: { id: string; title: string; body: string }[];
  // Spec step 83: every budget this month, for "nearly over".
  budgetProgress: HomeSummary["budgetProgress"];
  // Spec step 97: changes Jane noticed, not yet said to be expected. Optional so snapshots
  // built by hand in tests needn't list them.
  changes?: ChangeView[];
  // Spec step 100: life events Jane spotted and hasn't asked about. Optional, like changes.
  lifeGuesses?: LifeGuess[];
  // Spec step 101: this month's budget tune-up, transfers to count toward a goal, and what
  // autopilot counted lately. Optional, like changes.
  upkeep?: UpkeepSnapshot;
  // Spec step 139: the savings the person's transactions confirm. Optional, like changes.
  saved?: { confirmedCents: number };
  // Spec step 140: Jane hasn't said anything to this person yet (the first-run hello).
  firstChat?: boolean;
  // Spec step 142: last night's controller run, if recent. Optional, like changes.
  lastRun?: LastRun | null;
  // Spec step 144: the newest paycheck's plan. Optional, like changes.
  paycheck?: PaycheckPlanView | null;
  // Spec step 128 on: what's in investment accounts.
  investments?: InvestmentSnapshot;
  // Spec step 91: suggestions the person said never to make again (preference keys);
  // findings among them are already left out of findings above.
  neverSuggest?: string[];
} & MoreSnapshot &
  TaxSnapshot;

// A finding as Jane describes it in the chat: its type, title, saving and evidence. A
// button only acts while this is unchanged; newer card wording (Claude's explanation)
// doesn't change it.
export function findingFingerprint(finding: {
  id: string;
  type: string;
  title: string;
  annualSavingsCents: number | null;
  evidence: unknown;
}): string {
  return createHash("sha256")
    .update(
      JSON.stringify([
        finding.id,
        finding.type,
        finding.title,
        finding.annualSavingsCents,
        finding.evidence,
      ]),
    )
    .digest("hex");
}

// Spec step 91: findings that suggest cutting something, which "I need my …" rules out.
const CUTTING: readonly FindingType[] = [
  "subscription_review",
  "duplicate_subscription",
  "trial_conversion",
];

// The newest unread alerts the brain looks at for urgent ones.
const ALERTS_LOOKED_AT = 10;
// Urgent alerts Jane says another way: a deadline reminder as the deadline's heads-up, a
// double charge as its finding (with Yes and No).
const ALERTS_SAID_ELSEWHERE: readonly AlertType[] = ["deadline_soon", "duplicate_charge"];

async function thinking(
  userId: string,
  client: PrismaClient,
  now: Date,
  given: DetectionInput | undefined,
) {
  const input = given ?? (await loadDetectionInput(userId, { client, now }));
  const [changes, lifeGuesses, saved] = await Promise.all([
    loadChanges(userId, { client, now, input }),
    lifeGuessesFor(userId, { client, now, input }),
    provenSavings(userId, { client, now, input }),
  ]);
  return { changes, lifeGuesses, saved: { confirmedCents: saved.confirmedCents } };
}

export async function loadSnapshot(
  userId: string,
  {
    client = defaultClient,
    now = new Date(),
    input,
  }: {
    client?: PrismaClient;
    now?: Date;
    // The bank data, when the caller already loaded it (Jane's run does).
    input?: DetectionInput;
  } = {},
): Promise<Snapshot | null> {
  const home = await homeSummary(userId, { client, now });
  if (!home) return null;
  const db = scopedFor(userId, client);
  // The person's own timezone: users have their own helpers, so a direct read by id.
  const [user, plan, ruleApprovals, alerts, said, preferences] = await Promise.all([
    client.user.findUnique({ where: { id: userId }, select: { timezone: true } }),
    planFor(userId, { client }),
    recentRuleApprovals(userId, { client, now }),
    newestUnreadAlerts(userId, { client, limit: ALERTS_LOOKED_AT }),
    db.janeMessages.count(),
    listPreferences(userId, { client }),
  ]);
  const findings = await db.findings.findMany({
    where: { id: { in: plan.map((i) => i.card.findingId) } },
    select: {
      id: true,
      key: true,
      type: true,
      title: true,
      annualSavingsCents: true,
      evidence: true,
      confidence: true,
    },
  });
  // Spec step 91: never a finding the person said not to suggest again, nor cutting
  // something they said they need.
  const never = neverKeys(preferences);
  const kept = keeps(preferences);
  const wanted = (f: (typeof findings)[number]) =>
    !never.has(`finding:${f.key}`) &&
    !(CUTTING.includes(f.type) && kept.some((target) => nameMatches(target, f.title)));
  const byId = new Map(findings.filter(wanted).map((f) => [f.id, f]));
  const open = plan.flatMap((item) => {
    const finding = byId.get(item.card.findingId);
    return finding ? [{ item, finding }] : [];
  });
  const comparisons = await comparisonsFor(
    open.map((o) => o.finding),
    { userId, client, now },
  );

  return {
    timezone: user?.timezone ?? null,
    asOf: now.toISOString().slice(0, 10),
    weekStart: weekStart(now, user?.timezone).toISOString().slice(0, 10),
    safeToSpend: home.safeToSpend
      ? { safeCents: home.safeToSpend.safeCents, payday: home.safeToSpend.payday }
      : null,
    comingUp: home.comingUp,
    waitingOnYou: home.waitingOnYou,
    findings: open.map(({ finding }, index): SnapshotFinding => {
      const comparison = comparisons[index];
      return {
        findingId: finding.id,
        type: finding.type,
        title: finding.title,
        annualSavingsCents: finding.annualSavingsCents,
        savings: savingsLine(finding.type, finding.annualSavingsCents),
        fingerprint: findingFingerprint(finding),
        urgent: PLAN_URGENT_FINDING_TYPES.includes(finding.type),
        confidence: finding.confidence,
        pick: comparison
          ? {
              optionId: comparison.pick.option.id,
              name: comparison.pick.option.name,
              savingCents: comparison.pick.savingCents,
              savings: comparison.current.kind === "savings",
            }
          : null,
      };
    }),
    plan: {
      items: home.plan.items,
      annualSavingsCents: home.plan.annualSavingsCents,
      safeItems: plan.filter(isNoRisk).length,
    },
    ruleApprovals,
    finished: home.janeDid.finished,
    deadlines: home.deadlines,
    budgetsOver: home.budgetsOver,
    goalsBehind: home.goalsBehind,
    urgentAlerts: alerts
      .filter((a) => isUrgent(a.type) && !ALERTS_SAID_ELSEWHERE.includes(a.type))
      .map((a) => ({ id: a.id, title: a.title, body: a.body })),
    budgetProgress: home.budgetProgress,
    ...(await loadMore(userId, { client, now })),
    ...(await loadTaxSnapshot(userId, { client, now })),
    // Spec steps 97, 100 and 139 read the same bank data, so it's loaded once for them.
    ...(await thinking(userId, client, now, input)),
    firstChat: said === 0,
    lastRun: await lastControllerRun(userId, { client, now }),
    paycheck: await latestPaycheckPlan(userId, { client, now }),
    upkeep: await loadUpkeep(userId, { client, now }),
    investments: await loadInvestmentSnapshot(userId, { client, now }),
    neverSuggest: [...never],
  };
}
