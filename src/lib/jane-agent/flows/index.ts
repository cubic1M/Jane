import { AFFORD_USUAL_MONTHS } from "@/config/agent-chat";
import { INSIGHT_MONTHS } from "@/config/insights";
import type { FindingType } from "@/generated/prisma/client";
import { loadInsightTransactions } from "@/insights/load";
import { monthsEnding, spendingInsights } from "@/insights/spending";
import { setBudget } from "@/lib/budgets";
import { CARD_SELECT } from "@/lib/cards";
import { comparisonFor } from "@/lib/compare";
import { optionLabel } from "@/planning/compare";
import { scopedFor } from "@/lib/db-scoped";
import { addGoal } from "@/lib/goals";
import { formatCents, centsToInput } from "@/lib/money";
import { findingPick, findingYes } from "../actions/finding";
import type { ActionContext } from "../actions/handler";
import { addMonths } from "../intents";
import { monthLabel } from "../replies";
import { loadSnapshot, type SnapshotFinding } from "../snapshot";
import { shortName } from "../sources/findings";
import type { ChatMessage, MessageAction, MessageRefs } from "../types";
import type { FlowContext, FlowDef, FlowId } from "./engine";

// The guided flows (spec step 95). Each asks a few questions, then ends in the feature's own
// code: Budgets' setBudget, Goals' addGoal, and a finding's own Yes (a switch to the option
// picked, or asking for money back), exactly as a tap on its message would.

const whole = (cents: number) => Math.ceil(cents / 100) * 100;

// --- Set up a budget ------------------------------------------------------------------

type BudgetData = { categories: { category: string; usualCents: number }[] };

const budget: FlowDef<BudgetData> = {
  id: "budget",
  title: "Setting up a budget",
  async load({ userId, client, now }) {
    const asOf = now.toISOString().slice(0, 10);
    const db = scopedFor(userId, client);
    const [transactions, budgets] = await Promise.all([
      loadInsightTransactions(db, asOf, INSIGHT_MONTHS),
      db.budgets.findMany({ select: { category: true } }),
    ]);
    const insights = spendingInsights(transactions, { asOf, monthCount: INSIGHT_MONTHS });
    const past = monthsEnding(asOf, AFFORD_USUAL_MONTHS + 1).slice(0, -1);
    const has = new Set(budgets.map((b) => b.category));
    const totals = new Map<string, number>();
    for (const month of past) {
      for (const c of insights.categoriesByMonth[month] ?? []) {
        totals.set(c.category, (totals.get(c.category) ?? 0) + c.cents);
      }
    }
    return {
      categories: [...totals.entries()]
        .filter(([category, cents]) => !has.has(category) && cents > 0)
        .map(([category, cents]) => ({ category, usualCents: Math.round(cents / past.length) }))
        .sort((a, b) => b.usualCents - a.usualCents),
    };
  },
  none: (data) =>
    data.categories.length === 0 ? "Every category you spend on already has a budget." : null,
  steps: [
    {
      key: "category",
      ask: (_, data) => ({
        question: "Which category? These are where you spend the most without a budget.",
        options: data.categories.map((c) => ({ label: c.category, value: c.category })),
      }),
    },
    {
      key: "amount",
      ask: (answers, data) => {
        const usual = data.categories.find((c) => c.category === answers.category)?.usualCents ?? 0;
        const amounts = [whole(usual), whole(usual * 0.9), whole(usual * 0.8)].filter(
          (c, i, all) => c > 0 && all.indexOf(c) === i,
        );
        return {
          question: `How much a month for ${answers.category}? You usually spend about ${formatCents(whole(usual))}.`,
          options: amounts.map((c) => ({ label: `${formatCents(c)} a month`, value: String(c) })),
          typed: "amount",
        };
      },
    },
  ],
  async finish(answers, _, { userId, client }) {
    const cents = Number(answers.amount);
    await setBudget(userId, answers.category, centsToInput(cents), { client });
    return `Done. Your ${answers.category} budget is ${formatCents(cents)} a month, starting this month. I'll tell you here if you get close to it.`;
  },
};

// --- Start a goal ---------------------------------------------------------------------

const goal: FlowDef<null> = {
  id: "goal",
  title: "Starting a goal",
  load: async () => null,
  none: () => null,
  steps: [
    {
      key: "name",
      ask: () => ({
        question: "What are you saving for?",
        options: ["Emergency fund", "Trip", "New car", "Home"].map((n) => ({ label: n, value: n })),
        typed: "text",
      }),
    },
    {
      key: "amount",
      ask: (answers) => ({
        question: `How much do you need for ${answers.name.toLowerCase() === answers.name ? answers.name : answers.name.toLowerCase()}?`,
        options: [100_000, 500_000, 1_000_000].map((c) => ({
          label: formatCents(c),
          value: String(c),
        })),
        typed: "amount",
      }),
    },
    {
      key: "months",
      ask: () => ({
        question: "By when?",
        options: [
          { label: "In 6 months", value: "6" },
          { label: "In a year", value: "12" },
          { label: "In 2 years", value: "24" },
        ],
      }),
    },
  ],
  async finish(answers, _, { userId, client, now }) {
    const month = addMonths(now.toISOString().slice(0, 7), Number(answers.months));
    const name = answers.name.charAt(0).toUpperCase() + answers.name.slice(1);
    const cents = Number(answers.amount);
    await addGoal(
      userId,
      {
        name,
        target: centsToInput(cents),
        targetDate: `${month}-01`,
        accountId: "",
        saved: "",
      },
      { client },
    );
    return `Added "${name}": ${formatCents(cents)} by ${monthLabel(month)}. Safe to spend now sets a little aside for it each month.`;
  },
};

// --- Switch a provider and dispute a charge: a finding's own Yes -----------------------

// The finding's own button handler, as if its message had been tapped.
function tapOn(
  context: FlowContext,
  finding: SnapshotFinding,
  refs: MessageRefs,
  label: string,
): ActionContext {
  const action: MessageAction = { id: "finding.yes", label, kind: "primary" };
  const message: ChatMessage = {
    id: "flow",
    kind: "reply",
    body: finding.title,
    refs: { findingId: finding.findingId, fingerprint: finding.fingerprint, ...refs },
    actions: [action],
    status: "open",
    answeredWith: null,
    answeredAt: null,
    createdAt: context.now,
  };
  return { ...context, message, action };
}

type SwitchData = {
  findings: SnapshotFinding[];
  options: { value: string; label: string; name: string }[];
};

const switchFlow: FlowDef<SwitchData> = {
  id: "switch",
  title: "Switching a provider",
  async load({ userId, client, now }, answers) {
    const snapshot = await loadSnapshot(userId, { client, now });
    const findings = (snapshot?.findings ?? []).filter((f) => f.pick);
    const chosen = findings.find((f) => f.findingId === answers.finding);
    let options: SwitchData["options"] = [];
    if (chosen) {
      const finding = await scopedFor(userId, client).findings.findFirst({
        where: { id: chosen.findingId },
        select: { ...CARD_SELECT, status: true },
      });
      const comparison = finding && (await comparisonFor(finding, { userId, client, now }));
      options = comparison
        ? [comparison.pick, ...comparison.runnersUp].map((s) => ({
            value: s.option.id,
            name: optionLabel(s.option),
            label: `${s.option.name}: saves ${formatCents(s.savingCents)}`,
          }))
        : [];
    }
    return { findings, options };
  },
  none: (data) =>
    data.findings.length === 0 ? "I haven't compared any providers for you yet." : null,
  steps: [
    {
      key: "finding",
      ask: (_, data) => ({
        question: "Which one do you want to switch?",
        options: data.findings.map((f) => ({ label: shortName(f.title), value: f.findingId })),
      }),
    },
    {
      key: "option",
      ask: (_, data) => ({
        question: "Which would you switch to? My pick is first.",
        options: data.options.map((o) => ({ label: o.label, value: o.value })),
      }),
    },
    {
      key: "confirm",
      ask: (answers, data) => ({
        question: `Switch to ${data.options.find((o) => o.value === answers.option)?.name ?? "that"}? I'll send you the sign-up step, and cancel the old one only once the new one shows up.`,
        options: [{ label: "Yes, switch", value: "yes" }],
      }),
    },
  ],
  async finish(answers, data, context) {
    const finding = data.findings.find((f) => f.findingId === answers.finding);
    if (!finding) return "That one isn't there anymore.";
    const outcome = await findingPick.run(
      tapOn(context, finding, { pickOptionId: answers.option }, "Yes, switch"),
    );
    return outcome.note ?? "Done.";
  },
};

const REFUNDS: readonly FindingType[] = [
  "duplicate_charge",
  "charge_after_cancel",
  "trial_conversion",
];

type DisputeData = { findings: SnapshotFinding[] };

const dispute: FlowDef<DisputeData> = {
  id: "dispute",
  title: "Disputing a charge",
  async load({ userId, client, now }) {
    const snapshot = await loadSnapshot(userId, { client, now });
    return { findings: (snapshot?.findings ?? []).filter((f) => REFUNDS.includes(f.type)) };
  },
  none: (data) =>
    data.findings.length === 0
      ? "I don't see a charge that looks wrong right now: no double charges, charges after a cancellation or trials that turned into a charge."
      : null,
  steps: [
    {
      key: "finding",
      ask: (_, data) => ({
        question: "Which charge? These are the ones that look wrong.",
        options: data.findings.map((f) => ({ label: shortName(f.title), value: f.findingId })),
      }),
    },
    {
      key: "confirm",
      ask: (answers, data) => {
        const finding = data.findings.find((f) => f.findingId === answers.finding);
        return {
          question: `${finding?.title ?? "That charge"}. ${finding?.savings ?? ""} Should I ask for it back?`,
          options: [{ label: "Yes, ask for it back", value: "yes" }],
        };
      },
    },
  ],
  async finish(answers, data, context) {
    const finding = data.findings.find((f) => f.findingId === answers.finding);
    if (!finding) return "That one isn't there anymore.";
    const outcome = await findingYes.run(tapOn(context, finding, {}, "Yes, ask for it back"));
    return outcome.note ?? "Done.";
  },
};

// Every flow, by id.
export const FLOWS: Readonly<Record<FlowId, FlowDef<never>>> = {
  budget: budget as FlowDef<never>,
  goal: goal as FlowDef<never>,
  switch: switchFlow as FlowDef<never>,
  dispute: dispute as FlowDef<never>,
};
