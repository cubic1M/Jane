import type { Frequency } from "@/config/detection";
import { dayLabel } from "@/lib/day-label";
import { formatCents } from "@/lib/money";
import { nameMatches } from "./names";
import type { Charge, Recurring } from "./recurring";
import { clarifyReply, findingReply, type Reply } from "./replies";
import type { Snapshot } from "./snapshot";
import { rentAsk } from "./sources/rent-question";
import { dateAndDays } from "./sources/source";
import { type MessageAction, openLink } from "./types";

// Spec step 88: what one thing costs, the subscriptions list and the next payday, from the
// same numbers as the Subscriptions page and safe to spend. Pure. Where Jane found a way to
// save on it, the answer ends with that finding's buttons.

// "a month", "every 3 months": how often, after an amount.
const EVERY: Record<Frequency, string> = {
  WEEKLY: "a week",
  BIWEEKLY: "every 2 weeks",
  SEMI_MONTHLY: "twice a month",
  MONTHLY: "a month",
  QUARTERLY: "every 3 months",
  SEMIANNUALLY: "every 6 months",
  ANNUALLY: "a year",
};

const subscriptionsLink: MessageAction = openLink("Open subscriptions", "/subscriptions");
// A regular bill that isn't a subscription (rent, a phone bill) opens the bills it's one of
// (debug 2, 11-16: "how much is my rent?" ended "Open subscriptions").
const billsLink: MessageAction = openLink("See your bills", "/bills");
const linkFor = (charge: Charge | null) =>
  charge && !charge.subscription && !charge.maybeSubscription ? billsLink : subscriptionsLink;

// The charges a name could mean ("netflix", "my phone bill", "the gym"), and "rent" the rent,
// whoever it's paid to.
function matchCharges(charges: readonly Charge[], target: string): Charge[] {
  const named = charges.filter((c) => nameMatches(target, c.merchant));
  return named.length === 0 && /^rent$/i.test(target) ? charges.filter((c) => c.rent) : named;
}

// The finding about a charge, as its buttons, or just a link to Subscriptions.
function withFinding(
  body: string,
  charge: Charge | null,
  snapshot: Snapshot | null,
  topic: Reply["refs"]["topic"],
): Reply {
  const finding =
    charge?.openFindingId && snapshot
      ? snapshot.findings.find((f) => f.findingId === charge.openFindingId)
      : undefined;
  if (finding && snapshot) {
    const decision = findingReply(finding, null, snapshot.concierge);
    return {
      body: `${body}\n${decision.body}`,
      actions: decision.actions,
      refs: { ...decision.refs, topic: { ...topic!, findingId: finding.findingId } },
    };
  }
  return { body, actions: [linkFor(charge)], refs: { topic } };
}

// "How much is Netflix?": the charge, how often, a year's cost and the next one. Null when
// nothing charged on a schedule matches; a question when several do.
export function costReply(
  intent: { target: string; year: boolean },
  recurring: Recurring,
  snapshot: Snapshot | null,
  asOf: string,
): Reply | null {
  const matches = matchCharges(recurring.charges, intent.target);
  // Rent sent to a person reads as a transfer until they answer "Is this your rent?", so the month's
  // rent spending would say $0.00 (debugger 11-16: $900 by Zelle on each 1st): the question instead.
  if (matches.length === 0 && /\brent\b/i.test(intent.target) && snapshot?.rentQuestion) {
    return rentAsk(snapshot.rentQuestion);
  }
  if (matches.length === 0) return null;
  // Two charges of one name (two plans, two cards): asking "which one" would offer the same name
  // twice, so each is said with its own amount and how often (CodeRabbit part 2).
  if (matches.length > 1 && new Set(matches.map((c) => c.merchant.toLowerCase())).size === 1) {
    const each = matches.map((c) =>
      // A bill that moves with use is its range, not its last amount.
      c.varies
        ? `about ${formatCents(c.varies.usualCents)} ${EVERY[c.frequency]} (${formatCents(c.varies.lowCents)} to ${formatCents(c.varies.highCents)})`
        : `${formatCents(c.lastAmountCents)} ${EVERY[c.frequency]} (${formatCents(c.annualCostCents)} a year)`,
    );
    return {
      body: `You have ${matches.length} charges from ${matches[0].merchant}: ${each.join("; ")}.`,
      actions: [linkFor(matches[0])],
      refs: {},
    };
  }
  if (matches.length > 1) {
    return clarifyReply(
      "Which one do you mean?",
      matches.map((c) => ({
        label: c.merchant,
        intent: { kind: "cost", target: c.merchant, year: intent.year },
      })),
    );
  }
  const [charge] = matches;
  const every = EVERY[charge.frequency];
  const each = `${formatCents(charge.lastAmountCents)} ${every}`;
  const year = formatCents(charge.annualCostCents);
  const next = charge.nextDate ? ` The next charge is ${dateAndDays(charge.nextDate, asOf)}.` : "";
  // A bill that moves with use, as its range and usual amount, not the last one as the monthly
  // (upload S1: "Xcel Energy is $57.49 a month" over bills of $46.60, $38.72 and $57.49).
  if (charge.varies) {
    const v = charge.varies;
    return withFinding(
      `${charge.merchant} varies: ${formatCents(v.lowCents)} to ${formatCents(v.highCents)}, about ${formatCents(v.usualCents)} ${every}. The last was ${formatCents(charge.lastAmountCents)}.${next}`,
      charge,
      snapshot,
      { kind: "cost", target: charge.merchant },
    );
  }
  const first =
    charge.frequency === "ANNUALLY"
      ? `${charge.merchant} is ${each}.`
      : intent.year
        ? `${charge.merchant} costs you ${year} a year (${each}).`
        : `${charge.merchant} is ${each}, ${year} a year.`;
  return withFinding(`${first}${next}`, charge, snapshot, {
    kind: "cost",
    target: charge.merchant,
  });
}

// "When is rent due?" with nothing paid on a schedule yet: what's missing, not a month's spending
// (debugger 11-18: "You spent $0.00 on Rent and utilities" a month after $700 of rent by Zelle).
export function notRegularYet(target: string): Reply {
  return {
    body: `I don't see a regular ${target} payment yet. Once it has gone out a few times, I'll know when the next is due.`,
    actions: [openLink("See your transactions", `/transactions?q=${encodeURIComponent(target)}`)],
    refs: {},
  };
}

// "What subscriptions do I have?": the most expensive first, what they come to, and the
// biggest saving Jane found among them. With all, every regular charge (bills too).
// Statements that end weeks ago read every charge as stopped (debugger 11-17: "I don't see any
// subscriptions yet" and "I don't see a regular paycheck yet" on statements ending Sep 28 that
// pay Netflix and a paycheck every two weeks): what they can't say, as safe to spend says it.
const oldStatements = (statementsEnd: string, what: string, then: string): Reply => ({
  body: `Your statements end ${dayLabel(statementsEnd, { year: true })}, so I can't say ${what}. Upload newer statements and I'll ${then}.`,
  actions: [openLink("Upload newer statements", "/import")],
  refs: {},
});

export function subscriptionsReply(
  intent: { total: boolean; all: boolean },
  recurring: Recurring,
  snapshot: Snapshot | null,
  {
    statementsEnd = null,
    shortHistory = false,
    seenOnce = [],
  }: {
    statementsEnd?: string | null;
    // Less history than a monthly charge shows twice in (CASH_FLOW_MIN_HISTORY_DAYS).
    shortHistory?: boolean;
    // On a short history, the charges of a subscription's kind seen once each ("Hulu $9.99").
    seenOnce?: readonly string[];
  } = {},
): Reply {
  const list = recurring.charges.filter((c) => intent.all || c.subscription);
  const what = intent.all ? "regular charges" : "subscriptions";
  // All the regular charges include rent and bills: their list is the bills view.
  const listLink = intent.all ? billsLink : subscriptionsLink;
  // "1 subscription", not "1 subscriptions" (night QA 10-30).
  const counted = `${list.length} ${list.length === 1 ? what.replace(/s$/, "") : what}`;
  if (list.length === 0) {
    if (statementsEnd) return oldStatements(statementsEnd, `what ${what} you pay now`, "check");
    // Debug 3, 11-19 (class 6): one month of statements can't show a monthly charge twice, so
    // none seen isn't none paid.
    if (shortHistory && seenOnce.length > 0) {
      const named =
        seenOnce.length === 1
          ? seenOnce[0]!
          : `${seenOnce.slice(0, -1).join(", ")} and ${seenOnce[seenOnce.length - 1]}`;
      return {
        body: `${named} ${seenOnce.length === 1 ? "looks like a subscription" : "look like subscriptions"}, one charge each so far. There's too little history to be sure: they show as subscriptions once about two months of transactions are in.`,
        actions: [listLink],
        refs: {},
      };
    }
    const why = shortHistory
      ? ": there's too little history to tell. They show once about two months of transactions are in."
      : ".";
    return { body: `I don't see any ${what} yet${why}`, actions: [listLink], refs: {} };
  }
  const yearCents = list.reduce((sum, c) => sum + c.annualCostCents, 0);
  const monthCents = Math.round(yearCents / 12);
  const lines = [
    intent.total
      ? `You spend about ${formatCents(monthCents)} a month on ${counted}, ${formatCents(yearCents)} a year.`
      : `You have ${counted}, about ${formatCents(monthCents)} a month in all.`,
  ];
  const each = (c: Charge) =>
    `${c.merchant} ${formatCents(c.lastAmountCents)} ${EVERY[c.frequency]}`;
  if (intent.total) {
    // The total is the answer; the biggest few say where it goes.
    lines[0] += ` The biggest: ${list.slice(0, 3).map(each).join(", ")}.`;
  } else {
    // One sentence naming the biggest few, so the answer stays at three with the saving.
    const top = list.slice(0, 3).map(each);
    const more = list.length - top.length;
    const names =
      top.length === 1
        ? top[0]
        : `${top.slice(0, -1).join(", ")} and ${top.at(-1)}${more > 0 ? `, and ${more} more` : ""}`;
    lines[0] = `${lines[0].replace(/\.$/, "")}: ${names}.`;
  }
  // The open finding about one of them that would save the most.
  const ids = new Set(list.flatMap((c) => (c.openFindingId ? [c.openFindingId] : [])));
  const best = (snapshot?.findings ?? [])
    .filter((f) => ids.has(f.findingId))
    .sort((a, b) => (b.annualSavingsCents ?? -1) - (a.annualSavingsCents ?? -1))[0];
  if (best && snapshot) {
    const decision = findingReply(best, null, snapshot.concierge);
    // The finding's own words are "Review X. Could save about $Y a year. N% sure: reason. Want me
    // to handle it?": joined into two sentences, how sure folded into the saving, so the whole
    // answer stays at three.
    const sentences = decision.body.split(/(?<=[.!?])\s+/);
    const sure = sentences.map((s) => /^(\d{1,3})% sure: /.exec(s)?.[1]).find(Boolean);
    const said = sentences.filter((s) => !/^\d{1,3}% sure: /.test(s));
    if (sure && said.length >= 2) said[1] = said[1].replace(/\.$/, ` (${sure}% sure).`);
    const tail =
      said.length >= 3
        ? `${said[0].replace(/\.$/, "")}: ${said[1].charAt(0).toLowerCase()}${said[1].slice(1)} ${said.slice(2).join(" ")}`
        : said.join(" ");
    return {
      body: `${lines.join(" ")} ${tail}`,
      actions: [...decision.actions, listLink],
      refs: decision.refs,
    };
  }
  return { body: lines.join(" "), actions: [listLink], refs: {} };
}

// "When do I get paid?": the same payday as safe to spend.
export function paydayReply(
  recurring: Recurring,
  asOf: string,
  { statementsEnd = null }: { statementsEnd?: string | null } = {},
): Reply {
  const income = recurring.nextIncome;
  if (!income && statementsEnd) {
    return oldStatements(statementsEnd, "when you're paid next", "work it out");
  }
  if (!income) {
    return {
      body: "I don't see a regular paycheck yet. Once one has come in a few times, I'll know when the next is due.",
      actions: [openLink("See bills", "/bills")],
      refs: {},
    };
  }
  return {
    body: `Your next payday is ${dateAndDays(income.date, asOf)}: about ${formatCents(income.amountCents)} from ${income.from}.`,
    actions: [openLink("See today", "/home")],
    refs: {},
  };
}
