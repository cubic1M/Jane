import { checkupAnswer } from "./insurance/checkup";
import { autopilotAnswer } from "./insurance/autopilot";
import { claimAnswer } from "./insurance/claim";
import { quotesAnswer } from "./insurance/quotes";
import { insuranceReply } from "./insurance/replies";
import { loadInsuranceSnapshot } from "./insurance/snapshot";
import { AFFORD_USUAL_MONTHS } from "@/config/agent-chat";
import { INSIGHT_MONTHS } from "@/config/insights";
import type { PrismaClient } from "@/generated/prisma/client";
import { loadInsightTransactions } from "@/insights/load";
import { loadAffordNumbers } from "@/lib/afford";
import { autopilotOf } from "@/lib/autopilot";
import { loadChanges } from "@/lib/changes";
import { provenSavings } from "@/lib/savings-proof";
import { lastControllerRun } from "@/lib/controller-log";
import { autopilotFor, sectorAutopilots } from "@/lib/sector-autopilot";
import { listLifeEvents } from "@/lib/life-events";
import { db as defaultClient } from "@/lib/db";
import { scopedFor } from "@/lib/db-scoped";
import { homeSummary } from "@/lib/home";
import { whatJaneDid } from "@/lib/what-jane-did";
import { CATEGORY_LABELS, UNCATEGORIZED } from "@/insights/labels";
import { topicOf, withTopic, type Topic } from "./context";
import { matchCategory, type Intent } from "./intents";
import { listPreferences, paydayDays } from "./preferences";
import { loadRecurring } from "./recurring";
import { paydayLine } from "./remember";
import { costReply, paydayReply, subscriptionsReply } from "./recurring-replies";
import { answerDebt } from "./debt-answer";
import { isDebtIntent } from "./debt-intents";
import { answerInvestments } from "./investments/answer";
import { learnReply } from "./learn";
import {
  actReply,
  affordReply,
  clarifyReply,
  rememberReply,
  findingReply,
  rankFindings,
  categoryContext,
  approveAllReply,
  comingUpReply,
  greetingReply,
  pauseReply,
  safeReply,
  spendingReply,
  undoReply,
  whatDidReply,
  type Reply,
} from "./replies";
import { changesReply } from "./replies-changes";
import { overviewReply, sectorChangeReply } from "./replies-autopilot";
import { checkedReply } from "./replies-checked";
import { rankedFor } from "./priorities";
import { prioritiesReply } from "./replies-priorities";
import { paycheckReply } from "./replies-paycheck";
import { latestPaycheckPlan } from "@/lib/money-movement/paycheck";
import { loadBillPay } from "@/lib/money-movement/bill-pay";
import { moneyPartnerFor } from "@/lib/money-movement/partner";
import { billsReply } from "./replies-billpay";
import { groupedHelpReply } from "./replies-help";
import { lifeEventReply } from "./replies-life";
import { savedReply } from "./replies-saved";
import { weeklyReview } from "./replies-review";
import { loadSnapshot } from "./snapshot";
import { answerTaxIntent } from "./tax-answer";

// Answers a typed message by rules (spec step 84): loads only what the intent needs, with
// the same loaders as the pages, all scoped to the person, and words it with ./replies.
// Null when the rules can't answer ("unknown"): that's for Claude, when there's a key.
// Spec step 88: a follow-up is read against what the conversation was about (topic), and
// each answer says what it was about, for the next one.

type Options = { client?: PrismaClient; now?: Date; topic?: Topic | null };

const CATEGORY_LIST = [...new Set([...Object.values(CATEGORY_LABELS), UNCATEGORIZED])];

export async function answerByRules(
  userId: string,
  typed: Intent,
  { client = defaultClient, now = new Date(), topic = null }: Options = {},
): Promise<Reply | null> {
  const asOf = now.toISOString().slice(0, 10);
  const resolved = withTopic(typed, topic, asOf);
  if (resolved.kind === "which") return whichReply(userId, { client, now });
  const reply = await byIntent(userId, resolved, { client, now });
  if (reply) {
    const about = topicOf(resolved);
    if (about || reply.refs.topic) {
      reply.refs = { ...reply.refs, topic: { ...about, ...reply.refs.topic } as Topic };
    }
  }
  return reply;
}

// "Cancel it" with nothing to point back to: which of the biggest savings?
async function whichReply(
  userId: string,
  { client, now }: { client: PrismaClient; now: Date },
): Promise<Reply> {
  const snapshot = await loadSnapshot(userId, { client, now });
  const top = [...(snapshot?.findings ?? [])]
    .sort((a, b) => (b.annualSavingsCents ?? -1) - (a.annualSavingsCents ?? -1))
    .map((f) => ({
      label: f.title,
      intent: { kind: "about" as const, target: f.title, findingId: f.findingId },
    }));
  return top.length > 0
    ? clarifyReply("Which one do you mean?", top)
    : { body: 'Which one do you mean? Try its name, like "Netflix".', actions: [], refs: {} };
}

async function byIntent(
  userId: string,
  intent: Intent,
  { client, now }: { client: PrismaClient; now: Date },
): Promise<Reply | null> {
  const asOf = now.toISOString().slice(0, 10);
  const spendingOn = async (category: string) =>
    spendingReply(
      { kind: "spending", category, month: asOf.slice(0, 7) },
      await loadInsightTransactions(scopedFor(userId, client), asOf, INSIGHT_MONTHS),
      asOf,
    );
  // Loans and debt (spec Phase Y, ./debt-answer.ts).
  if (isDebtIntent(intent)) return answerDebt(userId, intent, { client, now });
  switch (intent.kind) {
    case "follow_up":
      return null;
    // Spec step 88.
    case "cost": {
      const [recurring, snapshot] = await Promise.all([
        loadRecurring(userId, { client, now }),
        loadSnapshot(userId, { client, now }),
      ]);
      // Not a regular charge: what was spent there this month.
      return costReply(intent, recurring, snapshot, asOf) ?? (await spendingOn(intent.target));
    }
    case "subscriptions": {
      const [recurring, snapshot] = await Promise.all([
        loadRecurring(userId, { client, now }),
        loadSnapshot(userId, { client, now }),
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
    case "remember":
      return rememberReply(intent.draft);
    case "about": {
      const [recurring, snapshot] = await Promise.all([
        loadRecurring(userId, { client, now }),
        loadSnapshot(userId, { client, now }),
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
    case "unknown":
      return null;
    case "help":
      return groupedHelpReply();
    case "insurance":
      // Spec step 103: quotes ask the partner, the rest read the profile.
      if (intent.ask === "quotes") return quotesAnswer(userId, intent, { client, now });
      // Spec step 106: the coverage checkup, run when asked.
      if (intent.ask === "checkup") return checkupAnswer(userId, { client, now });
      // Spec step 107: something happened.
      if (intent.ask === "claim") return claimAnswer(userId, intent, { client, now });
      // Spec step 108: what Jane does with insurance by herself.
      if (intent.ask === "autopilot") return autopilotAnswer(userId, { client });
      return insuranceReply(intent, await loadInsuranceSnapshot(userId, { client, now }), asOf);
    case "greeting": {
      if (intent.thanks) return greetingReply(true, null);
      const home = await homeSummary(userId, { client, now });
      return greetingReply(false, home?.safeToSpend ?? null, asOf);
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
      return spendingReply(intent, transactions, asOf, budgets);
    }
    case "coming_up": {
      const home = await homeSummary(userId, { client, now });
      return comingUpReply(intent, home?.comingUp ?? []);
    }
    case "safe_to_spend": {
      const home = await homeSummary(userId, { client, now });
      return safeReply(home?.safeToSpend ?? null, asOf);
    }
    case "life_event": {
      const open = await listLifeEvents(userId, { client });
      const going = open.some((e) => e.kind === intent.event && e.completedAt === null);
      return lifeEventReply(intent.event, going);
    }
    case "paycheck":
      return paycheckReply(await latestPaycheckPlan(userId, { client, now }));
    case "bills_paid": {
      const partner = await moneyPartnerFor(userId, { client });
      return billsReply(partner ? await loadBillPay(userId, { client, now }) : null, asOf);
    }
    case "priorities": {
      const snapshot = await loadSnapshot(userId, { client, now });
      return prioritiesReply(snapshot ? rankedFor(snapshot) : []);
    }
    case "checked":
      return checkedReply(await lastControllerRun(userId, { client, now }));
    case "autopilot_overview":
      return overviewReply(
        await sectorAutopilots(userId, { client, now }),
        await autopilotOf(userId, { client }),
      );
    case "autopilot_sector":
      return sectorChangeReply(
        intent,
        await autopilotFor(userId, intent.sector, { client, now }),
        await autopilotOf(userId, { client }),
      );
    case "saved":
      return savedReply(await provenSavings(userId, { client, now }));
    case "review": {
      const snapshot = await loadSnapshot(userId, { client, now });
      return snapshot
        ? weeklyReview(snapshot, now)
        : {
            body: "Link a bank or import a CSV, and I'll review your weeks here.",
            actions: [],
            refs: {},
          };
    }
    case "changes":
      return changesReply(await loadChanges(userId, { client, now }));
    case "what_did":
      return whatDidReply(await whatJaneDid(userId, { client, now }));
    case "act":
      return actReply(intent, await loadSnapshot(userId, { client, now }));
    case "approve_all":
      return approveAllReply(await loadSnapshot(userId, { client, now }));
    case "undo":
      return undoReply(await loadSnapshot(userId, { client, now }), now);
    case "pause_autopilot":
      return pauseReply(await autopilotOf(userId, { client }));
    case "tax":
      return answerTaxIntent(userId, intent, { client, now });
    case "learn":
      return learnReply(intent.slug);
    case "investments":
      return answerInvestments(userId, intent, { client, now });
  }
}
