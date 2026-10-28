import { conciergeMode } from "@/lib/concierge-mode";
import { createHash } from "node:crypto";
import { PLAN_URGENT_FINDING_TYPES } from "@/config/plan";
import { loadDetectionInput } from "@/detection/engine";
import type { DetectionInput } from "@/detection/types";
import type { AlertType, FindingType, PrismaClient } from "@/generated/prisma/client";
import type { ComingUpRow } from "@/insights/coming-up";
import type { Deadline } from "@/insights/deadlines";
import type { LifeGuess } from "@/insights/life-signals";
import { newestUnreadAlerts } from "@/lib/alerts";
import { loadChanges, type ChangeView } from "@/lib/changes";
import { lastControllerRun, type LastRun } from "@/lib/controller-log";
import { loadBillPay, type BillPayView } from "@/lib/money-movement/bill-pay";
import { healthFor, type HealthView } from "@/lib/health-score";
import type { Attention } from "./attention";
import { loadAttention } from "./attention-load";
import { resultsByKind, type KindResult } from "@/lib/worked";
import { openBooks, type BooksView } from "@/lib/books";
import { loadClose, type CloseView } from "@/lib/month-close";
import { offeredToday, type OfferedSuggestion } from "@/lib/suggestions";
import { loadSteady, type SteadyView } from "@/lib/steady-pay";
import { loadPriceRises } from "@/lib/price-rises";
import type { PriceRise } from "@/planning/price-rises";
import { loadMoneyForTwo, type MoneyForTwoView } from "@/lib/money-for-two";
import { loadTradeoffs, type TradeoffView } from "@/lib/goal-tradeoffs";
import { nextQuestion, type OpenQuestion } from "@/lib/questions";
import { loadRentQuestion } from "@/lib/rent-question";
import type { RentTransfer } from "@/detection/rent-transfers";
import { adoptedPlans, type AdoptedPlan } from "@/lib/what-if";
import { openLean, recentlyEnded, type LeanState } from "@/lib/lean-plan";
import { recentReport, type StoredReport } from "@/lib/monthly-report-store";
import { moneyPartnerFor } from "@/lib/money-movement/partner";
import { latestPaycheckPlan, type PaycheckPlanView } from "@/lib/money-movement/paycheck";
import { lifeGuessesFor } from "@/lib/life-guesses";
import { loadUpkeep, type UpkeepSnapshot } from "@/lib/plan-upkeep";
import { verifiedSavings } from "@/lib/savings-proof";
import { comparisonsFor } from "@/lib/compare";
import { db as defaultClient } from "@/lib/db";
import { scopedFor } from "@/lib/db-scoped";
import { weekStart } from "@/lib/digest/week";
import { homeSummary, type HomeSummary } from "@/lib/home";
import { planFor } from "@/lib/plan";
import { isNoRisk } from "@/lib/plan-links";
import { savingsLine } from "@/lib/savings-text";
import { localDate } from "@/lib/today";
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
  // Read-only mode (src/lib/concierge-mode.ts): false for a real account, where Jane shows how
  // instead of offering to do it. Missing means the full flow (sample people, fixtures).
  concierge?: boolean;
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
  // Spec step 183: how many of the person's yeses Jane's agent is still working on.
  working?: number;
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
  // Spec step 145: cards and loans due soon and what pays them, with a money-movement
  // partner only. Optional, like changes.
  billPay?: BillPayView | null;
  // Spec step 146: the money health score this month. Optional, like changes.
  health?: HealthView | null;
  // Spec step 147: when the person answers, and what Jane stopped bringing up. Optional,
  // like changes.
  attention?: Attention;
  // Spec step 203: what-if plans the person adopted. Optional, like changes.
  whatIf?: AdoptedPlan[];
  // Spec step 238: what doesn't add up in the person's data. Optional, like changes.
  books?: BooksView;
  // Spec step 244: the latest monthly close. Optional, like changes.
  close?: CloseView | null;
  // Spec step 255: the suggestions chosen for today. Optional, like changes.
  suggestions?: OfferedSuggestion[];
  // Spec step 240: the steady paycheck from uneven income. Optional, like changes.
  steady?: SteadyView | null;
  // Spec step 243: prices about to go up. Optional, like changes.
  priceRises?: PriceRise[];
  // Spec step 242: money for two. Optional, like changes.
  two?: MoneyForTwoView | null;
  // Spec step 241: goals that trade off. Optional, like changes.
  tradeoffs?: TradeoffView | null;
  // Spec step 257: the one question worth asking now. Optional, like changes.
  question?: OpenQuestion | null;
  // CSV bench round 24: a payee sent about the same amount near each month's start, to ask
  // "Is this your rent?". Optional, like changes.
  rentQuestion?: RentTransfer | null;
  // Spec step 208: unusual-activity alerts waiting for "this was me" or "not me".
  unusual?: { id: string; key: string; title: string; body: string }[];
  // Spec step 207: what the person says yes to and what worked, by kind of finding.
  worked?: KindResult[];
  // Spec step 204: the lean-plan question or plan in force, and plans that just ended.
  lean?: { open: LeanState[]; ended: { id: string; employer: string }[] };
  // Spec step 148: the monthly money report, while it's new. Optional, like changes.
  monthlyReport?: StoredReport | null;
  // Spec step 128 on: what's in investment accounts.
  investments?: InvestmentSnapshot;
  // Spec step 91: suggestions the person said never to make again (preference keys);
  // findings among them are already left out of findings above.
  neverSuggest?: string[];
  // Spec step 96: what the chat covered the week before this one.
  lastWeek?: ChatWeek;
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

// Spec step 96: the chat's week before `start` (the person's Monday): what they asked, said
// yes or no to, and what Jane finished.
export type ChatWeek = { start: string; asked: number; yes: number; no: number; done: number };

async function chatWeek(userId: string, client: PrismaClient, start: Date): Promise<ChatWeek> {
  const rows = await scopedFor(userId, client).janeMessages.findMany({
    where: { createdAt: { gte: new Date(start.getTime() - 7 * 86_400_000), lt: start } },
    select: { kind: true, answeredWith: true },
  });
  return {
    start: new Date(start.getTime() - 7 * 86_400_000).toISOString().slice(0, 10),
    asked: rows.filter((r) => r.kind === "user").length,
    yes: rows.filter((r) => r.answeredWith && /^(?:yes|switch|approve)/i.test(r.answeredWith))
      .length,
    no: rows.filter((r) => r.answeredWith === "No").length,
    done: rows.filter((r) => r.kind === "done").length,
  };
}

// Spec step 91: findings that suggest cutting something, which "I need my …" rules out.
const CUTTING: readonly FindingType[] = [
  "subscription_review",
  "duplicate_subscription",
  "trial_conversion",
  "covered_by_card",
];

// The newest unread alerts the brain looks at for urgent ones.
const ALERTS_LOOKED_AT = 10;
// Urgent alerts Jane says another way: a deadline reminder as the deadline's heads-up, a
// double charge as its finding (with Yes and No).
const ALERTS_SAID_ELSEWHERE: readonly AlertType[] = [
  "deadline_soon",
  "duplicate_charge",
  // Spec step 208: unusual activity has its own message, with its two buttons.
  "unusual_activity",
];

async function thinking(
  userId: string,
  client: PrismaClient,
  now: Date,
  given: DetectionInput | undefined,
) {
  const input = given ?? (await loadDetectionInput(userId, { client, now }));
  const [changes, lifeGuesses, saved, partner, health] = await Promise.all([
    loadChanges(userId, { client, now, input }),
    lifeGuessesFor(userId, { client, now, input }),
    verifiedSavings(userId, { client, now, input }),
    moneyPartnerFor(userId, { client }),
    healthFor(userId, { client, now, input }),
  ]);
  const billPay = partner ? await loadBillPay(userId, { client, now, input }) : null;
  const worked = await resultsByKind(userId, { client, now, input });
  return {
    worked,
    changes,
    lifeGuesses,
    saved: { confirmedCents: saved.confirmedCents },
    billPay,
    health,
  };
}

const NO_MORE: MoreSnapshot = {
  autopilot: null,
  setupProposals: [],
  agentSteps: [],
  assetPrompts: [],
};

export async function loadSnapshot(
  userId: string,
  {
    client = defaultClient,
    now = new Date(),
    input,
    light = false,
  }: {
    client?: PrismaClient;
    now?: Date;
    // The bank data, when the caller already loaded it (Jane's run does).
    input?: DetectionInput;
    // Only what the first brief says (the suggestions, the question, the plan and the alerts):
    // none of the sectors' parts. Nearly a thousand queries on a first scan otherwise, which a
    // far-away database turned into most of the half minute before the brief. Never stored.
    light?: boolean;
  } = {},
): Promise<Snapshot | null> {
  const home = await homeSummary(userId, { client, now });
  if (!home) return null;
  const db = scopedFor(userId, client);
  // The person's own timezone: users have their own helpers, so a direct read by id.
  const [user, plan, ruleApprovals, alerts, said, preferences, concierge] = await Promise.all([
    client.user.findUnique({ where: { id: userId }, select: { timezone: true } }),
    planFor(userId, { client }),
    recentRuleApprovals(userId, { client, now }),
    newestUnreadAlerts(userId, { client, limit: ALERTS_LOOKED_AT }),
    // The "still looking" line doesn't count as Jane having said hello.
    db.janeMessages.count({ where: { NOT: { dedupeKey: "scanning:hello" } } }),
    listPreferences(userId, { client }),
    conciergeMode(userId, { client }),
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

  // The sectors' parts are independent reads: loaded together, not one after another (the
  // sample person's first screen waits on this).
  const [
    more,
    taxPart,
    thinkingPart,
    lastRun,
    paycheck,
    upkeep,
    investments,
    lastWeek,
    attention,
    monthlyReport,
    whatIf,
    books,
    suggestions,
    steady,
    question,
    priceRises,
    two,
    tradeoffs,
    close,
    rentQuestion,
  ] = await Promise.all([
    light ? NO_MORE : loadMore(userId, { client, now, input }),
    light ? {} : loadTaxSnapshot(userId, { client, now }),
    // Spec steps 97, 100, 139, 145 and 146 read the same bank data, so it's loaded once.
    light ? {} : thinking(userId, client, now, input),
    light ? null : lastControllerRun(userId, { client, now }),
    light ? null : latestPaycheckPlan(userId, { client, now }),
    light ? undefined : loadUpkeep(userId, { client, now }),
    light ? undefined : loadInvestmentSnapshot(userId, { client, now }),
    chatWeek(userId, client, weekStart(now, user?.timezone)),
    loadAttention(userId, { client, now, timezone: user?.timezone ?? null }),
    recentReport(userId, { client, now }),
    adoptedPlans(userId, { client }),
    openBooks(userId, { client }),
    offeredToday(userId, { client, now }),
    light ? null : loadSteady(userId, { client, now, input }),
    nextQuestion(userId, { client, now }),
    light ? [] : loadPriceRises(userId, { client, now }),
    loadMoneyForTwo(userId, { client, now }),
    light ? null : loadTradeoffs(userId, { client, now, input }),
    loadClose(userId, { client }),
    light ? null : loadRentQuestion(userId, { client, now, input }),
  ]);

  return {
    timezone: user?.timezone ?? null,
    concierge,
    // The person's own day (src/lib/today.ts).
    asOf: localDate(now, user?.timezone),
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
    working: home.janeDid.working,
    deadlines: home.deadlines,
    budgetsOver: home.budgetsOver,
    goalsBehind: home.goalsBehind,
    urgentAlerts: alerts
      // Each alert says whether it is urgent: a bill reminder only when the balance could fall
      // short that day, not every bill due this week.
      .filter((a) => a.urgent && !ALERTS_SAID_ELSEWHERE.includes(a.type))
      .map((a) => ({ id: a.id, title: a.title, body: a.body })),
    unusual: alerts
      .filter((a) => a.type === "unusual_activity")
      .map((a) => ({ id: a.id, key: a.key, title: a.title, body: a.body })),
    budgetProgress: home.budgetProgress,
    ...more,
    ...taxPart,
    ...thinkingPart,
    firstChat: said === 0,
    lastRun,
    paycheck,
    upkeep,
    investments,
    neverSuggest: [...never],
    lastWeek,
    attention,
    monthlyReport,
    whatIf,
    books,
    suggestions,
    steady,
    question,
    priceRises,
    two,
    tradeoffs,
    close,
    rentQuestion,
    lean: light
      ? { open: [], ended: [] }
      : {
          open: await openLean(userId, { client }),
          ended: await recentlyEnded(userId, { client, now }),
        },
  };
}
