import { sinceStatementNote, type SinceStatement } from "@/planning/since-statement";
import { payDueSentence, type PayDue } from "@/planning/pay-due";
import { BACK_OR_AGREED } from "@/lib/saved-amount";
import {
  AFFORD_GOAL_MONTHS,
  AFFORD_USUAL_MONTHS,
  CHAT_TOP_CATEGORIES,
  CHAT_WEEK_DAYS,
  WEEKS_PER_MONTH,
} from "@/config/agent-chat";
import { INSIGHT_MONTHS } from "@/config/insights";
import { MAX_AFFORD_CENTS } from "@/config/afford";
import { RULE_UNDO_HOURS } from "@/config/rules";
import { TOO_LITTLE_HISTORY } from "@/config/areas";
import { normalizeMerchant } from "@/data-sources/merchant";
import type { FindingType } from "@/generated/prisma/client";
import type { ComingUpRow } from "@/insights/coming-up";
import { CATEGORY_LABELS, UNCATEGORIZED, categoryLabel } from "@/insights/labels";
import { matchSubcategory, primaryOf, subcategorySpending } from "@/insights/subcategories";
import { fullMonths } from "@/insights/typical-month";
import {
  kindOf,
  monthsEnding,
  spendingInsights,
  type InsightTransaction,
} from "@/insights/spending";
import { centsToInput, formatCents } from "@/lib/money";
import type { JaneDid } from "@/lib/what-jane-did";
import {
  AFFORD_COPY,
  monthlyNeededLine,
  reachedByLine,
  safeLine,
  shortLine,
} from "@/planning/afford-copy";
import { budgetSummary, type Budget } from "@/insights/budgets";
import {
  affordCheck,
  affordWindow,
  monthOf,
  type AffordNumbers,
  type AffordResult,
} from "@/planning/afford";
import { CHAT_CLARIFY_CHOICES } from "@/config/agent-chat";
import { matchCategory, type ActVerb, type Intent, type ShortPeriod } from "./intents";
import { nameMatches } from "./names";
import type { Snapshot, SnapshotFinding } from "./snapshot";
import { findingCandidate } from "./sources/findings";
import { dateAndDays, inDays, snoozeButton, things } from "./sources/source";
import type { PreferenceDraft } from "./preferences";
import { type MessageAction, type MessageRefs, openLink } from "./types";
import { addDays, shiftMonth } from "@/lib/dates";
import { dayLabel } from "@/lib/day-label";
import { daysBetween } from "@/detection/units";
import { endedOn, monthCutShortAt } from "@/lib/data-ended";

// Jane's answers to what the person typed (spec step 84), from the same loaders as the
// pages. Pure: each takes the numbers and returns fixed wording in Jane's voice, with the
// buttons to tap. Typing never acts on its own: anything that changes something is a
// button from the registry (src/lib/jane-agent/actions), checked again when it's tapped.

export type Reply = { body: string; actions: MessageAction[]; refs: MessageRefs };

// A spending question whose words are no category or merchant: not an answer (./backup.ts).
export const SPENDING_NOT_FOUND = "I couldn't find spending on";

const reply = (body: string, actions: MessageAction[] = [], refs: MessageRefs = {}): Reply => ({
  body,
  actions,
  refs,
});
const fmt = (cents: number) => (cents < 0 ? `−${formatCents(-cents)}` : formatCents(cents));

const utc = (iso: string, options: Intl.DateTimeFormatOptions) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-US", { ...options, timeZone: "UTC" });
// "March 2027".
export const monthLabel = (month: string) => utc(`${month}-01`, { month: "long", year: "numeric" });
const longDate = (iso: string) => utc(iso, { month: "short", day: "numeric", year: "numeric" });

const EXAMPLES = [
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
    `I answer questions about your money with your own numbers, and do what I find for you when you tap. Try:\n${exampleList()}\nI never act on what you type alone.`,
  );
}

// Spec step 89: no dead ends. What Jane can answer right now, the closest to what was asked
// first (by its words), as buttons that answer it.
const NEARBY: readonly { label: string; words: RegExp; intent: (asOf: string) => Intent }[] = [
  {
    label: "Safe to spend",
    words: /\b(?:spend|money|left|afford|cash|broke|enough)\b/,
    intent: () => ({ kind: "safe_to_spend" }),
  },
  {
    label: "What's due this week",
    words: /\b(?:bills?|due|owe|payments?|rent|upcoming|soon)\b/,
    intent: () => ({ kind: "coming_up", days: CHAT_WEEK_DAYS }),
  },
  {
    label: "My subscriptions",
    words: /\b(?:subscriptions?|cancel|streaming|monthly|charges?|netflix|hulu|spotify)\b/,
    intent: () => ({ kind: "subscriptions", total: false, all: false }),
  },
  {
    label: "Where my money went",
    words: /\b(?:spent|spending|categor(?:y|ies)|food|shopping|went|go)\b/,
    intent: (asOf) => ({ kind: "spending", category: null, month: asOf.slice(0, 7) }),
  },
  {
    label: "My next payday",
    words: /\b(?:paid|paycheck|payday|salary|income|wages)\b/,
    intent: () => ({ kind: "payday" }),
  },
  {
    label: "What you did for me",
    words: /\b(?:did|doing|done|working|plan|jane)\b/,
    intent: () => ({ kind: "what_did" }),
  },
];

function nearbyChoices(text: string, asOf: string): { label: string; intent: Intent }[] {
  const lower = text.toLowerCase();
  return [...NEARBY]
    .map((n, index) => ({ n, index, hit: n.words.test(lower) ? 0 : 1 }))
    .sort((a, b) => a.hit - b.hit || a.index - b.index)
    .slice(0, CHAT_CLARIFY_CHOICES)
    .map(({ n }) => ({ label: n.label, intent: n.intent(asOf) }));
}

// What Jane says when it can't answer: always the same words, so the answer checks know
// it (src/lib/jane-agent/checks), with the closest things it can answer as buttons.
const UNKNOWN_TEXT =
  "I can't answer that one yet. Tap one of these and I'll answer it now, with your numbers.";

// Spec step 91: something the person told Jane, offered to remember. Nothing is saved
// until they tap "Remember this".
export function rememberReply(draft: PreferenceDraft): Reply {
  const what = draft.label.charAt(0).toLowerCase() + draft.label.slice(1);
  return reply(
    `I can remember that: ${what}. I'll use it in my answers and suggestions from now on, and you can delete it in Settings anytime.`,
    [{ id: "pref.save", label: "Remember this", kind: "primary" }],
    { preference: draft },
  );
}

// Anything the rules don't understand, when there's no Claude key (or Claude can't answer).
export function unknownReply(text = "", asOf = new Date().toISOString().slice(0, 10)): Reply {
  return clarifyReply(UNKNOWN_TEXT, nearbyChoices(text, asOf));
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
  // Only the months the statements cover in full: a month with no data is not a month of $0.00.
  const past = fullMonths(months.slice(0, -1), transactions);
  return {
    category,
    month,
    spentCents: spentIn(month),
    usualMonthCents:
      past.length === 0
        ? 0
        : Math.round(past.reduce((sum, m) => sum + spentIn(m), 0) / past.length),
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

// Spec step 89: the answer to "can I afford it?" first, in one sentence: from safe to spend,
// or for later on, from checking month by month. Math, not a recommendation.
function affordVerdict(result: AffordResult, what: string, asOf: string): string | null {
  const { safe, firstShort } = result;
  if (!safe) return null;
  if (safe.beforeCents !== safe.afterCents) {
    const until = safe.payday ? ` until ${dateAndDays(safe.payday, asOf)}` : "";
    return safe.afterCents >= 0
      ? `Yes: after ${what}, you'd still have ${fmt(safe.afterCents)} safe to spend${until}.`
      : `Not without dipping into your bills: ${what} would leave you ${fmt(-safe.afterCents)} short${until}.`;
  }
  if (firstShort?.after && firstShort.after !== firstShort.before) {
    return `It would be tight: with ${what}, checking would go below zero in ${monthLabel(firstShort.after)}.`;
  }
  // A month already short that this makes shorter is not "fits".
  const deeper = result.months?.find((m) => m.afterCents < 0 && m.afterCents < m.beforeCents);
  if (deeper) {
    return `It would make checking worse than it already is: with ${what}, ${monthLabel(deeper.month)} would end ${fmt(-deeper.afterCents)} below zero${deeper.beforeCents < 0 ? `, up from ${fmt(-deeper.beforeCents)}` : ""}.`;
  }
  return `Yes: ${what} fits${firstShort?.before ? "" : ", and checking stays above zero every month"}.`;
}

// Safe to spend, goals and checking, before and after, as on /afford. The safe-to-spend line
// is left out when the verdict already said it.
function effectLines(result: AffordResult, verdictSaidSafe = false): string[] {
  const lines: string[] = [];
  if (!result.safe) {
    lines.push(AFFORD_COPY.noChecking);
  } else if (verdictSaidSafe && result.safe.beforeCents !== result.safe.afterCents) {
    // Already in the first sentence.
  } else if (result.safe.beforeCents === result.safe.afterCents) {
    lines.push(
      `Safe to spend stays ${fmt(result.safe.beforeCents)}${result.safe.payday ? ` until ${dayLabel(result.safe.payday)}` : ""}, since this comes after your next payday.`,
    );
  } else {
    lines.push(
      safeLine(
        result.safe.payday ? dayLabel(result.safe.payday) : null,
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

// Spec step 90: "Set a budget", prefilled with a usual month there, rounded up to dollars.
export function budgetSuggestion(category: string, usualMonthCents: number) {
  return { budget: { category, amountCents: Math.ceil(usualMonthCents / 100) * 100 } };
}
export const budgetButton = (budget: { category: string; amountCents: number }): MessageAction => ({
  id: "budget.set",
  label: `Set a ${fmt(budget.amountCents)} budget`,
  kind: "primary",
});

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
  const what = `${fmt(intent.amountCents)}${intent.what ? ` on ${intent.what}` : ""}${when}`;
  const verdict = affordVerdict(result, what, asOf);
  // A straight answer: the verdict, the one fact that matters most after it, and then either
  // the goal on offer (when it doesn't fit) or the reminder that this is math.
  const effects = [...effectLines(result, verdict !== null)];
  // Spending so far and the budget are about this month; a later month only gets the goal.
  const about = context && !later ? categoryLines(context, intent.amountCents, intent.period) : [];
  // A budget the purchase would break (or fit) decides; then what they usually spend there;
  // then what it does to goals and checking.
  const second =
    about.find((l) => /budget is /.test(l)) ??
    about.find((l) => /usually spend/.test(l)) ??
    effects[0] ??
    about[0];
  const lines = verdict
    ? [verdict, ...(second ? [second] : [])]
    : [...effects, ...about].slice(0, 2);

  const amount = centsToInput(intent.amountCents);
  const actions: MessageAction[] = [];
  const refs: MessageRefs = {};
  // Spec step 90: one suggestion, with its button. Later on, or when it doesn't fit before
  // payday, a goal to save for it; otherwise a budget for the category when there's none.
  const short = !later && result.safe !== null && result.safe.afterCents < 0;
  if (later || short) {
    const goalMonth = later ? month : shiftMonth(current, AFFORD_GOAL_MONTHS);
    const name = intent.what
      ? intent.what.replace(/^(?:a|an|the|my|our|some) /, "")
      : `Purchase in ${monthLabel(goalMonth)}`;
    refs.goal = {
      name: name.charAt(0).toUpperCase() + name.slice(1),
      targetCents: intent.amountCents,
      targetDate: `${goalMonth}-01`,
    };
    actions.push({ id: "goal.start", label: "Start a goal for it", kind: "primary" });
    if (short) lines.push(`I can set up a goal to save for it by ${monthLabel(goalMonth)}.`);
    else lines.push("This is math, not a recommendation.");
  } else if (context && context.budgetCents === null && context.usualMonthCents > 0) {
    Object.assign(refs, budgetSuggestion(context.category, context.usualMonthCents));
    actions.push(budgetButton(refs.budget!));
    lines.push("This is math, not a recommendation.");
  } else {
    lines.push("This is math, not a recommendation.");
  }
  actions.push(
    openLink("See the full check", `/afford?kind=purchase&amount=${amount}&date=${date}`),
  );
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
  }
  if (context?.budgetCents != null) {
    const diff = amountCents - context.budgetCents;
    lines.push(
      `Your ${context.category} budget is ${fmt(context.budgetCents)} a month${diff > 0 ? `, ${fmt(diff)} less than this` : diff < 0 ? `, ${fmt(-diff)} more than this` : ", the same as this"}.`,
    );
  }
  const actions: MessageAction[] = [];
  if (extraCents === 0) {
    lines.unshift("Yes: that's what you spend now, so nothing changes.");
  } else {
    const result = affordCheck(numbers, {
      kind: "monthly",
      amountCents: extraCents,
      startMonth: month,
    });
    const verdict = affordVerdict(
      result,
      `${fmt(Math.abs(extraCents))} ${extraCents > 0 ? "more" : "less"} going out each month${!context && what ? ` on ${what}` : ""}${from}`,
      numbers.asOf,
    );
    if (verdict) lines.unshift(verdict);
    lines.push(...effectLines(result, verdict !== null));
    const kind = extraCents > 0 ? "more" : "less";
    const amount = centsToInput(Math.abs(extraCents));
    actions.push(
      openLink("See the full check", `/afford?kind=${kind}&amount=${amount}&month=${month}`),
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
  // Spec step 90: given, a category with no budget gets "Set a budget".
  budgets: readonly Budget[] | null = null,
  // drawn: the month's categories go under the answer as bars (spec step 94), so the words don't
  // name the biggest again (debug 2, 11-16: three categories said, then the same three drawn).
  // declined: categories whose budget the person turned down on the plan or in the dock, never
  // offered again here (debug 2, 11-16: No on "$160.00 monthly budget for Food and drink", then
  // "A $160.00 budget would match a usual month" with the button, a minute later).
  { drawn = false, declined = [] }: { drawn?: boolean; declined?: readonly string[] } = {},
): Reply {
  const open = [openLink("See insights", "/insights")];
  // Nothing to read isn't nothing spent.
  if (transactions.length === 0) {
    return reply(
      "I can't see your spending yet. Upload your bank statements or link a bank, and I'll show you where it goes.",
      [openLink("Add your accounts", "/connect")],
    );
  }
  // A day or a week asked for is read by its days, never as the month.
  if (intent.shortPeriod) {
    return reply(shortPeriodLine(intent.shortPeriod, intent.category, transactions, asOf), open);
  }
  if (intent.perMonth && intent.category && !intent.shortPeriod) {
    const usual = usualMonthLine(intent.category, transactions, asOf);
    if (usual) return reply(usual, open);
  }
  if (intent.sinceStart && intent.category) {
    const since = sinceStartLine(intent.category, transactions, asOf);
    if (since) return reply(since, open);
  }
  const months = monthsEnding(asOf, INSIGHT_MONTHS);
  if (!months.includes(intent.month)) {
    return reply(`I can only see the last ${INSIGHT_MONTHS} months of spending.`, open);
  }
  // A month before the first transaction isn't a month of $0.00.
  const firstMonth = transactions.reduce(
    (first, t) => (t.date.slice(0, 7) < first ? t.date.slice(0, 7) : first),
    transactions[0].date.slice(0, 7),
  );
  if (intent.month < firstMonth) {
    return reply(
      `I can't see ${monthLabel(intent.month)}: what I have starts in ${monthLabel(firstMonth)}.`,
      open,
    );
  }
  // Nor is one after it ends: someone who uploaded a statement and came back.
  const lastDate = transactions.reduce(
    (last, t) => (t.date > last ? t.date : last),
    transactions[0].date,
  );
  const ended = endedOn(lastDate, asOf);
  if (ended && intent.month > ended.slice(0, 7)) {
    return reply(
      `I can't see ${monthLabel(intent.month)}: what I have ends on ${dayLabel(ended)}.`,
      open,
    );
  }
  const current = intent.month === monthOf(asOf);
  // Nor is this month before anything from it has come in (gate E, 11-16): with only an October
  // statement uploaded, "You spent $0.00 on Food and drink in November so far" read as nothing
  // spent. The month the data does have answers instead.
  if (current && intent.month > lastDate.slice(0, 7)) {
    const had = spendingReply(
      { ...intent, month: lastDate.slice(0, 7) },
      transactions,
      asOf,
      budgets,
    );
    return {
      ...had,
      body: `I don't see anything from ${monthLabel(intent.month)} yet: what I have ends on ${dayLabel(lastDate)}. ${had.body}`,
    };
  }
  // A month the data starts partway through says from when (debug 2, 11-16: "You spent $114.87 on
  // Food and drink in October 2026" over Oct 17 to 31 only).
  const firstDate = transactions.reduce((first, t) => (t.date < first ? t.date : first), lastDate);
  const partway =
    intent.month === firstMonth && fullMonths([intent.month], transactions).length === 0;
  // And one it ends partway through, to when, never against a whole month (debug 2, 11-16: an old
  // statement to Oct 20 read "You spent $1,235.64 in October 2026. That's $87.67 less than in
  // September").
  // With a week's slack at the end (monthCutShortAt): a statement to the 28th is the month.
  const cutShort = !current && monthCutShortAt(intent.month, ended) !== null;
  const span =
    partway && cutShort
      ? ` (${dayLabel(firstDate)} to ${dayLabel(ended!)}, all I have of it)`
      : partway
        ? ` (from ${dayLabel(firstDate)}, where what I have starts)`
        : cutShort
          ? ` (to ${dayLabel(ended!)}, where what I have ends)`
          : "";
  const when = `in ${monthLabel(intent.month)}${current ? " so far" : ""}${span}`;
  const insights = spendingInsights(transactions, { asOf, monthCount: INSIGHT_MONTHS });
  const totals = insights.months.find((m) => m.month === intent.month)!;
  const categories = insights.categoriesByMonth[intent.month] ?? [];
  const top = categories
    .slice(0, CHAT_TOP_CATEGORIES)
    .map((c) => `${c.category} ${fmt(c.cents)}`)
    .join(", ");

  // Spec step 89: the answer, then the reason: the month before, for comparison.
  const before = months[months.indexOf(intent.month) - 1];
  const versus = (now: number, then: number | undefined) => {
    // Nothing to compare with (no spending then, or the same), nor a month the data starts
    // halfway through (debug 2, 11-16: "In all of October it was $292.31" from Oct 17 on).
    if (
      !before ||
      !then ||
      then === now ||
      cutShort ||
      fullMonths([before], transactions).length === 0
    )
      return "";
    const diff = now - then;
    const month = monthLabel(before).split(" ")[0];
    return current
      ? ` In all of ${month} it was ${fmt(then)}.`
      : ` That's ${fmt(Math.abs(diff))} ${diff > 0 ? "more" : "less"} than in ${month}.`;
  };
  const spentIn = (month: string | undefined, category: string) =>
    month === undefined
      ? undefined
      : (insights.categoriesByMonth[month]?.find((c) => c.category === category)?.cents ?? 0);
  if (!intent.category) {
    const previous = insights.months.find((m) => m.month === before)?.spendingCents;
    return reply(
      `You spent ${fmt(totals.spendingCents)} ${when}.${versus(totals.spendingCents, previous)}${top && !drawn ? ` The most went to: ${top}.` : ""}`,
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
  const sub = matchSubcategory(intent.category);
  const labels = [...new Set([...Object.values(CATEGORY_LABELS), UNCATEGORIZED])];
  const category = matchCategory(intent.category, labels);
  // Spec step 88: a merchant named word for word ("Uber") before the category it's in. A word
  // that names a category is the category, unless it's the merchant's whole name (debugger 11-16:
  // "how much did I spend on food" answered "$40.00 at Food S", a school lunch account).
  const byName = spentAt((name) =>
    sub || category ? name === q : name.split(/[^a-z0-9&+']+/).includes(q),
  );
  if (byName.length > 0) return atMerchant(byName);
  // A part of a category by its own name ("groceries", "gas", "rent"), with the whole beside it,
  // when the data says which part each charge is.
  const subCents = sub && subcategorySpending(transactions, intent.month, sub);
  if (sub && subCents !== null) {
    const label = categoryLabel(primaryOf(sub));
    const whole = categories.find((c) => c.category === label)?.cents ?? 0;
    const then = before === undefined ? undefined : subcategorySpending(transactions, before, sub);
    return reply(
      // The whole only when it's more than the part (debug 2, 11-16: "$147.36 on gas … of $147.36
      // on Transportation in all").
      `You spent ${fmt(subCents)} on ${sub.name} ${when}${whole > subCents ? `, of ${fmt(whole)} on ${label} in all` : ""}.${versus(subCents, then ?? undefined)}`,
      open,
    );
  }
  if (category) {
    const cents = categories.find((c) => c.category === category)?.cents ?? 0;
    const body = `You spent ${fmt(cents)} on ${category} ${when}.${versus(cents, spentIn(before, category))}`;
    // A usual month: the Budgets page's own suggestion for the category (the complete months the
    // data covers in full, one-offs aside, rounded up), so the chat and the dock offer one figure
    // (debug 2, 11-15: "A $239.00 budget would match a usual month" beside the dock's "$240.00
    // monthly budget for Food and drink").
    const usual = budgets
      ? (budgetSummary(transactions, [...budgets], asOf).suggestions[category] ?? 0)
      : 0;
    if (
      budgets &&
      !budgets.some((b) => b.category === category) &&
      !declined.includes(category) &&
      usual > 0
    ) {
      const refs = { budget: { category, amountCents: usual } };
      return reply(
        `${body} A ${fmt(refs.budget.amountCents)} budget would match a usual month.`,
        [budgetButton(refs.budget), ...open],
        refs,
      );
    }
    return reply(body, open);
  }
  const matching = spentAt((name) => name.includes(q));
  if (matching.length > 0) return atMerchant(matching);
  // Nothing there this month isn't nothing there at all (debugger 11-17: "how much is Hulu right
  // now?" read as not found, with Hulu $9.99 on Oct 20): when and how much it was last.
  const last = transactions
    .filter(
      (t) =>
        t.date < intent.month &&
        kindOf(t) === "spending" &&
        t.amountCents > 0 &&
        merchantOf(t).toLowerCase().includes(q),
    )
    .reduce<InsightTransaction | null>(
      (latest, t) => (!latest || t.date > latest.date ? t : latest),
      null,
    );
  if (last) {
    return reply(
      `Nothing at ${merchantOf(last)} ${when}. The last was ${fmt(last.amountCents)} on ${dayLabel(last.date)}.`,
      open,
    );
  }
  return reply(
    `${SPENDING_NOT_FOUND} "${intent.category}" ${when}.${top ? ` The most went to: ${top}.` : ""}`,
    open,
  );
}

// "How much do I spend on Amazon a month?": a usual month, the full months the data covers on
// average, at the merchant named, on the part or in the category (debugger 11-17: "amazon a month" was looked
// up as a name). Null when there's no full month, or nothing by that name.
function usualMonthLine(
  target: string,
  transactions: InsightTransaction[],
  asOf: string,
): string | null {
  const last = transactions.reduce((max, t) => (t.date > max ? t.date : max), "");
  const full = fullMonths(
    monthsEnding(asOf, INSIGHT_MONTHS).filter((m) => m < monthOf(asOf) && m < last.slice(0, 7)),
    transactions,
  );
  // No full month yet (one statement of 31 days, Oct 15 to Nov 14): what the days on file hold,
  // said as that, not as a month (debugger 11-17: "November so far" read as a usual month).
  const first = transactions.reduce((min, t) => (t.date < min ? t.date : min), last);
  const counted =
    full.length > 0 ? full : [...new Set(transactions.map((t) => t.date.slice(0, 7)))].sort();
  const spent = spentIn(target, transactions, counted, asOf);
  if (!spent) return null;
  const { cents, where } = spent;
  if (full.length === 0) {
    return `I don't have a full month yet, just ${daysBetween(first, last) + 1} days (${dayLabel(first)} to ${dayLabel(last)}): you spent ${fmt(cents)} ${where} in that time.`;
  }
  // With the year when the months cross one (debug 2, 11-17: 14 months read "from December to
  // October", meaning December 2025 to October 2026).
  const years = new Set(full.map((m) => m.slice(0, 4))).size > 1;
  const names = full.map((m) => (years ? monthLabel(m) : monthLabel(m).split(" ")[0]));
  const from =
    names.length <= 2 ? names.join(" and ") : `${names[0]} to ${names[names.length - 1]}`;
  return `You spend about ${fmt(Math.round(cents / full.length))} a month ${where}, from ${from}.`;
}

// Words of a name, for matching one of several words ("whole foods") as a phrase: matched word by
// word, a two-word merchant was never found, and "how much do I spend at Whole Foods a month?" fell
// back to this month (walk notes, Plaid S6, 11-19 and 11-20).
const wordsOf = (text: string) =>
  ` ${text
    .toLowerCase()
    .split(/[^a-z0-9&+']+/)
    .filter(Boolean)
    .join(" ")} `;

// What was spent in `months` at the merchant named, on the part or in the category: the cents, how
// many charges when it's a merchant's, and where, said. Null when nothing goes by that name.
function spentIn(
  target: string,
  transactions: InsightTransaction[],
  months: readonly string[],
  asOf: string,
): { cents: number; count: number | null; where: string } | null {
  const q = target.toLowerCase();
  const sub = matchSubcategory(target);
  const category = matchCategory(target, [
    ...new Set([...Object.values(CATEGORY_LABELS), UNCATEGORIZED]),
  ]);
  const named = transactions.filter((t) => {
    if (!months.includes(t.date.slice(0, 7)) || kindOf(t) !== "spending") return false;
    const name = merchantOf(t).toLowerCase();
    return sub || category ? name === q : wordsOf(name).includes(wordsOf(q));
  });
  if (named.length > 0) {
    return {
      cents: named.reduce((sum, t) => sum + t.amountCents, 0),
      count: named.length,
      where: `at ${merchantOf(named[0]!)}`,
    };
  }
  // A part of a category ("gas") when the data says which part each charge is (debugger 11-17).
  const parts = sub ? months.map((m) => subcategorySpending(transactions, m, sub)) : [];
  if (sub && parts.every((c) => c !== null)) {
    return {
      cents: parts.reduce<number>((sum, c) => sum + (c ?? 0), 0),
      count: null,
      where: `on ${sub.name}`,
    };
  }
  if (!category || sub) return null;
  const byMonth = spendingInsights(transactions, {
    asOf,
    monthCount: INSIGHT_MONTHS,
  }).categoriesByMonth;
  return {
    cents: months.reduce(
      (sum, m) => sum + (byMonth[m]?.find((c) => c.category === category)?.cents ?? 0),
      0,
    ),
    count: null,
    where: `on ${category}`,
  };
}

// The days a short period covers, ending on asOf (the person's own today): "this week" is the last
// seven days, today included, and "last week" the seven before them.
function shortPeriodDays(
  period: ShortPeriod,
  asOf: string,
): { from: string; to: string; label: string } {
  switch (period) {
    case "today":
      return { from: asOf, to: asOf, label: "today" };
    case "yesterday":
      return { from: addDays(asOf, -1), to: addDays(asOf, -1), label: "yesterday" };
    case "last_week":
      return {
        from: addDays(asOf, -13),
        to: addDays(asOf, -7),
        label: `last week (${dayLabel(addDays(asOf, -13))} to ${dayLabel(addDays(asOf, -7))})`,
      };
    default:
      return {
        from: addDays(asOf, -6),
        to: asOf,
        label: `in the last 7 days (${dayLabel(addDays(asOf, -6))} to ${dayLabel(asOf)})`,
      };
  }
}

// "How much have I spent on groceries this week?": what the days hold, at the merchant named, on the
// part or in the category, or all of it. Says when what Jane has ends before the days do.
function shortPeriodLine(
  period: ShortPeriod,
  target: string | null,
  transactions: InsightTransaction[],
  asOf: string,
): string {
  const { from, to, label } = shortPeriodDays(period, asOf);
  const lastDate = transactions.reduce(
    (last, t) => (t.date > last ? t.date : last),
    transactions[0]!.date,
  );
  const firstDate = transactions.reduce(
    (first, t) => (t.date < first ? t.date : first),
    transactions[0]!.date,
  );
  if (lastDate < from) {
    return `I can't see ${label.replace(/^in /, "")}: what I have ends on ${dayLabel(lastDate)}.`;
  }
  if (firstDate > to) {
    return `I can't see ${label.replace(/^in /, "")}: what I have starts on ${dayLabel(firstDate)}.`;
  }
  // The days are read as one month, so a refund on one day nets against a purchase on another and
  // every answer (all spending, a merchant, a part, a category) follows the same rule: the
  // range's total, never below zero.
  const month = asOf.slice(0, 7);
  const days = transactions
    .filter((t) => t.date >= from && t.date <= to)
    .map((t) => ({ ...t, date: `${month}-01` }));
  const edges = `${lastDate < to ? ` What I have ends on ${dayLabel(lastDate)}.` : ""}${
    firstDate > from ? ` What I have starts on ${dayLabel(firstDate)}.` : ""
  }`;
  if (!target) {
    const cents =
      spendingInsights(days, { asOf, monthCount: INSIGHT_MONTHS }).months.find(
        (m) => m.month === month,
      )?.spendingCents ?? 0;
    return `You spent ${fmt(cents)} ${label}.${edges}`;
  }
  const spent = spentIn(target, days, [month], asOf);
  if (!spent) return `${SPENDING_NOT_FOUND} "${target}" ${label}.${edges}`;
  return `You spent ${fmt(Math.max(0, spent.cents))} ${spent.where} ${label}.${edges}`;
}

// "How much have I spent on Uber?" with no period: everything on file, since the data starts, and
// this month's part. A merchant or a part of a category only; a whole category keeps the month's
// answer, with its comparison. Null when nothing goes by that name.
function sinceStartLine(
  target: string,
  transactions: InsightTransaction[],
  asOf: string,
): string | null {
  const months = [...new Set(transactions.map((t) => t.date.slice(0, 7)))].sort();
  const all = spentIn(target, transactions, months, asOf);
  // A whole category's (no merchant by that name, no part of one) keeps the month's answer.
  if (!all || all.cents === 0 || (all.count === null && !matchSubcategory(target))) return null;
  const first = transactions.reduce((min, t) => (t.date < min ? t.date : min), months[0]! + "-31");
  const current = monthOf(asOf);
  const now = months.includes(current) ? spentIn(target, transactions, [current], asOf) : null;
  const times = all.count !== null ? ` (${all.count === 1 ? "once" : `${all.count} times`})` : "";
  const part =
    now && now.cents > 0 && now.cents < all.cents
      ? `, ${fmt(now.cents)} of it in ${monthLabel(current).split(" ")[0]} so far`
      : "";
  return `You've spent ${fmt(all.cents)} ${all.where} since ${dayLabel(first)}${times}${part}.`;
}

// "What's due?": the coming-up list from Today, bills and deadlines together.
// drawn: the rows go under the answer as a timeline too (spec step 94), so the words give how many
// and how much, not the same list again (debug 2, 11-16: four bills listed, then the same four
// drawn below them).
export function comingUpReply(
  intent: Extract<Intent, { kind: "coming_up" }>,
  rows: ComingUpRow[],
  {
    drawn = false,
    payday = null,
    statementsEnd = null,
    shortHistory = false,
  }: {
    drawn?: boolean;
    payday?: string | null;
    // Where the statements end, when that's too long ago to say what's coming up now.
    statementsEnd?: string | null;
    // Less history than bills show in (CASH_FLOW_MIN_HISTORY_DAYS, Home's strip's rule).
    shortHistory?: boolean;
  } = {},
): Reply {
  // Before payday: what's due before the next pay, when Jane knows when that is (debugger 11-17).
  const until = intent.beforePayday ? payday : null;
  const shown = until
    ? rows.filter((r) => r.date < until)
    : intent.days === null
      ? rows
      : rows.filter((r) => r.daysLeft <= intent.days!);
  const open = [openLink("See bills", "/bills")];
  const span = until
    ? `due before payday (${dayLabel(until)})`
    : intent.days === null
      ? "coming up"
      : "due this week";
  // Debug 3, 11-19: statements that ended in September heard "Nothing is coming up that I can
  // see." in November: nothing is known about now, not nothing due.
  if (shown.length === 0 && statementsEnd) {
    return reply(
      `Your statements end ${dayLabel(statementsEnd, { year: true })}, so I can't say what's ${span} now. Upload newer statements and I'll check.`,
      [openLink("Upload newer statements", "/import")],
    );
  }
  // Debug 3, 11-19 (class 6): one month of statements heard "Nothing is coming up that I can see."
  // with rent still to come: Home's strip says why it can't tell, and so does the chat.
  if (shown.length === 0 && shortHistory) return reply(TOO_LITTLE_HISTORY, open);
  if (shown.length === 0) return reply(`Nothing is ${span} that I can see.`, open);
  // Spec step 89: how many and how much first, then the list. A return window is listed with its
  // purchase but isn't money owed, so it isn't in the total (debug 3, 11-18: "$1,053.92 in all"
  // with $1,001.70 of it two return windows).
  const total = shown
    .filter((r) => r.kind !== "return")
    .reduce((sum, r) => sum + (r.amountCents ?? 0), 0);
  const lines = shown.map(
    (r) =>
      `- ${dayLabel(r.date)} (${inDays(r.daysLeft)}): ${r.label}${r.amountCents !== null ? `, ${fmt(r.amountCents)}` : ""}`,
  );
  const head = `${things(shown.length)} ${shown.length === 1 ? "is" : "are"} ${span}${total > 0 ? `, ${fmt(total)} in all` : ""}.`;
  return reply(drawn ? head : `${head}\n${lines.join("\n")}`, open);
}

// "Safe to spend": the number on Today.
// "Hi": hello, safe to spend, and something to ask. "Thanks": you're welcome.
export function greetingReply(
  thanks: boolean,
  safe: { safeCents: number; payday: string | null } | null,
  asOf: string | null = null,
): Reply {
  if (thanks) return reply("You're welcome! I'm here whenever you need me.");
  const money = safe
    ? ` You have ${fmt(safe.safeCents)} safe to spend${safe.payday ? ` until ${asOf ? dateAndDays(safe.payday, asOf) : dayLabel(safe.payday)}` : ""}.`
    : "";
  return reply(
    `Hi!${money} Ask me anything about your money, like "${EXAMPLES[0]}".`,
    safe ? [openLink("See today", "/home")] : [],
  );
}

export function safeReply(
  safe: {
    safeCents: number;
    payday: string | null;
    taxHeldCents?: number;
    leftOut?: string[];
    // What was taken off the balance. Gate E (11-16): one October statement finds no bills yet, so
    // "after upcoming bills" said of the whole balance (rent of $1,200 still to come) was wrong.
    billsCents?: number;
    budgetsLeftCents?: number;
    goalsCents?: number;
    setAsideCents?: number;
    // What the checking balance adds to a statement's, walked forward (#2142).
    sinceStatement?: SinceStatement | null;
    // Pay due that hasn't come in, counted or missed (src/planning/pay-due.ts).
    payDue?: PayDue[];
    payMissed?: PayDue[];
  } | null,
  asOf: string | null = null,
  // Why there's no figure, when Jane knows: statements too old to say what's in checking today.
  // shortHistory: too little history to see bills in (CASH_FLOW_MIN_HISTORY_DAYS), so none taken
  // off isn't none due.
  {
    statementsEnd = null,
    shortHistory = false,
  }: { statementsEnd?: string | null; shortHistory?: boolean } = {},
): Reply {
  if (!safe && statementsEnd) {
    // Debugger 11-16: a statement ending Sep 29, balance and all, heard "Jane needs your checking
    // balance for this… add its balance on the import page", a balance it had given.
    return reply(
      `Your statements end ${dayLabel(statementsEnd, { year: true })}, so I can't say what's safe to spend today. Upload newer statements and I'll work it out.`,
      [openLink("Upload newer statements", "/import")],
    );
  }
  if (!safe) {
    return reply(AFFORD_COPY.noChecking, [openLink("Add your accounts", "/connect")]);
  }
  const payday = safe.payday && (asOf ? dateAndDays(safe.payday, asOf) : dayLabel(safe.payday));
  const leftOut = safe.leftOut?.length
    ? ` That leaves out ${safe.leftOut.join(" and ")}: I don't have a balance for it, so its money and bills aren't counted.`
    : "";
  const tax = safe.taxHeldCents
    ? `, with ${fmt(safe.taxHeldCents)} held back for tax not yet withheld or paid (an estimate)`
    : "";
  const known = safe.billsCents !== undefined;
  const parts = known
    ? [
        safe.billsCents ? "upcoming bills" : null,
        safe.setAsideCents ? "what's set aside for yearly bills" : null,
        safe.budgetsLeftCents ? "what's left in your budgets" : null,
        safe.goalsCents ? "what goes to your goals" : null,
      ].filter((p): p is string => p !== null)
    : ["upcoming bills", "what's left in your budgets", "what goes to your goals"];
  const after =
    parts.length > 0
      ? ` That's after ${parts.length > 1 ? `${parts.slice(0, -1).join(", ")} and ${parts.at(-1)}` : parts[0]}${tax}.`
      : // Until payday, only bills due before it count (debugger 11-16: "I don't see any bills coming
        // up" with rent due four days after payday).
        // Nothing held back for budgets or goals isn't none of them: a goal just set up holds nothing
        // before payday (debug 2, 11-16: "I don't see budgets or goals yet" a minute after "Set it
        // up" on an emergency fund goal).
        ` That's your ${safe.taxHeldCents ? "checking balance" : "whole checking balance"}${tax}: ${
          shortHistory
            ? "there's too little history to see your bills yet, and nothing is held back for budgets or goals."
            : payday
              ? "no bills are due before then, and nothing is held back for budgets or goals."
              : "I don't see any bills coming up, and nothing is held back for budgets or goals."
        }`;
  // Checking walked forward from a statement is an estimate, said with what it added (debug 3,
  // 11-19: "That's your whole checking balance" of $10,714.84 where the statement said $8,450.00).
  const estimated =
    safe.sinceStatement && safe.sinceStatement.cents !== 0
      ? ` Checking is estimated: ${sinceStatementNote(safe.sinceStatement)}.`
      : "";
  return reply(
    `You have ${fmt(safe.safeCents)} safe to spend${payday ? ` until your next payday, ${payday}` : ""}.${after}${payDueSentence(safe.payDue ?? [], safe.payMissed ?? [])}${estimated}${leftOut}`,
    [openLink("See today", "/home")],
  );
}

// Which kinds of finding each command is about, first choice first.
const VERB_TYPES: Record<ActVerb, readonly FindingType[]> = {
  cancel: [
    "subscription_review",
    "duplicate_subscription",
    "covered_by_card",
    "trial_conversion",
    "price_increase",
  ],
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
  covered_by_card: "insurance protection cover card",
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
export function findingReply(
  finding: SnapshotFinding,
  lead: string | null = null,
  concierge = true,
): Reply {
  const candidate = findingCandidate(finding, concierge);
  // Spec step 90: "Remind me tomorrow" hides it until then, like "Not now".
  const actions = [
    ...candidate.actions.filter((a) => a.kind !== "link"),
    snoozeButton("Remind me tomorrow"),
    ...candidate.actions.filter((a) => a.kind === "link"),
  ];
  return reply(lead ? `${lead} ${candidate.body}` : candidate.body, actions, {
    ...candidate.refs,
    topic: { kind: "act", target: finding.title, findingId: finding.findingId },
  });
}

// A button's label: short enough for a phone.
const CHOICE_LABEL_MAX = 40;
const choiceLabel = (text: string) =>
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
): Reply {
  const subscriptions = openLink("Open subscriptions", "/subscriptions");
  const exact = intent.findingId
    ? snapshot?.findings.find((f) => f.findingId === intent.findingId)
    : undefined;
  if (snapshot && exact) return findingReply(exact, ACT_LEAD[intent.verb], snapshot.concierge);
  if (!intent.target) {
    const fitting = (snapshot?.findings ?? [])
      .filter((f) => VERB_TYPES[intent.verb].includes(f.type))
      .sort((a, b) => (b.annualSavingsCents ?? -1) - (a.annualSavingsCents ?? -1));
    if (fitting.length === 1 && snapshot)
      return findingReply(fitting[0], ACT_LEAD[intent.verb], snapshot.concierge);
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
  // The lead promises the command's own kind of action: a finding of another kind (rank past the
  // kinds that fit) shows its own words and buttons without it.
  const fits = ranked[0].rank < VERB_TYPES[intent.verb].length;
  return findingReply(ranked[0].finding, fits ? ACT_LEAD[intent.verb] : null, snapshot.concierge);
}

// Spec step 89: the answer to "cancel Hulu" comes first: yes, Jane can, once they tap.
const ACT_LEAD: Record<ActVerb, string> = {
  cancel: "I can cancel that for you.",
  lower: "I can try to lower that for you.",
  refund: "I can ask for that money back.",
};

// "What did you do?": what the action agent did this week (src/lib/what-jane-did.ts).
export function whatDidReply(did: JaneDid): Reply {
  const open = [openLink("See every step", "/actions")];
  const lines: string[] = [];
  if (did.finished.length > 0) {
    lines.push(
      `This week I finished ${things(did.finished.length)}${did.confirmedCents > 0 ? `, with ${fmt(did.confirmedCents)} ${BACK_OR_AGREED}` : ""}: ${did.finished.map((f) => `"${f.title}"`).join(", ")}.`,
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
  const plan = openLink("Review the plan", "/plan");
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
      [openLink("Open the plan", "/plan")],
    );
  }
  return reply(
    `Undo my yes to "${latest.title}"? It goes back on your plan.`,
    [{ id: "undo.rule", label: "Undo it", kind: "primary" }, openLink("Open the plan", "/plan")],
    { decisionId: latest.decisionId, undoUntil: latest.undoUntil.toISOString() },
  );
}

// "Undo the transfer": the button is on the plan's own message, and works while the transfer is
// still pending. With none pending the answer says so: a real account has no transfer of Jane's
// at all, because Jane doesn't move money in a bank (src/lib/jane-agent/multi.ts).
export function undoTransferReply({
  pending,
  canMoveMoney,
}: {
  pending: number;
  canMoveMoney: boolean;
}): Reply {
  if (pending > 0) {
    return reply(
      `${pending === 1 ? "One transfer from a plan is" : `${pending} transfers from a plan are`} still pending. Tap "Undo the transfer" on that plan's message in this chat to take ${pending === 1 ? "it" : "them"} back; once a transfer has gone through it stays.`,
    );
  }
  return reply(
    canMoveMoney
      ? "There's no transfer of mine waiting to be taken back: none is pending, and one that has gone through stays."
      : "I can't move money in your bank yet, so there's no transfer of mine to take back. Anything you moved yourself is undone in your bank.",
  );
}

// "Pause autopilot": offers the switch to "Ask me first".
export function pauseReply(level: string | null): Reply {
  const settings = openLink("Autopilot settings", "/settings#autopilot");
  if (!level || level === "ask") {
    return reply("Autopilot is already off: I ask you before doing anything.", [settings]);
  }
  return reply(
    "Pause autopilot? From then on I'll ask you before doing anything. Work already started carries on.",
    [{ id: "autopilot.pause", label: "Pause autopilot", kind: "primary" }, settings],
  );
}
