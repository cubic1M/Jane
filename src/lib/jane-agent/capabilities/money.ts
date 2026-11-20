import { FORECAST_DAYS } from "@/config/detection";
import { loadSnapshotFast } from "../snapshot-store";
import type { Snapshot } from "../snapshot";
import { loadDetectionInput } from "@/detection/input";
import { forecastAccounts } from "@/detection/forecast";
import { forecastReply } from "../replies-forecast";
import { saveMoreReply } from "../replies-savemore";
import { loadNetWorthInputs, loansSeenWithoutBalance } from "@/lib/net-worth-history";
import { netWorthReply } from "../replies-networth";
import { storedReport } from "@/lib/monthly-report-store";
import { reportReply } from "../replies-report";
import type { Reply } from "../replies";
import { AFFORD_USUAL_MONTHS, CHAT_BLOCK_ROWS } from "@/config/agent-chat";
import { INSIGHT_MONTHS } from "@/config/insights";
import { loadInsightTransactions } from "@/insights/load";
import { loadAffordNumbers } from "@/lib/afford";
import { loadChanges } from "@/lib/changes";
import { verifiedSavings } from "@/lib/savings-proof";
import { scopedFor } from "@/lib/db-scoped";
import { staleStatementsEnd } from "@/lib/report-state";
import { historyDaysOf } from "@/lib/history-days";
import { CASH_FLOW_MIN_HISTORY_DAYS } from "@/config/areas";
import { homeSummary } from "@/lib/home";
import { matchCategory, type Intent } from "../intents";
import { listGoals } from "@/lib/goals";
import { comingUpBlock, spendingBlock } from "../block-data";
import { goalsReply } from "../goals-reply";
import { listPreferences, paydayDays } from "../preferences";
import { loadRecurring, type Recurring } from "../recurring";
import { paydayLine } from "../remember";
import { costReply, notRegularYet, paydayReply, subscriptionsReply } from "../recurring-replies";
import {
  affordReply,
  clarifyReply,
  findingReply,
  rankFindings,
  categoryContext,
  comingUpReply,
  safeReply,
  spendingReply,
} from "../replies";
import { changesReply } from "../replies-changes";
import { paycheckReply } from "../replies-paycheck";
import {
  chargeStoryReply,
  moneyFromPeopleReply,
  priceChangeReply,
  savingsTransfersReply,
  sentByAppReply,
} from "../replies-money-moves";
import { incomeReply } from "../replies-income";
import { loadProfileInput } from "@/lib/profile";
import { buildProfile, rateMonthsOf } from "@/profile/build";
import { yearIncomeOf } from "@/detectors/helpers";
import { chargeReply, feesPaidReply, waiverReply, type FeeContext } from "../replies-fees";
import { latestPaycheckPlan } from "@/lib/money-movement/paycheck";
import { loadBillPay } from "@/lib/money-movement/bill-pay";
import { moneyPartnerFor } from "@/lib/money-movement/partner";
import { billsReply } from "../replies-billpay";
import { savedReply } from "../replies-saved";
import { weeklyReview } from "../replies-review";
import { CATEGORY_LIST } from "./shared";
import { type CapabilityContext, spendingIn } from "./shared";
import { openLink } from "../types";

// Money, bills, spending and goals (spec step 190): the rules' answers for these kinds of question, one registered
// capability each in ./index.ts. Moved out of ../answer.ts unchanged.

// The last day the person's statements reach, when that's weeks ago (staleStatementsEnd).
async function statementsEndOf(
  userId: string,
  client: CapabilityContext["client"],
  asOf: string,
): Promise<string | null> {
  const read = await scopedFor(userId, client).transactions.aggregate({ _max: { date: true } });
  return staleStatementsEnd(read._max.date, asOf);
}

// Less history than bills show in: Home's strip's rule (src/lib/hub/view.ts cashFlowView).
const tooLittle = (historyDays: number | undefined) =>
  historyDays !== undefined && historyDays < CASH_FLOW_MIN_HISTORY_DAYS;

// The same, read from the first and last transaction, where Home's summary isn't loaded.
async function shortHistoryOf(
  userId: string,
  client: CapabilityContext["client"],
): Promise<boolean> {
  const read = await scopedFor(userId, client).transactions.aggregate({
    _min: { date: true },
    _max: { date: true },
  });
  const [first, last] = [read._min.date, read._max.date];
  return (
    first !== null &&
    last !== null &&
    tooLittle(
      historyDaysOf({
        transactions: [first, last].map((d) => ({ date: d.toISOString().slice(0, 10) })),
      }),
    )
  );
}

async function answer(ctx: CapabilityContext): Promise<Reply | null> {
  const { intent } = ctx;
  const { userId, client, now, asOf } = ctx;
  const spendingOn = (category: string) => spendingIn(ctx, category);
  switch (intent.kind) {
    // Spec step 88.
    case "cost": {
      const [recurring, snapshot] = await Promise.all([
        loadRecurring(userId, { client, now }),
        loadSnapshotFast(userId, { client, now }),
      ]);
      // Not a regular charge: what was spent there this month, or, asked when it's due, that
      // there's no schedule to tell from yet.
      return (
        costReply(intent, recurring, snapshot, asOf) ??
        (intent.when ? notRegularYet(intent.target) : await spendingOn(intent.target))
      );
    }
    case "subscriptions": {
      const [recurring, snapshot] = await Promise.all([
        loadRecurring(userId, { client, now }),
        loadSnapshotFast(userId, { client, now }),
      ]);
      return subscriptionsReply(intent, recurring, snapshot, {
        statementsEnd: await statementsEndOf(userId, client, asOf),
        shortHistory: await shortHistoryOf(userId, client),
      });
    }
    case "payday": {
      // Spec step 91: what they told Jane comes first.
      const days = paydayDays(await listPreferences(userId, { client }));
      if (days) {
        return {
          body: paydayLine(days, asOf),
          actions: [openLink("See today", "/home")],
          refs: {},
        };
      }
      return paydayReply(await loadRecurring(userId, { client, now }), asOf, {
        statementsEnd: await statementsEndOf(userId, client, asOf),
      });
    }
    case "income": {
      // The profile's month and the tax cards' year: the figures every page gives.
      const input = await loadProfileInput(userId, { client, now });
      const profile = buildProfile(input);
      const fact = profile.facts.monthly_income;
      return incomeReply(intent.period, {
        monthCents: typeof fact.value === "number" ? fact.value : null,
        told: fact.source === "told",
        schedules: profile.paySchedules ?? [],
        months: Math.max(1, Math.round(rateMonthsOf(profile))),
        yearGrossCents: yearIncomeOf(profile, input),
        statementsEnd: await statementsEndOf(userId, client, asOf),
      });
    }
    case "charge_amount":
    case "fees_paid":
    case "fee_waiver": {
      // The lines and accounts the pages read, and the dock's waiver card when Jane raised one.
      const input = await loadDetectionInput(userId, { client, now });
      const { detectFor } = await import("@/lib/suggestions");
      const waiver = (await detectFor(userId, { client, now })).suggestions.find(
        (s) => s.topic === "fee_waiver_met",
      );
      const ctx: FeeContext = {
        asOf,
        lines: input.transactions,
        accounts: new Map(
          input.accounts.map((a) => [
            a.id,
            {
              name: a.name,
              cash:
                a.type === "depository" && (a.subtype === "checking" || a.subtype === "savings"),
            },
          ]),
        ),
        waiver: waiver ? { why: waiver.why, href: waiver.action.href } : null,
      };
      if (intent.kind === "charge_amount") return chargeReply(intent.amountCents, intent.day, ctx);
      if (intent.kind === "fee_waiver") return waiverReply(ctx);
      const months = Math.max(
        1,
        Math.min(12, Math.round(historyDaysOf({ transactions: input.transactions }) / 30.44)),
      );
      return feesPaidReply(intent.late, months, ctx);
    }
    case "charge_story":
    case "money_from_people":
    case "sent_by_app":
    case "savings_moves": {
      // The lines the pages read (./replies-money-moves.ts).
      const lines = (await loadDetectionInput(userId, { client, now })).transactions;
      if (intent.kind === "charge_story") return chargeStoryReply(intent.target, lines);
      if (intent.kind === "money_from_people") return moneyFromPeopleReply(lines);
      if (intent.kind === "sent_by_app") return sentByAppReply(intent.app, lines);
      return savingsTransfersReply(lines);
    }
    case "plan_switch": {
      // Another plan's price is the cheaper-plan card's, when Jane found one; never a pick.
      const { detectFor } = await import("@/lib/suggestions");
      const target = intent.target.toLowerCase();
      const tier = (await detectFor(userId, { client, now })).suggestions.find(
        (s) => s.topic === "cheaper_tier" && `${s.title} ${s.why}`.toLowerCase().includes(target),
      );
      if (tier) {
        return {
          body: `${tier.why} Whether it's worth it is yours to say.`,
          actions: [openLink(tier.action.label, tier.action.href)],
          refs: {},
        };
      }
      const [recurring, snapshot] = await Promise.all([
        loadRecurring(userId, { client, now }),
        loadSnapshotFast(userId, { client, now }),
      ]);
      const cost = costReply({ target: intent.target, year: false }, recurring, snapshot, asOf);
      return {
        body: `${cost ? `${cost.body} ` : ""}I don't have ${intent.target}'s other plans and prices to compare, so I can't answer that from what I have.`,
        actions: cost?.actions ?? [openLink("See your subscriptions", "/subscriptions")],
        refs: {},
      };
    }
    // Spec step 94.
    case "goals":
      return goalsReply(await listGoals(userId, { client, now }));
    case "about": {
      const [recurring, snapshot] = await Promise.all([
        loadRecurring(userId, { client, now }),
        loadSnapshotFast(userId, { client, now }),
      ]);
      const known = aboutReply(intent, recurring, snapshot, asOf);
      if (known) return known;
      // A merchant's own charges, with no card about it: when its price changed, if it did ("when
      // did Netflix go up?" got "I can't answer that one yet", walk notes 11-19).
      if (!matchCategory(intent.target, CATEGORY_LIST)) {
        const lines = (await loadDetectionInput(userId, { client, now })).transactions;
        const story = priceChangeReply(intent.target, lines);
        if (!story.body.startsWith("I don't see")) return story;
      }
      if (matchCategory(intent.target, CATEGORY_LIST)) return spendingOn(intent.target);
      return null;
    }
    case "afford": {
      const numbers = await loadAffordNumbers(userId, { client, now });
      if (!intent.category) return affordReply(intent, numbers);
      const db = scopedFor(userId, client);
      const [transactions, budgets] = await Promise.all([
        loadInsightTransactions(db, asOf, AFFORD_USUAL_MONTHS + 1),
        db.budgets.findMany({ select: { category: true, amountCents: true } }),
      ]);
      return affordReply(
        intent,
        numbers,
        categoryContext(intent.category, transactions, budgets, asOf),
      );
    }
    case "spending": {
      const db = scopedFor(userId, client);
      const [transactions, budgets, declined] = await Promise.all([
        loadInsightTransactions(db, asOf, INSIGHT_MONTHS),
        db.budgets.findMany({ select: { category: true, amountCents: true } }),
        // Budgets the person said No to ("budget:<category>", src/planning/proposals.ts).
        db.planProposals.findMany({
          where: { kind: "budget", status: "dismissed" },
          select: { key: true },
        }),
      ]);
      // Spec step 94: where it went, as a chart, when no one category was asked about.
      const block = intent.category ? null : spendingBlock(transactions, asOf, intent.month);
      const answer = spendingReply(intent, transactions, asOf, budgets, {
        drawn: block !== null,
        declined: declined.map((p) => p.key.replace(/^budget:/, "")),
      });
      return block ? { ...answer, refs: { ...answer.refs, block } } : answer;
    }
    case "coming_up": {
      const home = await homeSummary(userId, { client, now });
      // Spec step 94: the same rows, as a timeline; when it holds them all, the words don't list
      // them again.
      const payday = intent.beforePayday ? (home?.safeToSpend?.payday ?? null) : null;
      const rows = (home?.comingUp ?? []).filter((r) =>
        payday ? r.date < payday : intent.days === null || r.daysLeft <= intent.days,
      );
      const block = comingUpBlock(
        rows,
        payday ? "Before payday" : intent.days === null ? "Coming up" : "Due this week",
      );
      const answer = comingUpReply(intent, home?.comingUp ?? [], {
        drawn: block !== null && rows.length <= CHAT_BLOCK_ROWS,
        payday,
        statementsEnd: rows.length === 0 ? await statementsEndOf(userId, client, asOf) : null,
        shortHistory: tooLittle(home?.cashFlow.historyDays),
      });
      return block ? { ...answer, refs: { ...answer.refs, block } } : answer;
    }
    case "safe_to_spend": {
      const home = await homeSummary(userId, { client, now });
      if (home?.safeToSpend) {
        return safeReply(home.safeToSpend, asOf, {
          shortHistory: tooLittle(home.cashFlow.historyDays),
        });
      }
      return safeReply(null, asOf, { statementsEnd: await statementsEndOf(userId, client, asOf) });
    }
    case "paycheck": {
      const plan = await latestPaycheckPlan(userId, { client, now });
      if (plan) return paycheckReply(plan);
      const next = (await loadRecurring(userId, { client, now })).nextIncome;
      return paycheckReply(
        null,
        true,
        next && { date: next.date, cents: next.amountCents, from: next.from, asOf },
      );
    }
    case "bills_paid": {
      const partner = await moneyPartnerFor(userId, { client });
      return billsReply(partner ? await loadBillPay(userId, { client, now }) : null, asOf);
    }
    case "saved":
      return savedReply(await verifiedSavings(userId, { client, now }));
    case "changes":
      return changesReply(await loadChanges(userId, { client, now }));
    case "review": {
      const snapshot = await loadSnapshotFast(userId, { client, now });
      return snapshot
        ? weeklyReview(snapshot, now)
        : {
            body: "Upload your bank statements or link a bank, and I'll review your weeks here.",
            actions: [],
            refs: {},
          };
    }
    // Spec step 148: the monthly money report.
    case "monthly_report":
      return reportReply(await storedReport(userId, null, { client }));
    // What they own and owe, from the net worth page's own math.
    case "net_worth": {
      // The figure Home and /net-worth show, from the one place they read it (gate B).
      return netWorthReply(
        (await loadNetWorthInputs(userId, { client })).worth,
        await loansSeenWithoutBalance(userId, { client }),
        { statementsEnd: await statementsEndOf(userId, client, asOf) },
      );
    }
    case "save_more":
      return saveMoreReply(intent.monthlyCents, await listGoals(userId, { client, now }));
    case "balance_forecast": {
      const input = await loadDetectionInput(userId, { client, now });
      return forecastReply(forecastAccounts(input, FORECAST_DAYS));
    }
    default:
      return null;
  }
}

export const moneyAnswer = answer;

// "Tell me about X": the finding asked for, what X costs, or the one finding X names. With the
// person's own way of acting: a read-only account gets the steps, never "Want me to handle it?"
// (debugger 11-17: "should I move my extra cash?" offered to handle it). Pure.
export function aboutReply(
  intent: Extract<Intent, { kind: "about" }>,
  recurring: Recurring,
  snapshot: Snapshot | null,
  asOf: string,
): Reply | null {
  const exact = intent.findingId
    ? snapshot?.findings.find((f) => f.findingId === intent.findingId)
    : undefined;
  if (snapshot && exact) return findingReply(exact, null, snapshot.concierge);
  const cost = costReply({ target: intent.target, year: false }, recurring, snapshot, asOf);
  if (cost) return cost;
  const ranked = snapshot ? rankFindings(snapshot.findings, null, intent.target) : [];
  if (snapshot && ranked.length === 1) {
    return findingReply(ranked[0].finding, null, snapshot.concierge);
  }
  if (ranked.length > 1) {
    return clarifyReply(
      `I found ${ranked.length} things about "${intent.target}". Which one do you mean?`,
      ranked.map(({ finding }) => ({
        label: finding.title,
        intent: { kind: "about", target: finding.title, findingId: finding.findingId },
      })),
    );
  }
  return null;
}
