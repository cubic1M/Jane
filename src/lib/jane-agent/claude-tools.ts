import type Anthropic from "@anthropic-ai/sdk";
import { BUDGET_SUGGESTION_MONTHS } from "@/config/budgets";
import { MAX_AFFORD_CENTS } from "@/config/afford";
import { CHAT_PRIMER_TOOLS } from "@/config/agent-chat";
import type { PrismaClient } from "@/generated/prisma/client";
import { budgetSummary } from "@/insights/budgets";
import { loadInsightTransactions } from "@/insights/load";
import { netWorth } from "@/insights/net-worth";
import { ASK_TOOLS, runAskTool, type ToolOutput } from "@/lib/ask/tools";
import { scopedFor } from "@/lib/db-scoped";
import { listGoals } from "@/lib/goals";
import { homeSummary } from "@/lib/home";
import { formatCents } from "@/lib/money";
import { affordWindow } from "@/planning/afford";
import { ACTION_HANDLERS } from "./actions";
import { monthLabel, type Reply } from "./replies";
import { localTime } from "./quiet-hours";
import { loadSnapshot } from "./snapshot";
import { findingsSource } from "./sources/findings";
import { ACTION_IDS, type ActionId, type MessageAction } from "./types";

// The tools Claude gets in Jane's chat (spec step 84). Read-only tools over the person's
// own data, wrapping the same loaders as the pages (and Ask's own tools, src/lib/ask), each
// scoped to the person. Every dollar figure a tool returns is recorded for the guardrails.
// One more, propose_action, can only put buttons from the action registry under the
// answer: Claude never runs an action, the person taps.

type Options = { client: PrismaClient; now: Date };

// Ask's tools, except its findings list: the chat's has the ids propose_action needs.
const FROM_ASK = ASK_TOOLS.filter((t) => t.name !== "list_findings");

// Buttons Claude may offer. Undo isn't one: it belongs to the message it undoes.
export const PROPOSABLE: readonly ActionId[] = ["finding.yes", "plan.approve_safe", "goal.start"];

// Pages Claude may link to, by name.
export const CHAT_PAGES: Readonly<Record<string, { label: string; href: string }>> = {
  today: { label: "See today", href: "/home" },
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
  settings: { label: "Settings", href: "/settings" },
};

const noInput = { type: "object" as const, properties: {}, additionalProperties: false };

export const CHAT_TOOLS: Anthropic.Tool[] = [
  ...FROM_ASK,
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
      "Things the app found that could save the person money and they haven't decided on yet, with each one's id (for propose_action), estimate, and Jane's pick when there's one.",
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
    name: "propose_action",
    description:
      "Offer the person a button under your answer. You can't do anything yourself; the person decides by tapping. Use it at most once, and only when the person asked for something to be done. Actions: finding.yes (Yes and No on one open finding; give finding_id from open_findings), plan.approve_safe (approve the plan's safe items together), goal.start (start a savings goal; give goal_name, goal_amount in dollars and goal_month as YYYY-MM within the next 12 months), open (a link to a page; give page).",
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
            title: f.title,
            estimate: f.savings,
            janesPick: f.pick?.name ?? null,
          };
        }),
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
      const [accounts, owned] = await Promise.all([
        db.accounts.findMany({
          select: { id: true, name: true, type: true, subtype: true, currentBalanceCents: true },
        }),
        db.ownedAssets.findMany({ select: { id: true, valueCents: true, valuedOn: true } }),
      ]);
      const worth = netWorth(
        accounts.map((a) => ({ ...a, balanceCents: a.currentBalanceCents })),
        owned.map((o) => ({ ...o, valuedOn: o.valuedOn.toISOString().slice(0, 10) })),
      );
      return out({
        has: money(worth.assetsCents),
        owes: money(worth.debtsCents),
        netWorth: money(worth.netCents),
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
  return { text: parts.join("\n"), cents };
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
    const [candidate] = findingsSource.gather(
      { ...snapshot, findings: [finding] },
      { now, local: localTime(now, snapshot.timezone), trigger: "open" },
    );
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
