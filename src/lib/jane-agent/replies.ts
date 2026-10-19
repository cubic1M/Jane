import { AFFORD_USUAL_MONTHS, CHAT_TOP_CATEGORIES, WEEKS_PER_MONTH } from "@/config/agent-chat";
import { INSIGHT_MONTHS } from "@/config/insights";
import { MAX_AFFORD_CENTS } from "@/config/afford";
import { RULE_UNDO_HOURS } from "@/config/rules";
import { normalizeMerchant } from "@/data-sources/merchant";
import type { FindingType } from "@/generated/prisma/client";
import type { ComingUpRow } from "@/insights/coming-up";
import { CATEGORY_LABELS, UNCATEGORIZED } from "@/insights/labels";
import {
  kindOf,
  monthsEnding,
  spendingInsights,
  type InsightTransaction,
} from "@/insights/spending";
import { formatCents } from "@/lib/money";
import type { JaneDid } from "@/lib/what-jane-did";
import {
  AFFORD_COPY,
  monthlyNeededLine,
  reachedByLine,
  safeLine,
  shortLine,
} from "@/planning/afford-copy";
import type { Budget } from "@/insights/budgets";
import {
  affordCheck,
  affordWindow,
  monthOf,
  type AffordNumbers,
  type AffordResult,
} from "@/planning/afford";
import { CHAT_CLARIFY_CHOICES } from "@/config/agent-chat";
import { matchCategory, type ActVerb, type Intent } from "./intents";
import { nameMatches } from "./names";
import { localTime } from "./quiet-hours";
import type { Snapshot, SnapshotFinding } from "./snapshot";
import { findingsSource } from "./sources/findings";
import { inDays, shortDate, things } from "./sources/source";
import type { MessageAction, MessageRefs } from "./types";

// Jane's answers to what the person typed (spec step 84), from the same loaders as the
// pages. Pure: each takes the numbers and returns fixed wording in Jane's voice, with the
// buttons to tap. Typing never acts on its own: anything that changes something is a
// button from the registry (src/lib/jane-agent/actions), checked again when it's tapped.

export type Reply = { body: string; actions: MessageAction[]; refs: MessageRefs };

const reply = (body: string, actions: MessageAction[] = [], refs: MessageRefs = {}): Reply => ({
  body,
  actions,
  refs,
});
const link = (label: string, href: string): MessageAction => ({
  id: "open",
  label,
  kind: "link",
  href,
});
const fmt = (cents: number) => (cents < 0 ? `−${formatCents(-cents)}` : formatCents(cents));

const utc = (iso: string, options: Intl.DateTimeFormatOptions) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-US", { ...options, timeZone: "UTC" });
// "March 2027".
export const monthLabel = (month: string) => utc(`${month}-01`, { month: "long", year: "numeric" });
const longDate = (iso: string) => utc(iso, { month: "short", day: "numeric", year: "numeric" });

export const EXAMPLES = [
  "can I afford $900 for a trip in March",
  "how much did I spend on food last month",
  "what's due this week",
  "safe to spend",
  "cancel Hulu, lower my phone bill, or get my refund from Target",
  "what did you do",
];

const exampleList = () => EXAMPLES.map((e) => `- ${e}`).join("\n");

export function helpReply(): Reply {
  return reply(
    `You can ask me things like:\n${exampleList()}\nI never act on what you type alone: I'll answer with buttons for you to tap.`,
  );
}

// Anything the rules don't understand, when there's no Claude key (or Claude can't answer).
export function unknownReply(): Reply {
  return reply(`I can help with your money here, but I didn't catch that. Try:\n${exampleList()}`);
}

// The category a purchase is in ("food" → Food and drink), next to the person's own
// numbers: spent this month so far, a usual month (the average of the last complete
// months) and their budget, if they set one.
export type CategoryContext = {
  category: string;
  month: string;
  spentCents: number;
  usualMonthCents: number;
  budgetCents: number | null;
};

const CATEGORY_LIST = [...new Set([...Object.values(CATEGORY_LABELS), UNCATEGORIZED])];

export function categoryContext(
  query: string,
  transactions: InsightTransaction[],
  budgets: Budget[],
  asOf: string,
): CategoryContext | null {
  const category = matchCategory(query, CATEGORY_LIST);
  if (!category) return null;
  const months = monthsEnding(asOf, AFFORD_USUAL_MONTHS + 1);
  const insights = spendingInsights(transactions, { asOf, monthCount: months.length });
  const spentIn = (m: string) =>
    insights.categoriesByMonth[m]?.find((c) => c.category === category)?.cents ?? 0;
  const month = months.at(-1)!;
  const past = months.slice(0, -1);
  return {
    category,
    month,
    spentCents: spentIn(month),
    usualMonthCents: Math.round(past.reduce((sum, m) => sum + spentIn(m), 0) / past.length),
    budgetCents: budgets.find((b) => b.category === category)?.amountCents ?? null,
  };
}

const roundDollars = (cents: number) => Math.round(cents / 100) * 100;
// "about 5×", "about 1.5×".
const times = (n: number) => `${n >= 10 ? Math.round(n) : Math.round(n * 10) / 10}×`;

// What a once-off amount means next to the category: spent so far, a usual week or month,
// the budget.
function categoryLines(
  context: CategoryContext,
  amountCents: number,
  period: "week" | "month" | null,
): string[] {
  const { category, month, spentCents, usualMonthCents, budgetCents } = context;
  const lines = [
    `So far in ${monthLabel(month).split(" ")[0]} you've spent ${fmt(spentCents)} on ${category}.`,
  ];
  if (usualMonthCents > 0) {
    if (period === "week") {
      const week = usualMonthCents / WEEKS_PER_MONTH;
      lines.push(
        `You usually spend about ${fmt(roundDollars(week))} a week on ${category}, so ${fmt(amountCents)} is about ${times(amountCents / week)} a usual week.`,
      );
    } else {
      lines.push(
        `You usually spend about ${fmt(roundDollars(usualMonthCents))} a month on ${category}.`,
      );
    }
  }
  if (budgetCents !== null) {
    const after = spentCents + amountCents;
    lines.push(
      after > budgetCents
        ? `Your ${category} budget is ${fmt(budgetCents)} a month: this would take you to ${fmt(after)}, ${fmt(after - budgetCents)} over.`
        : `Your ${category} budget is ${fmt(budgetCents)} a month: this would take you to ${fmt(after)}, ${fmt(budgetCents - after)} under.`,
    );
  }
  return lines;
}

// Safe to spend, goals and checking, before and after, as on /afford.
function effectLines(result: AffordResult): string[] {
  const lines: string[] = [];
  if (!result.safe) {
    lines.push(AFFORD_COPY.noChecking);
  } else if (result.safe.beforeCents === result.safe.afterCents) {
    lines.push(
      `Safe to spend stays ${fmt(result.safe.beforeCents)}${result.safe.payday ? ` until ${shortDate(result.safe.payday)}` : ""}, since this comes after your next payday.`,
    );
  } else {
    lines.push(
      safeLine(
        result.safe.payday ? shortDate(result.safe.payday) : null,
        fmt(result.safe.beforeCents),
        fmt(result.safe.afterCents),
      ),
    );
  }
  for (const goal of result.goals) {
    if (goal.kind === "monthly_needed" && goal.afterCents !== goal.beforeCents) {
      lines.push(
        monthlyNeededLine(
          goal.name,
          fmt(goal.beforeCents),
          fmt(goal.afterCents),
          longDate(goal.targetDate),
        ),
      );
    }
    if (goal.kind === "reached_by" && goal.after !== goal.before) {
      const short = (m: string | null) => m && utc(`${m}-01`, { month: "short", year: "numeric" });
      lines.push(
        reachedByLine(
          goal.name,
          { before: fmt(goal.beforeMonthlyCents), after: fmt(goal.afterMonthlyCents) },
          short(goal.before),
          short(goal.after),
        ),
      );
    }
  }
  if (result.firstShort && (result.firstShort.before || result.firstShort.after)) {
    lines.push(
      shortLine(
        result.firstShort.before && monthLabel(result.firstShort.before),
        result.firstShort.after && monthLabel(result.firstShort.after),
      ),
    );
  }
  return lines;
}

// "Can I afford $900 for a trip in March?", "can I spend $500 on food this week?": what it
// does to safe to spend, goals and checking, as on /afford, and, when it names a category,
// how it compares with what the person usually spends there and their budget. A purchase
// in a later month gets "Start a goal for it". "$500 a month on food" is a monthly change:
// what's more than usual for that category.
export function affordReply(
  intent: Extract<Intent, { kind: "afford" }>,
  numbers: AffordNumbers,
  context: CategoryContext | null = null,
): Reply {
  const { asOf } = numbers;
  if (intent.amountCents === null) {
    return reply('How much is it? Try "can I afford $900 for a trip in March".');
  }
  if (intent.amountCents > MAX_AFFORD_CENTS) return reply(AFFORD_COPY.errors.tooBig);
  const current = monthOf(asOf);
  const month = intent.month ?? current;
  if (!affordWindow(asOf).months.includes(month)) return reply(AFFORD_COPY.errors.month);
  if (intent.recurring)
    return monthlyAffordReply(intent.amountCents, intent.what, month, numbers, context);

  const later = month > current;
  const date = later ? `${month}-01` : asOf;
  const result = affordCheck(numbers, {
    kind: "purchase",
    amountCents: intent.amountCents,
    date,
  });

  const when = later
    ? ` in ${monthLabel(month)}`
    : intent.period === "week"
      ? " this week"
      : " now";
  const lines = [
    `If you spend ${fmt(intent.amountCents)}${intent.what ? ` on ${intent.what}` : ""}${when}:`,
    ...effectLines(result),
  ];
  // Spending so far and the budget are about this month; a later month only gets the goal.
  if (context && !later) lines.push(...categoryLines(context, intent.amountCents, intent.period));
  lines.push("This is math, not a recommendation.");

  const amount = (intent.amountCents / 100).toFixed(2);
  const actions: MessageAction[] = [];
  const refs: MessageRefs = {};
  if (later) {
    const name = intent.what
      ? intent.what.replace(/^(?:a|an|the|my|our|some) /, "")
      : `Purchase in ${monthLabel(month)}`;
    refs.goal = {
      name: name.charAt(0).toUpperCase() + name.slice(1),
      targetCents: intent.amountCents,
      targetDate: `${month}-01`,
    };
    actions.push({ id: "goal.start", label: "Start a goal for it", kind: "primary" });
  }
  actions.push(link("See the full check", `/afford?kind=purchase&amount=${amount}&date=${date}`));
  return reply(lines.join("\n"), actions, refs);
}

// "Can I spend $500 a month on food?": with a category, the change is what's above (or
// below) a usual month there; without one, all of it is more going out each month.
function monthlyAffordReply(
  amountCents: number,
  what: string | null,
  month: string,
  numbers: AffordNumbers,
  context: CategoryContext | null,
): Reply {
  const from = month > monthOf(numbers.asOf) ? ` from ${monthLabel(month)}` : "";
  const lines: string[] = [];
  let extraCents = amountCents;
  if (context && context.usualMonthCents > 0) {
    const usual = roundDollars(context.usualMonthCents);
    extraCents = amountCents - usual;
    lines.push(
      `You usually spend about ${fmt(usual)} a month on ${context.category}, so ${fmt(amountCents)} a month is ${
        extraCents > 0
          ? `${fmt(extraCents)} more`
          : extraCents < 0
            ? `${fmt(-extraCents)} less`
            : "the same"
      } each month.`,
    );
  } else {
    lines.push(
      `If you spend ${fmt(amountCents)} more each month${what ? ` on ${what}` : ""}${from}:`,
    );
  }
  if (context?.budgetCents != null) {
    const diff = amountCents - context.budgetCents;
    lines.push(
      `Your ${context.category} budget is ${fmt(context.budgetCents)} a month${diff > 0 ? `, ${fmt(diff)} less than this` : diff < 0 ? `, ${fmt(-diff)} more than this` : ", the same as this"}.`,
    );
  }
  const actions: MessageAction[] = [];
  if (extraCents === 0) {
    lines.push("That's what you spend now, so nothing changes.");
  } else {
    if (context && context.usualMonthCents > 0) {
      lines.push(`If that ${extraCents > 0 ? "extra goes out" : "stays in"} every month${from}:`);
    }
    lines.push(
      ...effectLines(
        affordCheck(numbers, { kind: "monthly", amountCents: extraCents, startMonth: month }),
      ),
    );
    const kind = extraCents > 0 ? "more" : "less";
    const amount = (Math.abs(extraCents) / 100).toFixed(2);
    actions.push(
      link("See the full check", `/afford?kind=${kind}&amount=${amount}&month=${month}`),
    );
  }
  lines.push("This is math, not a recommendation.");
  return reply(lines.join("\n"), actions);
}

const merchantOf = (t: InsightTransaction) =>
  t.merchantName ?? normalizeMerchant(t.description)?.name ?? t.description;

// "How much did I spend on food last month?" from the same totals as /insights. A word
// that isn't a category is tried as a merchant ("at Target").
export function spendingReply(
  intent: Extract<Intent, { kind: "spending" }>,
  transactions: InsightTransaction[],
  asOf: string,
): Reply {
  const open = [link("See insights", "/insights")];
  const months = monthsEnding(asOf, INSIGHT_MONTHS);
  if (!months.includes(intent.month)) {
    return reply(`I can only see the last ${INSIGHT_MONTHS} months of spending.`, open);
  }
  const current = intent.month === monthOf(asOf);
  const when = `in ${monthLabel(intent.month)}${current ? " so far" : ""}`;
  const insights = spendingInsights(transactions, { asOf, monthCount: INSIGHT_MONTHS });
  const totals = insights.months.find((m) => m.month === intent.month)!;
  const categories = insights.categoriesByMonth[intent.month] ?? [];
  const top = categories
    .slice(0, CHAT_TOP_CATEGORIES)
    .map((c) => `${c.category} ${fmt(c.cents)}`)
    .join(", ");

  if (!intent.category) {
    return reply(
      `You spent ${fmt(totals.spendingCents)} ${when}.${top ? ` The most went to: ${top}.` : ""}`,
      open,
    );
  }
  const q = intent.category.toLowerCase();
  const spentAt = (match: (name: string) => boolean) =>
    transactions.filter(
      (t) =>
        t.date.startsWith(intent.month) &&
        kindOf(t) === "spending" &&
        match(merchantOf(t).toLowerCase()),
    );
  const atMerchant = (matching: InsightTransaction[]) =>
    reply(
      `You spent ${fmt(matching.reduce((sum, t) => sum + t.amountCents, 0))} at ${merchantOf(matching[0])} ${when}.`,
      open,
    );
  // Spec step 88: a merchant named word for word ("Uber") before the category it's in.
  const byName = spentAt((name) => name.split(/[^a-z0-9&+']+/).includes(q));
  if (byName.length > 0) return atMerchant(byName);
  const labels = [...new Set([...Object.values(CATEGORY_LABELS), UNCATEGORIZED])];
  const category = matchCategory(intent.category, labels);
  if (category) {
    const cents = categories.find((c) => c.category === category)?.cents ?? 0;
    return reply(`You spent ${fmt(cents)} on ${category} ${when}.`, open);
  }
  const matching = spentAt((name) => name.includes(q));
  if (matching.length > 0) return atMerchant(matching);
  return reply(
    `I couldn't find spending on "${intent.category}" ${when}.${top ? ` The most went to: ${top}.` : ""}`,
    open,
  );
}

// "What's due?": the coming-up list from Today, bills and deadlines together.
export function comingUpReply(
  intent: Extract<Intent, { kind: "coming_up" }>,
  rows: ComingUpRow[],
): Reply {
  const shown = intent.days === null ? rows : rows.filter((r) => r.daysLeft <= intent.days!);
  const open = [link("See bills", "/bills")];
  const span = intent.days === null ? "coming up" : "due this week";
  if (shown.length === 0) return reply(`Nothing ${span} that I can see.`, open);
  const lines = shown.map(
    (r) =>
      `- ${shortDate(r.date)} (${inDays(r.daysLeft)}): ${r.label}${r.amountCents !== null ? `, ${fmt(r.amountCents)}` : ""}`,
  );
  return reply(`Here's what's ${span}:\n${lines.join("\n")}`, open);
}

// "Safe to spend": the number on Today.
// "Hi": hello, safe to spend, and something to ask. "Thanks": you're welcome.
export function greetingReply(
  thanks: boolean,
  safe: { safeCents: number; payday: string | null } | null,
): Reply {
  if (thanks) return reply("You're welcome! I'm here whenever you need me.");
  const money = safe
    ? ` You have ${fmt(safe.safeCents)} safe to spend${safe.payday ? ` until ${shortDate(safe.payday)}` : ""}.`
    : "";
  return reply(
    `Hi!${money} Ask me anything about your money, like "${EXAMPLES[0]}".`,
    safe ? [link("See today", "/home")] : [],
  );
}

export function safeReply(safe: { safeCents: number; payday: string | null } | null): Reply {
  if (!safe) {
    return reply(AFFORD_COPY.noChecking, [link("Link a bank", "/connect")]);
  }
  return reply(
    `You have ${fmt(safe.safeCents)} safe to spend${safe.payday ? ` until ${shortDate(safe.payday)}, your next payday` : ""}. That's after upcoming bills, what's left in your budgets and what goes to your goals.`,
    [link("See today", "/home")],
  );
}

// Which kinds of finding each command is about, first choice first.
const VERB_TYPES: Record<ActVerb, readonly FindingType[]> = {
  cancel: ["subscription_review", "duplicate_subscription", "trial_conversion", "price_increase"],
  lower: ["bill_negotiation", "insurance_reshop", "bank_fees", "card_interest", "price_increase"],
  refund: ["duplicate_charge", "charge_after_cancel", "bank_fees", "trial_conversion"],
};
// Words a finding of each type is about, besides its title.
const TYPE_WORDS: Partial<Record<FindingType, string>> = {
  bill_negotiation: "bill",
  insurance_reshop: "insurance",
  bank_fees: "bank fees fee",
  card_interest: "card interest rate apr",
  idle_cash: "savings cash",
  subscription_review: "subscription",
  duplicate_subscription: "subscription",
  duplicate_charge: "charge refund",
  charge_after_cancel: "charge refund",
};

// The open findings the person could mean: every word they typed is in the title (or its
// kind, or an everyday word for it: src/lib/jane-agent/names.ts), the kinds that fit the
// command first, then the biggest saving. rank says how well the kind fits: two with the
// same rank could both be meant.
export function rankFindings(
  findings: readonly SnapshotFinding[],
  verb: ActVerb | null,
  target: string,
): { finding: SnapshotFinding; rank: number }[] {
  const types = verb ? VERB_TYPES[verb] : [];
  const rank = (f: SnapshotFinding) => {
    const index = types.indexOf(f.type);
    return index === -1 ? types.length : index;
  };
  return findings
    .filter((f) => nameMatches(target, `${f.title} ${TYPE_WORDS[f.type] ?? ""}`))
    .map((finding) => ({ finding, rank: rank(finding) }))
    .sort(
      (a, b) =>
        a.rank - b.rank ||
        (b.finding.annualSavingsCents ?? -1) - (a.finding.annualSavingsCents ?? -1),
    );
}

export function matchFinding(
  findings: readonly SnapshotFinding[],
  verb: ActVerb,
  target: string,
): SnapshotFinding | null {
  return rankFindings(findings, verb, target)[0]?.finding ?? null;
}

// One finding as a decision, with the same words and buttons (Yes, Jane's pick, No, Open)
// as its message from Jane's brain.
export function findingReply(snapshot: Snapshot, finding: SnapshotFinding, now: Date): Reply {
  const [candidate] = findingsSource.gather(
    { ...snapshot, findings: [finding] },
    { now, local: localTime(now, snapshot.timezone), trigger: "open" },
  );
  return reply(candidate.body, candidate.actions, {
    ...candidate.refs,
    topic: { kind: "act", target: finding.title, findingId: finding.findingId },
  });
}

// A button's label: short enough for a phone.
const CHOICE_LABEL_MAX = 40;
export const choiceLabel = (text: string) =>
  text.length <= CHOICE_LABEL_MAX ? text : `${text.slice(0, CHOICE_LABEL_MAX - 1).trimEnd()}…`;

// Spec step 88: when a message could mean more than one thing, a question with a button
// per meaning; the tap answers that meaning (src/lib/jane-agent/actions/clarify.ts).
export function clarifyReply(
  question: string,
  choices: { label: string; intent: Intent }[],
  links: MessageAction[] = [],
): Reply {
  const shown = choices.slice(0, CHAT_CLARIFY_CHOICES);
  return reply(
    question,
    [
      ...shown.map((c, i): MessageAction => ({
        id: `clarify.${i + 1}` as MessageAction["id"] & `clarify.${number}`,
        label: choiceLabel(c.label),
        kind: "secondary",
      })),
      ...links,
    ],
    { choices: shown.map((c) => ({ ...c, label: choiceLabel(c.label) })) },
  );
}

const findingChoices = (verb: ActVerb, findings: readonly SnapshotFinding[]) =>
  findings.map((f) => ({
    label: f.title,
    intent: { kind: "act" as const, verb, target: f.title, findingId: f.findingId },
  }));

// "Cancel Hulu": the matching open finding as a decision, with the same Yes and No (and
// Jane's pick) as its message from Jane's brain. Nothing happens until a tap. With no name,
// or two that fit as well as each other, Jane asks which.
export function actReply(
  intent: Extract<Intent, { kind: "act" }>,
  snapshot: Snapshot | null,
  now: Date,
): Reply {
  const subscriptions = link("Open subscriptions", "/subscriptions");
  const exact = intent.findingId
    ? snapshot?.findings.find((f) => f.findingId === intent.findingId)
    : undefined;
  if (snapshot && exact) return findingReply(snapshot, exact, now);
  if (!intent.target) {
    const fitting = (snapshot?.findings ?? [])
      .filter((f) => VERB_TYPES[intent.verb].includes(f.type))
      .sort((a, b) => (b.annualSavingsCents ?? -1) - (a.annualSavingsCents ?? -1));
    if (fitting.length === 1 && snapshot) return findingReply(snapshot, fitting[0], now);
    if (fitting.length > 1) {
      return clarifyReply(
        `Which one should I ${intent.verb === "refund" ? "claim" : intent.verb}?`,
        findingChoices(intent.verb, fitting),
        [subscriptions],
      );
    }
    return reply(
      `There's nothing open for me to ${intent.verb === "refund" ? "claim" : intent.verb} right now.`,
      [subscriptions],
    );
  }
  const ranked = snapshot ? rankFindings(snapshot.findings, intent.verb, intent.target) : [];
  if (!snapshot || ranked.length === 0) {
    return reply(
      `I don't see anything open about "${intent.target}" right now, so there's nothing for me to ${intent.verb === "refund" ? "claim" : intent.verb} yet.`,
      [subscriptions],
    );
  }
  const tied = ranked.filter((r) => r.rank === ranked[0].rank);
  if (tied.length > 1) {
    return clarifyReply(
      `I found ${tied.length} things about "${intent.target}". Which one do you mean?`,
      findingChoices(
        intent.verb,
        tied.map((t) => t.finding),
      ),
    );
  }
  return findingReply(snapshot, ranked[0].finding, now);
}

// "What did you do?": what the action agent did this week (src/lib/what-jane-did.ts).
export function whatDidReply(did: JaneDid): Reply {
  const open = [link("See every step", "/actions")];
  const lines: string[] = [];
  if (did.finished.length > 0) {
    lines.push(
      `This week I finished ${things(did.finished.length)}${did.confirmedCents > 0 ? `, with ${fmt(did.confirmedCents)} confirmed back or saved` : ""}: ${did.finished.map((f) => `"${f.title}"`).join(", ")}.`,
    );
  }
  if (did.working > 0) lines.push(`I'm working on ${things(did.working)}.`);
  if (did.contacts > 0) {
    lines.push(
      `I wrote or called companies ${did.contacts} ${did.contacts === 1 ? "time" : "times"}.`,
    );
  }
  if (did.waiting.length > 0) {
    const first = did.waiting[0];
    lines.push(
      `${things(did.waiting.length)} ${did.waiting.length === 1 ? "waits" : "wait"} on you. First: "${first.title}": ${first.todo}`,
    );
  }
  if (lines.length === 0) {
    return reply("Nothing new this week. When I start on something, I'll tell you here.", open);
  }
  return reply(lines.join("\n"), open);
}

// "Yes to all": offers the plan's "Approve all safe ones", never approves by itself.
export function approveAllReply(snapshot: Snapshot | null): Reply {
  const plan = link("Review the plan", "/plan");
  const safe = snapshot?.plan.safeItems ?? 0;
  if (safe === 0) {
    return reply(
      "Nothing on your plan is safe to approve in one go right now. Cancellations, calls, insurance and moving money always need their own yes.",
      [plan],
    );
  }
  return reply(
    `${things(safe)} on your plan ${safe === 1 ? "is" : "are"} safe to approve together: requests that only bring money back. Cancellations, calls, insurance and moving money aren't included. Approve them?`,
    [{ id: "plan.approve_safe", label: "Approve all safe ones", kind: "primary" }, plan],
  );
}

// "Undo": the newest yes a standing rule gave that can still be taken back, as a button.
export function undoReply(snapshot: Snapshot | null, now: Date): Reply {
  const latest = (snapshot?.ruleApprovals ?? [])
    .map((a) => ({
      ...a,
      undoUntil: new Date(a.createdAt.getTime() + RULE_UNDO_HOURS * 60 * 60 * 1000),
    }))
    .filter((a) => a.canUndo && a.undoUntil > now)
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0];
  if (!latest) {
    return reply(
      "There's nothing I can undo from here right now. To take back a No, tap Undo on its message; anything else you said yes to is on your plan.",
      [link("Open the plan", "/plan")],
    );
  }
  return reply(
    `Undo my yes to "${latest.title}"? It goes back on your plan.`,
    [{ id: "undo.rule", label: "Undo it", kind: "primary" }, link("Open the plan", "/plan")],
    { decisionId: latest.decisionId, undoUntil: latest.undoUntil.toISOString() },
  );
}

// "Pause autopilot": offers the switch to "Ask me first".
export function pauseReply(level: string | null): Reply {
  const settings = link("Autopilot settings", "/settings#autopilot");
  if (!level || level === "ask") {
    return reply("Autopilot is already off: I ask you before doing anything.", [settings]);
  }
  return reply(
    "Pause autopilot? From then on I'll ask you before doing anything. Work already started carries on.",
    [{ id: "autopilot.pause", label: "Pause autopilot", kind: "primary" }, settings],
  );
}
