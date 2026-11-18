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
import { homeSummary } from "@/lib/home";
import { matchCategory, type Intent } from "../intents";
import { listGoals } from "@/lib/goals";
import { comingUpBlock, spendingBlock } from "../block-data";
import { goalsReply } from "../goals-reply";
import { listPreferences, paydayDays } from "../preferences";
import { loadRecurring, type Recurring } from "../recurring";
import { paydayLine } from "../remember";
import { costReply, paydayReply, subscriptionsReply } from "../recurring-replies";
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
      // Not a regular charge: what was spent there this month.
      return costReply(intent, recurring, snapshot, asOf) ?? (await spendingOn(intent.target));
    }
    case "subscriptions": {
      const [recurring, snapshot] = await Promise.all([
        loadRecurring(userId, { client, now }),
        loadSnapshotFast(userId, { client, now }),
      ]);
      return subscriptionsReply(intent, recurring, snapshot, {
        statementsEnd: await statementsEndOf(userId, client, asOf),
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
      });
      return block ? { ...answer, refs: { ...answer.refs, block } } : answer;
    }
    case "safe_to_spend": {
      const home = await homeSummary(userId, { client, now });
      if (home?.safeToSpend) return safeReply(home.safeToSpend, asOf);
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
