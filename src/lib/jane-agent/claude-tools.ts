import { INSURANCE_TOOLS, isInsuranceTool, runInsuranceTool } from "./insurance/tools";
import type Anthropic from "@anthropic-ai/sdk";
import { BUDGET_SUGGESTION_MONTHS } from "@/config/budgets";
import { MAX_AFFORD_CENTS } from "@/config/afford";
import { CHAT_PRIMER_TOOLS, CHAT_RUNNERS_UP } from "@/config/agent-chat";
import { LIFE_EVENTS } from "@/config/life-events";
import type { PrismaClient } from "@/generated/prisma/client";
import { budgetSummary } from "@/insights/budgets";
import { loadInsightTransactions } from "@/insights/load";
import { netWorth } from "@/insights/net-worth";
import { ASK_TOOLS, runAskTool, type ToolOutput } from "@/lib/ask/tools";
import { CARD_SELECT, buildCard } from "@/lib/cards";
import { comparisonFor } from "@/lib/compare";
import { frequencyWords } from "@/lib/explain-input";
import { scopedFor } from "@/lib/db-scoped";
import { loadChanges } from "@/lib/changes";
import { listGoals } from "@/lib/goals";
import { lifeGuessesFor } from "@/lib/life-guesses";
import { loadUpkeep } from "@/lib/plan-upkeep";
import { sectorAutopilots } from "@/lib/sector-autopilot";
import { lastControllerRun } from "@/lib/controller-log";
import { CONTROLLER_STEP_LABELS } from "@/config/controller";
import { rankedFor } from "./priorities";
import { wholePicture } from "./whole-picture";
import { latestPaycheckPlan } from "@/lib/money-movement/paycheck";
import { listTransfers } from "@/lib/money-movement/transfers";
import { loadBillPay } from "@/lib/money-movement/bill-pay";
import { moneyPartnerFor } from "@/lib/money-movement/partner";
import { SECTOR_LABELS, SECTOR_LEVEL_LABELS } from "@/config/autopilot-sectors";
import { provenSavings } from "@/lib/savings-proof";
import { listLifeEvents } from "@/lib/life-events";
import { homeSummary } from "@/lib/home";
import { formatCents } from "@/lib/money";
import { affordWindow } from "@/planning/afford";
import type { Scored } from "@/planning/compare";
import { ACTION_HANDLERS } from "./actions";
import { DEBT_CHAT_PAGES, DEBT_TOOLS } from "./debt-tools";
import { isDebtTool, runDebtTool } from "./debt-tools-run";
import { INVESTMENT_TOOLS, isInvestmentTool, runInvestmentTool } from "./investments/tools";
import { rebalanceOffer } from "./investments/replies";
import { loadRebalance } from "@/lib/investments/rebalance";
import { monthLabel, type Reply } from "./replies";
import { guessLine } from "./replies-life";
import { BLOCK_KINDS } from "./block-data";
import { listPreferences } from "./preferences";
import { cachedPrimer, keepPrimer } from "./primer-cache";
import { loadRecurring } from "./recurring";
import { weeklyReview } from "./replies-review";
import { loadSnapshot } from "./snapshot";
import { findingCandidate } from "./sources/findings";
import { TAX_TOOLS, isTaxTool, runTaxTool } from "./tax-tools";
import { ACTION_IDS, type ActionId, type MessageAction } from "./types";
import { cryptoTotal } from "@/lib/crypto/crypto";

// The tools Claude gets in Jane's chat (spec step 84). Read-only tools over the person's
// own data, wrapping the same loaders as the pages (and Ask's own tools, src/lib/ask), each
// scoped to the person. Every dollar figure a tool returns is recorded for the guardrails.
// One more, propose_action, can only put buttons from the action registry under the
// answer: Claude never runs an action, the person taps.

type Options = { client: PrismaClient; now: Date };

// Ask's tools, except its findings list: the chat's has the ids propose_action needs.
const FROM_ASK = ASK_TOOLS.filter((t) => t.name !== "list_findings");

// Buttons Claude may offer. Undo isn't one: it belongs to the message it undoes.
export const PROPOSABLE: readonly ActionId[] = [
  "finding.yes",
  "plan.approve_safe",
  "goal.start",
  // Spec step 133.
  "invest.rebalance",
];

// Pages Claude may link to, by name.
export const CHAT_PAGES: Readonly<Record<string, { label: string; href: string }>> = {
  // Loans and debt (spec Phase Y, ./debt-tools.ts).
  ...DEBT_CHAT_PAGES,
  today: { label: "See today", href: "/home" },
  insurance: { label: "See your insurance", href: "/insurance" },
  plan: { label: "Open the plan", href: "/plan" },
  subscriptions: { label: "Open subscriptions", href: "/subscriptions" },
  bills: { label: "See bills", href: "/bills" },
  deadlines: { label: "See deadlines", href: "/deadlines" },
  insights: { label: "See insights", href: "/insights" },
  budgets: { label: "See budgets", href: "/budgets" },
  goals: { label: "See goals", href: "/goals" },
  afford: { label: "Can I afford this?", href: "/afford" },
  actions: { label: "See actions", href: "/actions" },
  net_worth: { label: "See net worth", href: "/net-worth" },
  investments: { label: "See what you own", href: "/investments" },
  settings: { label: "Settings", href: "/settings" },
  // Taxes (spec steps 118–127).
  taxes: { label: "See your taxes", href: "/taxes" },
  tax_profile: { label: "See my tax profile", href: "/taxes/profile" },
  tax_tags: { label: "See tax tags", href: "/taxes/tags" },
  tax_pack: { label: "Open the tax-time pack", href: "/tax-pack" },
};

const noInput = { type: "object" as const, properties: {}, additionalProperties: false };

export const CHAT_TOOLS: Anthropic.Tool[] = [
  ...FROM_ASK,
  // Loans and debt (spec Phase Y, ./debt-tools.ts).
  ...DEBT_TOOLS,
  // Insurance (spec Phase X).
  ...INSURANCE_TOOLS,
  {
    name: "safe_to_spend",
    description:
      "What the person can safely spend until their next payday (or the next few weeks), after upcoming bills, what's left in their budgets and what goes to their goals. The same number as the Today page.",
    input_schema: noInput,
  },
  {
    name: "coming_up",
    description:
      "Bills and deadlines coming up in the next month, soonest first, as on the Today page.",
    input_schema: noInput,
  },
  {
    name: "open_findings",
    description:
      "Things the app found that could save the person money and they haven't decided on yet, with each one's id (for propose_action and finding_details), kind, estimate, and Jane's pick when there's one.",
    input_schema: noInput,
  },
  {
    name: "finding_details",
    description:
      "Everything about one finding, before you suggest what to do about it: why it was flagged, the evidence (charges and dates), what would change and what they'd give up, and, when the app compared options, what they pay now, Jane's pick and the runners-up with first-year cost and saving.",
    input_schema: {
      type: "object",
      properties: { finding_id: { type: "string", description: "An id from open_findings." } },
      required: ["finding_id"],
      additionalProperties: false,
    },
  },
  {
    name: "subscriptions",
    description:
      "Everything that charges the person on a schedule, from their transactions, as on the Subscriptions page: how often, the last charge and its date, the next expected date, the cost a year, whether it's a subscription, and the id of an open finding about it if there is one.",
    input_schema: noInput,
  },
  {
    name: "goals",
    description: "The person's savings goals: target, date, saved so far, and how they're going.",
    input_schema: noInput,
  },
  {
    name: "budgets",
    description: "This month's budgets: each category's budget, spent so far and what's left.",
    input_schema: noInput,
  },
  {
    name: "net_worth",
    description:
      "What the person has (accounts and things they own) minus what they owe, from their linked balances.",
    input_schema: noInput,
  },
  {
    name: "recent_changes",
    description:
      "What changed lately in the person's money (spec step 97): bills or subscriptions whose price moved, new regular charges, paychecks late, smaller or from a new employer, categories running above their usual pace this month, and new fees. Each with what Jane is doing about it.",
    input_schema: noInput,
  },
  {
    name: "life_events",
    description:
      "Big life changes (spec step 100): moving, a new job or a new baby that Jane spotted from two or more signs in the person's money and hasn't asked about yet, and the life-event checklists they have going, with how far along each is.",
    input_schema: noInput,
  },
  {
    name: "plan_upkeep",
    description:
      "Plans that keep up (spec step 101): this month's budget tune-up (each budget, its amount and its usual month), transfers to savings Jane could count toward a goal, and the weekly review: what Jane did, what it saved and what's next.",
    input_schema: noInput,
  },
  {
    name: "proven_savings",
    description:
      "What Jane has saved the person (spec step 139): the confirmed total, each saving with the transaction that proves it (a refund that came back, a lower bill, a new plan's first bill, a cancelled charge that stopped), and apart from it what's still an estimate. Only the confirmed total counts as saved.",
    input_schema: noInput,
  },
  {
    name: "autopilot_settings",
    description:
      'How much Jane may do by herself in each area (spec step 141): subscriptions and bills, insurance, debt, taxes, investing, goals and budgets. Each area\'s level (always ask, the safe stuff, everything allowed), its caps each time and each month, and what it used this month. Over a cap Jane asks. To change an area, the person types it ("let Jane handle insurance up to $50 a month") or uses Settings.',
    input_schema: noInput,
  },
  {
    name: "nightly_log",
    description:
      "What Jane checked for the person last night (spec step 142): one line per area (bank sync, changes, insurance reshops, debts and rates, taxes, investing drift, goals and budgets), in the order she ran them, with what each found or did, and any that failed and will be tried again.",
    input_schema: noInput,
  },
  {
    name: "priorities",
    description:
      'The person\'s next best things to do (spec step 143), ranked across everything Jane found and is waiting on: findings, insurance picks, refinance offers, steps only they can do and dated deadlines. Each with the money it saves a year, the minutes it takes, its urgency and why it ranks where it does. Use it for "what should I do first" and to put the most important first.',
    input_schema: noInput,
  },
  {
    name: "whole_picture",
    description:
      'How the person is doing across every sector at once (spec step 183), for "am I OK?", "how am I doing" and "what should I do this month": a verdict (ok, watch or act) with its one-sentence headline, safe to spend until payday, bills and deadlines due this week and this month, budgets over, goals behind, urgent alerts, what Jane\'s agent is working on, the steps waiting on the person, and the one to three things that matter most (from the ranked list) with why. Lead with the headline, then the things that matter; use the same figures.',
    input_schema: noInput,
  },
  {
    name: "money_moves",
    description:
      "Money that moves itself (spec step 144): the newest paycheck's plan (what goes to each goal, the emergency fund, the tax set-aside and extra debt payments, kept above safe to spend's cushion) with what Jane moved by herself and what waits for a tap; cards and loans due in the next three weeks (spec step 145) with what pays each (the person's own autopay, a payment Jane scheduled, one she can schedule with a tap, or checking would run short and a due date worth moving after payday); and the latest transfers with their status. Until a money-movement partner is connected these are sample transfers: no real money moves.",
    input_schema: noInput,
  },
  {
    name: "propose_action",
    description:
      "Offer the person a button under your answer. You can't do anything yourself; the person decides by tapping. Use it at most once: when your answer suggests something that can be done, or the person asked for it. Actions: finding.yes (Yes and No on one open finding; give finding_id from open_findings), plan.approve_safe (approve the plan's safe items together), goal.start (start a savings goal; give goal_name, goal_amount in dollars and goal_month as YYYY-MM within the next 12 months), invest.rebalance (demo advice mode: place the orders that move to the recommended mix, in the simulated brokerage), open (a link to a page; give page).",
    input_schema: {
      type: "object",
      properties: {
        action: { type: "string", enum: [...PROPOSABLE, "open"] },
        finding_id: { type: "string" },
        goal_name: { type: "string" },
        goal_amount: { type: "number" },
        goal_month: { type: "string" },
        page: { type: "string", enum: Object.keys(CHAT_PAGES) },
      },
      required: ["action"],
      additionalProperties: false,
    },
  },
  // Spec step 94.
  {
    name: "show_block",
    description:
      "Show one chart, table or timeline under your answer, drawn from the person's own numbers (the same as the pages): spending_by_category (bars for one month; give month as YYYY-MM, or leave it out for this month), spending_by_month (bars, the last few months), coming_up (a timeline of bills and deadlines), goals (progress bars), options (a table comparing a finding's options; give finding_id). Use it at most once, when a picture says it better than a list.",
    input_schema: {
      type: "object",
      properties: {
        kind: { type: "string", enum: [...BLOCK_KINDS] },
        month: { type: "string" },
        finding_id: { type: "string" },
      },
      required: ["kind"],
      additionalProperties: false,
    },
  },
  // Taxes (spec steps 118–127): ./tax-tools.ts.
  ...TAX_TOOLS,
  // Spec step 128 on.
  ...INVESTMENT_TOOLS,
];

const str = (value: unknown) => (typeof value === "string" ? value.trim() : "");

// A read-only tool. Ask's own tools run through runAskTool unchanged.
export async function runChatTool(
  userId: string,
  name: string,
  input: unknown,
  { client, now }: Options,
): Promise<ToolOutput> {
  if (FROM_ASK.some((t) => t.name === name))
    return runAskTool(userId, name, input, { client, now });
  if (isDebtTool(name)) return runDebtTool(userId, name, input, { client, now });
  if (isTaxTool(name)) return runTaxTool(userId, name, input, { client, now });
  if (isInvestmentTool(name)) return runInvestmentTool(userId, name, input, { client, now });
  if (isInsuranceTool(name)) return runInsuranceTool(userId, name, input, { client, now });
  const cents: number[] = [];
  const money = (value: number) => {
    cents.push(Math.abs(value));
    return value < 0 ? `-${formatCents(-value)}` : formatCents(value);
  };
  const out = (value: unknown): ToolOutput => ({ content: JSON.stringify(value), cents });
  const asOf = now.toISOString().slice(0, 10);

  switch (name) {
    case "safe_to_spend": {
      const safe = (await homeSummary(userId, { client, now }))?.safeToSpend;
      if (!safe) return out({ note: "No checking account is linked, so there's no number." });
      return out({
        safeToSpend: money(safe.safeCents),
        until: safe.payday,
        checkingBalance: money(safe.balanceCents),
        upcomingBills: money(safe.billsCents),
        leftInBudgets: money(safe.budgetsLeftCents),
        forGoals: money(safe.goalsCents),
        setAsideForYearlyBills: money(safe.setAsideCents),
      });
    }
    case "coming_up": {
      const rows = (await homeSummary(userId, { client, now }))?.comingUp ?? [];
      return out({
        items: rows.map((r) => ({
          date: r.date,
          what: r.label,
          kind: r.href === "/bills" ? "bill" : "deadline",
          amount: r.amountCents === null ? null : money(r.amountCents),
        })),
      });
    }
    case "open_findings": {
      const snapshot = await loadSnapshot(userId, { client, now });
      return out({
        findings: (snapshot?.findings ?? []).map((f) => {
          if (f.annualSavingsCents !== null) money(f.annualSavingsCents);
          if (f.pick) money(f.pick.savingCents);
          return {
            id: f.findingId,
            kind: f.type,
            title: f.title,
            estimate: f.savings,
            janesPick: f.pick?.name ?? null,
          };
        }),
      });
    }
    case "finding_details": {
      const args = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
      const finding = await scopedFor(userId, client).findings.findFirst({
        where: { id: str(args.finding_id) },
        select: { ...CARD_SELECT, status: true },
      });
      if (!finding) return out({ error: "There's no finding with that id. Use open_findings." });
      const card = buildCard(finding);
      if (card.annualSavingsCents !== null) money(card.annualSavingsCents);
      const comparison = await comparisonFor(finding, { userId, client, now });
      const scored = (s: Scored) => ({
        provider: s.option.provider,
        plan: s.option.name,
        firstYearCost: money(s.firstYearCents),
        savingFirstYear: money(s.savingCents),
        notes: s.notes,
      });
      return out({
        id: card.findingId,
        kind: card.findingType,
        status: finding.status,
        title: card.title,
        why: card.explanation,
        whatChanges: card.whatChanges,
        estimateAYear: card.annualSavingsCents === null ? null : money(card.annualSavingsCents),
        giveUp: card.giveUp,
        alternatives: card.alternatives,
        evidence: card.evidence.map((row) => ({
          date: row.date,
          what: row.label,
          amount: row.amountCents === null ? null : money(row.amountCents),
        })),
        comparison: comparison && {
          payNowAYear: money(comparison.currentYearCents),
          janesPick: scored(comparison.pick),
          whyThePick: comparison.why,
          runnersUp: comparison.runnersUp.slice(0, CHAT_RUNNERS_UP).map(scored),
        },
      });
    }
    case "subscriptions": {
      const { charges } = await loadRecurring(userId, { client, now });
      return out({
        charges: charges.map((r) => ({
          merchant: r.merchant,
          subscription: r.subscription,
          billed: frequencyWords(r.frequency),
          lastCharge: money(r.lastAmountCents),
          lastDate: r.lastDate,
          nextDate: r.nextDate,
          aYear: money(r.annualCostCents),
          openFindingId: r.openFindingId,
        })),
      });
    }
    case "recent_changes": {
      const changes = await loadChanges(userId, { client, now });
      return out({
        changes: changes.map((c) => ({
          what: c.kind,
          said: c.title,
          date: c.date,
          amount: money(c.amountCents),
          usual: c.usualCents === null ? null : money(c.usualCents),
          merchant: c.merchant,
          category: c.category,
          jane: c.finding?.handledBy
            ? `already acting on it (${c.finding.handledBy === "rule" ? "autopilot" : "they said yes"})`
            : c.finding
              ? `can act on it with finding ${c.finding.id}`
              : null,
          openFindingId:
            c.finding && (c.finding.status === "new" || c.finding.status === "shown")
              ? c.finding.id
              : null,
        })),
      });
    }
    case "life_events": {
      const [guesses, checklists] = await Promise.all([
        lifeGuessesFor(userId, { client, now }),
        listLifeEvents(userId, { client }),
      ]);
      return out({
        spotted: guesses.map(guessLine),
        checklists: checklists.map((c) => ({
          kind: c.kind,
          started: c.startedOn,
          done: c.completedAt !== null,
          ticked: `${c.checkedItems.length} of ${LIFE_EVENTS[c.kind].items.length}`,
        })),
      });
    }
    case "plan_upkeep": {
      const [upkeep, snapshot] = await Promise.all([
        loadUpkeep(userId, { client, now }),
        loadSnapshot(userId, { client, now }),
      ]);
      return out({
        tuneUp: upkeep.tuneUp && {
          month: upkeep.tuneUp.month,
          status: upkeep.tuneUp.status,
          budgets: upkeep.tuneUp.changes.map((c) => ({
            category: c.category,
            now: money(c.fromCents),
            usual: money(c.toCents),
          })),
        },
        transfersToCount: upkeep.transfers.map((t) => ({
          amount: money(t.amountCents),
          date: t.date,
          goal: t.goal.name,
        })),
        weeklyReview: snapshot ? weeklyReview(snapshot, now).body : null,
      });
    }
    case "proven_savings": {
      const saved = await provenSavings(userId, { client, now });
      return out({
        confirmedTotal: money(saved.confirmedCents),
        receipts: saved.confirmed.map((r) => ({
          what: r.title,
          kind: r.kind,
          saved: money(r.cents),
          perYear: r.yearly,
          proof: r.proof,
        })),
        estimatedTotal: money(saved.estimatedCents),
        estimates: saved.estimated.map((e) => ({
          what: e.title,
          about: money(e.cents),
          why: e.why,
        })),
      });
    }
    case "money_moves": {
      const [plan, transfers, partner] = await Promise.all([
        latestPaycheckPlan(userId, { client, now }),
        listTransfers(userId, { client, now }),
        moneyPartnerFor(userId, { client }),
      ]);
      const bills = partner ? await loadBillPay(userId, { client, now }) : null;
      return out({
        sampleOnly: true,
        bills: (bills?.items ?? []).map((i) => ({
          name: i.bill.name,
          due: i.bill.dueOn,
          minimum: money(i.bill.minimumCents),
          status: i.status,
          ...(i.status === "scheduled" || i.status === "ask"
            ? { amount: money(i.amountCents), on: i.runOn }
            : {}),
          ...(i.status === "short" && i.moveTo ? { moveDueDateTo: i.moveTo } : {}),
        })),
        paycheck: plan && {
          amount: money(plan.paycheckCents),
          paidOn: plan.paidOn,
          moves: plan.moves.map((m) => ({ to: m.label, amount: money(m.cents), status: m.status })),
        },
        transfers: transfers.slice(0, 10).map((t) => ({
          to: t.toName,
          amount: money(t.amountCents),
          status: t.status,
          on: t.runOn,
          by: t.by,
        })),
      });
    }
    case "priorities": {
      const snapshot = await loadSnapshot(userId, { client, now });
      return out({
        ranked: (snapshot ? rankedFor(snapshot) : []).slice(0, 10).map((r) => ({
          what: r.title,
          kind: r.kind,
          savesAYear: r.valueCents === null ? null : money(r.valueCents),
          minutes: r.minutes,
          due: r.dueOn ?? null,
          why: r.why,
          findingId: r.kind === "finding" ? r.ref : null,
        })),
      });
    }
    case "whole_picture": {
      const snapshot = await loadSnapshot(userId, { client, now });
      if (!snapshot) return out({ linked: false });
      const ranked = rankedFor(snapshot);
      const week = wholePicture(snapshot, ranked, "now");
      const month = wholePicture(snapshot, ranked, "month");
      const due = (rows: typeof week.due) =>
        rows.map((d) => ({
          what: d.label,
          date: d.date,
          amount: d.amountCents === null ? null : money(d.amountCents),
        }));
      return out({
        verdict: week.verdict,
        headline: week.headline,
        safeToSpend: week.safe && {
          amount: money(week.safe.safeCents),
          untilPayday: week.safe.payday,
        },
        dueThisWeek: due(week.due),
        dueThisMonth: due(month.due),
        budgetsOver: week.budgetsOver.map((b) => ({
          category: b.category,
          over: money(b.overCents),
        })),
        goalsBehind: week.goalsBehind.map((g) => ({ goal: g.name, stillToGo: money(g.leftCents) })),
        urgent: week.urgent,
        janeWorkingOn: week.working,
        waitingOnThePerson: week.waitingOnYou,
        safeToApproveAtOnce: week.safeItems,
        mattersMost: week.top.map((r) => ({
          what: r.title,
          savesAYear: r.valueCents === null ? null : money(r.valueCents),
          why: r.why,
          findingId: r.kind === "finding" ? r.ref : null,
        })),
      });
    }
    case "nightly_log": {
      const run = await lastControllerRun(userId, { client, now });
      return out(
        run
          ? {
              night: run.day,
              checked: run.steps.map((s) => ({
                area: CONTROLLER_STEP_LABELS[s.step],
                result: s.status,
                did: s.did,
                changed: s.changed,
              })),
            }
          : { note: "No nightly run yet." },
      );
    }
    case "autopilot_settings": {
      const sectors = await sectorAutopilots(userId, { client, now });
      return out({
        areas: sectors.map((s) => ({
          area: SECTOR_LABELS[s.sector],
          level: SECTOR_LEVEL_LABELS[s.level],
          eachTime: money(s.actionCapCents),
          eachMonth: money(s.monthlyCapCents),
          usedThisMonth: money(s.usedThisMonthCents),
          setBy: s.source === "set" ? "the person" : "their autopilot level's default",
        })),
      });
    }
    case "goals": {
      const goals = await listGoals(userId, { client, now });
      return out({
        goals: goals.map((g) => ({
          name: g.name,
          target: money(g.targetCents),
          by: g.targetDate,
          saved: money(g.progress.savedCents),
          status: g.progress.status,
          monthlyNeeded: g.progress.status === "on_the_way" ? money(g.progress.monthlyCents) : null,
        })),
      });
    }
    case "budgets": {
      const db = scopedFor(userId, client);
      const budgets = await db.budgets.findMany({ select: { category: true, amountCents: true } });
      if (budgets.length === 0) return out({ budgets: [], note: "No budgets set." });
      const summary = budgetSummary(
        await loadInsightTransactions(db, asOf, BUDGET_SUGGESTION_MONTHS + 1),
        budgets,
        asOf,
      );
      return out({
        month: summary.month,
        daysLeft: summary.daysLeft,
        budgets: summary.progress.map((p) => ({
          category: p.category,
          budget: money(p.budgetCents),
          spent: money(p.spentCents),
          left: money(p.leftCents),
          over: p.over,
        })),
      });
    }
    case "net_worth": {
      const db = scopedFor(userId, client);
      const [accounts, owned, crypto] = await Promise.all([
        db.accounts.findMany({
          select: { id: true, name: true, type: true, subtype: true, currentBalanceCents: true },
        }),
        db.ownedAssets.findMany({ select: { id: true, valueCents: true, valuedOn: true } }),
        cryptoTotal(userId, { client }),
      ]);
      const worth = netWorth(
        accounts.map((a) => ({ ...a, balanceCents: a.currentBalanceCents })),
        owned.map((o) => ({ ...o, valuedOn: o.valuedOn.toISOString().slice(0, 10) })),
        crypto,
      );
      return out({
        has: money(worth.assetsCents),
        owes: money(worth.debtsCents),
        netWorth: money(worth.netCents),
        ...(worth.cryptoCents > 0 ? { ofWhichCryptoReadOnly: money(worth.cryptoCents) } : {}),
        accountsWithoutABalance: worth.missing.length,
      });
    }
    default:
      return { content: JSON.stringify({ error: `There's no tool called ${name}.` }), cents: [] };
  }
}

// The person's main numbers, looked up before Claude is asked and sent with the question,
// so most answers need no lookup. The same tools Claude can call, so the figures are
// recorded for the guardrails in the same way. One that fails is left out.
export async function chatPrimer(
  userId: string,
  { client, now }: Options,
): Promise<{ text: string; cents: number[] }> {
  // Spec step 93: reused for a minute.
  const cached = cachedPrimer(userId, now);
  if (cached) return cached;
  const results = await Promise.allSettled(
    CHAT_PRIMER_TOOLS.map((name) => runChatTool(userId, name, {}, { client, now })),
  );
  const parts: string[] = [];
  const cents: number[] = [];
  results.forEach((result, i) => {
    if (result.status !== "fulfilled") return;
    parts.push(`${CHAT_PRIMER_TOOLS[i]}: ${result.value.content}`);
    cents.push(...result.value.cents);
  });
  // Spec step 91: what they told Jane, and suggestions not to make again.
  const remembered = await listPreferences(userId, { client }).catch(() => []);
  if (remembered.length > 0) {
    parts.push(`remembered: ${JSON.stringify(remembered.map((p) => p.label))}`);
  }
  const primer = { text: parts.join("\n"), cents };
  keepPrimer(userId, now, primer);
  return primer;
}

// What propose_action adds to the reply: the buttons, the refs they need, and a fixed
// line saying what they're for. Or why it was refused.
export type Proposal =
  | { ok: true; actions: MessageAction[]; refs: Reply["refs"]; line: string | null }
  | { ok: false; error: string };

const refuse = (error: string): Proposal => ({ ok: false, error });

export async function proposeAction(
  userId: string,
  input: unknown,
  { client, now }: Options,
): Promise<Proposal> {
  const args = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const action = str(args.action);

  if (action === "open") {
    const page = Object.hasOwn(CHAT_PAGES, str(args.page)) ? CHAT_PAGES[str(args.page)] : null;
    if (!page) return refuse("Unknown page.");
    return { ok: true, actions: [{ id: "open", kind: "link", ...page }], refs: {}, line: null };
  }
  // Only buttons from the registry, and only the ones Claude may offer.
  const id = action as ActionId;
  if (
    !(ACTION_IDS as readonly string[]).includes(action) ||
    !Object.hasOwn(ACTION_HANDLERS, action) ||
    !PROPOSABLE.includes(id)
  ) {
    return refuse(`"${action}" isn't an action you can offer.`);
  }

  if (id === "finding.yes") {
    const snapshot = await loadSnapshot(userId, { client, now });
    const finding = snapshot?.findings.find((f) => f.findingId === str(args.finding_id));
    if (!snapshot || !finding) return refuse("That isn't one of the person's open findings.");
    const candidate = findingCandidate(finding);
    return { ok: true, actions: candidate.actions, refs: candidate.refs, line: candidate.body };
  }

  if (id === "plan.approve_safe") {
    const snapshot = await loadSnapshot(userId, { client, now });
    if (!snapshot || snapshot.plan.safeItems === 0) {
      return refuse("Nothing on the plan is safe to approve together right now.");
    }
    return {
      ok: true,
      actions: [
        { id, label: "Approve all safe ones", kind: "primary" },
        { id: "open", label: "Review the plan", kind: "link", href: "/plan" },
      ],
      refs: {},
      line: null,
    };
  }

  if (id === "invest.rebalance") {
    const { advice, plan } = await loadRebalance(userId, { client, now });
    if (!advice || !plan || plan.orders.length === 0) {
      return refuse(
        "There's no rebalancing to offer: not demo advice mode, no profile, or on target.",
      );
    }
    const reply = rebalanceOffer(plan);
    return { ok: true, actions: reply.actions, refs: reply.refs, line: reply.body };
  }

  // goal.start
  const name = str(args.goal_name).slice(0, 80);
  const amount = typeof args.goal_amount === "number" ? args.goal_amount : NaN;
  const targetCents = Math.round(amount * 100);
  const month = str(args.goal_month);
  const asOf = now.toISOString().slice(0, 10);
  if (!name) return refuse("The goal needs a name.");
  if (!Number.isFinite(amount) || targetCents <= 0 || targetCents > MAX_AFFORD_CENTS) {
    return refuse("The goal needs an amount in dollars.");
  }
  if (!affordWindow(asOf).months.slice(1).includes(month)) {
    return refuse("The goal month must be YYYY-MM within the next 12 months, after this one.");
  }
  return {
    ok: true,
    actions: [{ id, label: "Start a goal for it", kind: "primary" }],
    refs: { goal: { name, targetCents, targetDate: `${month}-01` } },
    line: `The goal: ${name}, ${formatCents(targetCents)} by ${monthLabel(month)}.`,
  };
}
