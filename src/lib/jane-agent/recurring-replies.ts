import type { Frequency } from "@/config/detection";
import { formatCents } from "@/lib/money";
import { nameMatches } from "./names";
import type { Charge, Recurring } from "./recurring";
import { clarifyReply, findingReply, type Reply } from "./replies";
import type { Snapshot } from "./snapshot";
import { dateAndDays } from "./sources/source";
import type { MessageAction } from "./types";

// Spec step 88: what one thing costs, the subscriptions list and the next payday, from the
// same numbers as the Subscriptions page and safe to spend. Pure. Where Jane found a way to
// save on it, the answer ends with that finding's buttons.

// "a month", "every 3 months": how often, after an amount.
export const EVERY: Record<Frequency, string> = {
  WEEKLY: "a week",
  BIWEEKLY: "every 2 weeks",
  SEMI_MONTHLY: "twice a month",
  MONTHLY: "a month",
  QUARTERLY: "every 3 months",
  ANNUALLY: "a year",
};

const subscriptionsLink: MessageAction = {
  id: "open",
  label: "Open subscriptions",
  kind: "link",
  href: "/subscriptions",
};

// The charges a name could mean ("netflix", "my phone bill", "the gym").
export function matchCharges(charges: readonly Charge[], target: string): Charge[] {
  return charges.filter((c) => nameMatches(target, c.merchant));
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
  return { body, actions: [subscriptionsLink], refs: { topic } };
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
  if (matches.length === 0) return null;
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
  const first =
    charge.frequency === "ANNUALLY"
      ? `${charge.merchant} is ${each}.`
      : intent.year
        ? `${charge.merchant} costs you ${year} a year (${each}).`
        : `${charge.merchant} is ${each}, ${year} a year.`;
  const next = charge.nextDate ? ` The next charge is ${dateAndDays(charge.nextDate, asOf)}.` : "";
  return withFinding(`${first}${next}`, charge, snapshot, {
    kind: "cost",
    target: charge.merchant,
  });
}

// "What subscriptions do I have?": the most expensive first, what they come to, and the
// biggest saving Jane found among them. With all, every regular charge (bills too).
export function subscriptionsReply(
  intent: { total: boolean; all: boolean },
  recurring: Recurring,
  snapshot: Snapshot | null,
): Reply {
  const list = recurring.charges.filter((c) => intent.all || c.subscription);
  const what = intent.all ? "regular charges" : "subscriptions";
  if (list.length === 0) {
    return { body: `I don't see any ${what} yet.`, actions: [subscriptionsLink], refs: {} };
  }
  const yearCents = list.reduce((sum, c) => sum + c.annualCostCents, 0);
  const monthCents = Math.round(yearCents / 12);
  const lines = [
    intent.total
      ? `You spend about ${formatCents(monthCents)} a month on ${list.length} ${what}, ${formatCents(yearCents)} a year.`
      : `You have ${list.length} ${what}, about ${formatCents(monthCents)} a month in all.`,
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
    // The finding's own words are "Review X. Could save about $Y a year. Want me to handle
    // it?": joined into two sentences, so the whole answer stays at three.
    const said = decision.body.split(/(?<=[.!?])\s+/);
    const tail =
      said.length >= 3
        ? `${said[0].replace(/\.$/, "")}: ${said[1].charAt(0).toLowerCase()}${said[1].slice(1)} ${said.slice(2).join(" ")}`
        : said.join(" ");
    return {
      body: `${lines.join(" ")} ${tail}`,
      actions: [...decision.actions, subscriptionsLink],
      refs: decision.refs,
    };
  }
  return { body: lines.join(" "), actions: [subscriptionsLink], refs: {} };
}

// "When do I get paid?": the same payday as safe to spend.
export function paydayReply(recurring: Recurring, asOf: string): Reply {
  const income = recurring.nextIncome;
  if (!income) {
    return {
      body: "I don't see a regular paycheck yet. Once one has come in a few times, I'll know when the next is due.",
      actions: [{ id: "open", label: "See bills", kind: "link", href: "/bills" }],
      refs: {},
    };
  }
  return {
    body: `Your next payday is ${dateAndDays(income.date, asOf)}: about ${formatCents(income.amountCents)} from ${income.from}.`,
    actions: [{ id: "open", label: "See today", kind: "link", href: "/home" }],
    refs: {},
  };
}
