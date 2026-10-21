import { FORECAST_DAYS } from "@/config/detection";
import { loadSnapshotFast } from "../snapshot-store";
import { loadDetectionInput } from "@/detection/engine";
import { forecastAccounts } from "@/detection/forecast";
import { forecastReply } from "../replies-forecast";
import { saveMoreReply } from "../replies-savemore";
import { netWorth } from "@/insights/net-worth";
import { cryptoTotal } from "@/lib/crypto/crypto";
import { netWorthReply } from "../replies-networth";
import { storedReport } from "@/lib/monthly-report-store";
import { reportReply } from "../replies-report";
import type { Reply } from "../replies";
import { AFFORD_USUAL_MONTHS } from "@/config/agent-chat";
import { INSIGHT_MONTHS } from "@/config/insights";
import { loadInsightTransactions } from "@/insights/load";
import { loadAffordNumbers } from "@/lib/afford";
import { loadChanges } from "@/lib/changes";
import { provenSavings } from "@/lib/savings-proof";
import { scopedFor } from "@/lib/db-scoped";
import { homeSummary } from "@/lib/home";
import { matchCategory } from "../intents";
import { listGoals } from "@/lib/goals";
import { comingUpBlock, spendingBlock } from "../block-data";
import { goalsReply } from "../goals-reply";
import { listPreferences, paydayDays } from "../preferences";
import { loadRecurring } from "../recurring";
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
import { loadSnapshot } from "../snapshot";
import { CATEGORY_LIST } from "./shared";
import { type CapabilityContext, spendingIn } from "./shared";

// Money, bills, spending and goals (spec step 190): the rules' answers for these kinds of question, one registered
// capability each in ./index.ts. Moved out of ../answer.ts unchanged.

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
      return subscriptionsReply(intent, recurring, snapshot);
    }
    case "payday": {
      // Spec step 91: what they told Jane comes first.
      const days = paydayDays(await listPreferences(userId, { client }));
      if (days) {
        return {
          body: paydayLine(days, asOf),
          actions: [{ id: "open", label: "See today", kind: "link", href: "/home" }],
          refs: {},
        };
      }
      return paydayReply(await loadRecurring(userId, { client, now }), asOf);
    }
    // Spec step 94.
    case "goals":
      return goalsReply(await listGoals(userId, { client, now }));
    case "about": {
      const [recurring, snapshot] = await Promise.all([
        loadRecurring(userId, { client, now }),
        loadSnapshotFast(userId, { client, now }),
      ]);
      const exact = intent.findingId
        ? snapshot?.findings.find((f) => f.findingId === intent.findingId)
        : undefined;
      if (snapshot && exact) return findingReply(exact);
      const cost = costReply({ target: intent.target, year: false }, recurring, snapshot, asOf);
      if (cost) return cost;
      const ranked = snapshot ? rankFindings(snapshot.findings, null, intent.target) : [];
      if (snapshot && ranked.length === 1) return findingReply(ranked[0].finding);
      if (ranked.length > 1) {
        return clarifyReply(
          `I found ${ranked.length} things about "${intent.target}". Which one do you mean?`,
          ranked.map(({ finding }) => ({
            label: finding.title,
            intent: { kind: "about", target: finding.title, findingId: finding.findingId },
          })),
        );
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
      const [transactions, budgets] = await Promise.all([
        loadInsightTransactions(db, asOf, INSIGHT_MONTHS),
        db.budgets.findMany({ select: { category: true, amountCents: true } }),
      ]);
      const answer = spendingReply(intent, transactions, asOf, budgets);
      // Spec step 94: where it went, as a chart, when no one category was asked about.
      const block = intent.category ? null : spendingBlock(transactions, asOf, intent.month);
      return block ? { ...answer, refs: { ...answer.refs, block } } : answer;
    }
    case "coming_up": {
      const home = await homeSummary(userId, { client, now });
      const answer = comingUpReply(intent, home?.comingUp ?? []);
      // Spec step 94: the same rows, as a timeline.
      const rows = (home?.comingUp ?? []).filter(
        (r) => intent.days === null || r.daysLeft <= intent.days,
      );
      const block = comingUpBlock(rows, intent.days === null ? "Coming up" : "Due this week");
      return block ? { ...answer, refs: { ...answer.refs, block } } : answer;
    }
    case "safe_to_spend": {
      const home = await homeSummary(userId, { client, now });
      return safeReply(home?.safeToSpend ?? null, asOf);
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
      return savedReply(await provenSavings(userId, { client, now }));
    case "changes":
      return changesReply(await loadChanges(userId, { client, now }));
    case "review": {
      const snapshot = await loadSnapshotFast(userId, { client, now });
      return snapshot
        ? weeklyReview(snapshot, now)
        : {
            body: "Link a bank or import a CSV, and I'll review your weeks here.",
            actions: [],
            refs: {},
          };
    }
    // Spec step 148: the monthly money report.
    case "monthly_report":
      return reportReply(await storedReport(userId, null, { client }));
    // What they own and owe, from the net worth page's own math.
    case "net_worth": {
      const db = scopedFor(userId, client);
      const [accounts, owned, crypto] = await Promise.all([
        db.accounts.findMany({
          select: { id: true, name: true, type: true, subtype: true, currentBalanceCents: true },
        }),
        db.ownedAssets.findMany({ select: { id: true, valueCents: true, valuedOn: true } }),
        cryptoTotal(userId, { client }),
      ]);
      return netWorthReply(
        netWorth(
          accounts.map((a) => ({ ...a, balanceCents: a.currentBalanceCents })),
          owned.map((o) => ({ ...o, valuedOn: o.valuedOn.toISOString().slice(0, 10) })),
          crypto,
        ),
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
