import { CHAT_TOP_CATEGORIES } from "@/config/agent-chat";
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
import { AFFORD_COPY, monthlyNeededLine, safeLine, shortLine } from "@/planning/afford-copy";
import { affordCheck, affordWindow, monthOf, type AffordNumbers } from "@/planning/afford";
import { matchCategory, type ActVerb, type Intent } from "./intents";
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

// "Can I afford $900 for a trip in March?": what it does to safe to spend, goals and
// checking, as on /afford. A purchase in a later month gets "Start a goal for it".
export function affordReply(
  intent: Extract<Intent, { kind: "afford" }>,
  numbers: AffordNumbers,
): Reply {
  const { asOf } = numbers;
  if (intent.amountCents === null) {
    return reply('How much is it? Try "can I afford $900 for a trip in March".');
  }
  if (intent.amountCents > MAX_AFFORD_CENTS) return reply(AFFORD_COPY.errors.tooBig);
  const current = monthOf(asOf);
  const month = intent.month ?? current;
  if (!affordWindow(asOf).months.includes(month)) return reply(AFFORD_COPY.errors.month);
  const later = month > current;
  const date = later ? `${month}-01` : asOf;
  const result = affordCheck(numbers, {
    kind: "purchase",
    amountCents: intent.amountCents,
    date,
  });

  const lines = [
    `If you spend ${fmt(intent.amountCents)}${intent.what ? ` on ${intent.what}` : ""}${later ? ` in ${monthLabel(month)}` : " now"}:`,
  ];
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
  }
  if (result.firstShort && (result.firstShort.before || result.firstShort.after)) {
    lines.push(
      shortLine(
        result.firstShort.before && monthLabel(result.firstShort.before),
        result.firstShort.after && monthLabel(result.firstShort.after),
      ),
    );
  }
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
  const labels = [...new Set([...Object.values(CATEGORY_LABELS), UNCATEGORIZED])];
  const category = matchCategory(intent.category, labels);
  if (category) {
    const cents = categories.find((c) => c.category === category)?.cents ?? 0;
    return reply(`You spent ${fmt(cents)} on ${category} ${when}.`, open);
  }
  const q = intent.category.toLowerCase();
  const matching = transactions.filter(
    (t) =>
      t.date.startsWith(intent.month) &&
      kindOf(t) === "spending" &&
      merchantOf(t).toLowerCase().includes(q),
  );
  if (matching.length > 0) {
    const cents = matching.reduce((sum, t) => sum + t.amountCents, 0);
    const name = merchantOf(matching[0]);
    return reply(`You spent ${fmt(cents)} at ${name} ${when}.`, open);
  }
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

// The open finding the person means: every word they typed is in its title (or its
// kind), the kinds that fit the command first, then the biggest saving.
export function matchFinding(
  findings: readonly SnapshotFinding[],
  verb: ActVerb,
  target: string,
): SnapshotFinding | null {
  const words = target
    .toLowerCase()
    .split(/[^a-z0-9+&']+/)
    .filter((w) => w.length >= 2);
  if (words.length === 0) return null;
  const matches = findings.filter((f) => {
    const haystack = `${f.title} ${TYPE_WORDS[f.type] ?? ""}`.toLowerCase();
    return words.every((w) => haystack.includes(w));
  });
  const rank = (f: SnapshotFinding) => {
    const index = VERB_TYPES[verb].indexOf(f.type);
    return index === -1 ? VERB_TYPES[verb].length : index;
  };
  return (
    [...matches].sort(
      (a, b) => rank(a) - rank(b) || (b.annualSavingsCents ?? -1) - (a.annualSavingsCents ?? -1),
    )[0] ?? null
  );
}

// "Cancel Hulu": the matching open finding as a decision, with the same Yes and No (and
// Jane's pick) as its message from Jane's brain. Nothing happens until a tap.
export function actReply(
  intent: Extract<Intent, { kind: "act" }>,
  snapshot: Snapshot | null,
  now: Date,
): Reply {
  const subscriptions = link("Open subscriptions", "/subscriptions");
  if (!intent.target) {
    return reply('Which one? Try "cancel Hulu" or "lower my phone bill".', [subscriptions]);
  }
  const finding = snapshot && matchFinding(snapshot.findings, intent.verb, intent.target);
  if (!snapshot || !finding) {
    return reply(
      `I don't see anything open about "${intent.target}" right now, so there's nothing for me to ${intent.verb === "refund" ? "claim" : intent.verb} yet.`,
      [subscriptions],
    );
  }
  const [candidate] = findingsSource.gather(
    { ...snapshot, findings: [finding] },
    { now, local: localTime(now, snapshot.timezone), trigger: "open" },
  );
  return reply(candidate.body, candidate.actions, candidate.refs);
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
