import { CHARGE_FAR_ABOVE_SHARE, PERSON_APPS } from "@/config/agent-chat";
import { dayLabel } from "@/lib/day-label";
import { formatCents } from "@/lib/money";
import { merchantOf } from "@/detection/streams";
import type { Reply } from "./replies";
import { openLink } from "./types";

// The backup chat's answers about one merchant's charges and money moved by app or to savings (walk
// notes, desktop sweeps 7 to 9 and phone passes 5 to 7: "what happened with the Amazon charge?",
// "when did Netflix go up?", "how much does my mom send me?", "how much do I send on Venmo?", "how
// much do I put into savings each month?" were unanswered or answered as something else). From the
// lines the pages read; what the lines can't say is said. Pure.

export type MoveLine = {
  date: string;
  // Money out is positive, as the detection input has it.
  amountCents: number;
  description: string;
  merchantName: string | null;
  pfcDetailed: string | null;
  accountId: string;
};

const nameOf = (t: MoveLine) =>
  merchantOf({ merchantName: t.merchantName, description: t.description })?.name ?? null;
const words = (text: string) =>
  ` ${text
    .toLowerCase()
    .split(/[^a-z0-9&+']+/)
    .filter(Boolean)
    .join(" ")} `;
const named = (t: MoveLine, target: string) => {
  const name = nameOf(t);
  return name !== null && words(name).includes(words(target));
};
const median = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid]! : Math.round((sorted[mid - 1]! + sorted[mid]!) / 2);
};
// The calendar months the lines' history covers, first to last, months without a transfer included:
// an average over the months that had one would read high.
const historyMonths = (lines: readonly MoveLine[]) => {
  const dates = lines.map((t) => t.date.slice(0, 7)).sort();
  if (dates.length === 0) return 1;
  const [y1, m1] = dates[0]!.split("-").map(Number);
  const [y2, m2] = dates[dates.length - 1]!.split("-").map(Number);
  return Math.max(1, (y2! - y1!) * 12 + (m2! - m1!) + 1);
};
// "to ... savings" with no "from" before the savings: a transfer into it. "TRANSFER FROM SAVINGS TO
// CHECKING" is money coming out.
const INTO_SAVINGS = /\bto\s+(?:(?!from\b)[\w&'.-]+\s+){0,5}savings\b/i;
const OUT_OF_SAVINGS = /\bfrom\s+(?:(?!to\b)[\w&'.-]+\s+){0,5}savings\b/i;
const oldestFirst = (a: MoveLine, b: MoveLine) => a.date.localeCompare(b.date);
const list = (days: string[]) =>
  days.length <= 1
    ? (days[0] ?? "")
    : `${days.slice(0, -1).join(", ")} and ${days[days.length - 1]}`;
const notFound = (what: string): Reply => ({
  body: `I don't see ${what} in what I have, so I can't answer that from it.`,
  actions: [openLink("See your transactions", "/transactions")],
  refs: {},
});

// "What happened with the Amazon charge?": the latest one, against the usual.
export function chargeStoryReply(target: string, lines: readonly MoveLine[]): Reply {
  const charges = lines.filter((t) => t.amountCents > 0 && named(t, target)).sort(oldestFirst);
  if (charges.length === 0) return notFound(`a charge at ${target}`);
  const latest = charges[charges.length - 1]!;
  const before = charges.slice(0, -1).map((t) => t.amountCents);
  const usual = before.length >= 2 ? median(before) : null;
  const far = usual !== null && latest.amountCents >= usual * CHARGE_FAR_ABOVE_SHARE;
  // Named as asked ("Amazon"): the cleaned name can keep a processor's word ("Amazon Mktpl").
  const name = target.replace(/\b[a-z]/g, (c) => c.toUpperCase());
  const against =
    usual === null
      ? ""
      : far
        ? `, far above your usual ${formatCents(usual)}`
        : `; your usual there is ${formatCents(usual)}`;
  return {
    body: `Your latest ${name} charge was ${formatCents(latest.amountCents)} on ${dayLabel(latest.date)}${against}.${
      far ? " If it wasn't you, ask your bank to dispute it." : ""
    }`,
    actions: [openLink("See your transactions", `/transactions?q=${encodeURIComponent(name)}`)],
    refs: {},
  };
}

// "When did Netflix go up?", "how much did Hulu go up?": the last change in what it charges.
export function priceChangeReply(target: string, lines: readonly MoveLine[]): Reply {
  const charges = lines.filter((t) => t.amountCents > 0 && named(t, target)).sort(oldestFirst);
  if (charges.length === 0) return notFound(`a charge at ${target}`);
  const name = nameOf(charges[0]!)!;
  const actions = [openLink("See your subscriptions", "/subscriptions")];
  let change: { from: MoveLine; to: MoveLine } | null = null;
  for (let i = 1; i < charges.length; i += 1) {
    if (charges[i]!.amountCents !== charges[i - 1]!.amountCents) {
      change = { from: charges[i - 1]!, to: charges[i]! };
    }
  }
  if (!change) {
    return {
      body: `${name} has been ${formatCents(charges[0]!.amountCents)} every time since ${dayLabel(charges[0]!.date)}: I don't see it going up.`,
      actions,
      refs: {},
    };
  }
  const { from, to } = change;
  const up = to.amountCents > from.amountCents;
  const diff = Math.abs(to.amountCents - from.amountCents);
  // Charged about monthly (each about a month apart): the difference as a year.
  const gaps = charges
    .slice(1)
    .map(
      (t, i) =>
        (Date.parse(`${t.date}T00:00:00Z`) - Date.parse(`${charges[i]!.date}T00:00:00Z`)) /
        86_400_000,
    );
  const monthly = gaps.length > 0 && gaps.every((g) => g >= 25 && g <= 35);
  return {
    body: `${name} went ${up ? "up" : "down"} on ${dayLabel(to.date, { year: true })}, from ${formatCents(from.amountCents)} to ${formatCents(to.amountCents)}${
      monthly ? ` a month: ${formatCents(diff * 12)} a year ${up ? "more" : "less"}` : ""
    }.`,
    actions,
    refs: {},
  };
}

// "How much does my mom send me?": money people sent by an app, by app. The bank's lines don't say
// who someone is to the person, so it can't say whose is their mom's.
// The words a bank's line may use for the person asked about ("MOM VENMO CASHOUT").
const SAID_AS: Record<string, readonly string[]> = {
  mom: ["mom", "mum", "mother", "mama"],
  mum: ["mom", "mum", "mother", "mama"],
  mother: ["mom", "mum", "mother", "mama"],
  dad: ["dad", "father", "papa"],
  father: ["dad", "father", "papa"],
  parent: ["mom", "mum", "mother", "dad", "father", "parent", "parents"],
  parents: ["mom", "mum", "mother", "dad", "father", "parent", "parents"],
};

// "How much does my mom send me?": what came in by a payment app, and, when the bank's lines name
// the person asked about (upload S1's "Deposit from MOM VENMO CASHOUT"), what came from those lines.
// `who` is the person as typed, null for everyone.
export function moneyFromPeopleReply(lines: readonly MoveLine[], who: string | null): Reply {
  const received = lines
    .filter((t) => t.amountCents < 0 && PERSON_APPS.test(t.description))
    .sort(oldestFirst);
  if (received.length === 0)
    return notFound("money sent to you by Venmo, Zelle, Cash App or PayPal");
  const asked = who === null ? [] : (SAID_AS[who] ?? [who]);
  const theirs = received.filter((t) => asked.some((w) => words(t.description).includes(` ${w} `)));
  if (who !== null && theirs.length > 0) {
    return {
      body: `The lines that say ${who.toUpperCase()} came to ${byApps(theirs)}.${
        theirs.length < received.length
          ? ` Other people sent you ${formatCents(received.filter((t) => !theirs.includes(t)).reduce((s, t) => s - t.amountCents, 0))} more.`
          : ""
      }`,
      actions: [openLink("See your transactions", "/transactions")],
      refs: {},
    };
  }
  return {
    body: `People sent you ${byApps(received)}.${
      who === null
        ? ""
        : ` The bank's lines don't name who sent it, so I can't tell which is from your ${who}.`
    }`,
    actions: [openLink("See your transactions", "/transactions")],
    refs: {},
  };
}

// "$200.00 by Venmo on Aug 20, Sep 20 and Oct 20 ($600.00 in all)", each app in turn.
function byApps(received: readonly MoveLine[]): string {
  const byApp = new Map<string, MoveLine[]>();
  for (const t of received) {
    const app = appName(PERSON_APPS.exec(t.description)![1]!);
    byApp.set(app, [...(byApp.get(app) ?? []), t]);
  }
  const parts = [...byApp].map(([app, sent]) => {
    const total = sent.reduce((s, t) => s - t.amountCents, 0);
    const each = new Set(sent.map((t) => t.amountCents)).size === 1;
    const amount = each ? `${formatCents(-sent[0]!.amountCents)} ` : "";
    return sent.length <= 4
      ? `${amount}by ${app} on ${list(sent.map((t) => dayLabel(t.date)))} (${formatCents(total)} in all)`
      : `${formatCents(total)} by ${app} in ${sent.length} payments since ${dayLabel(sent[0]!.date)}`;
  });
  return parts.join("; ");
}

// "How much do I send on Venmo?": what went out by that app.
export function sentByAppReply(app: string, lines: readonly MoveLine[]): Reply {
  const pattern = new RegExp(`\\b${app.replace(/ /g, " ?")}\\b`, "i");
  const sent = lines
    .filter((t) => t.amountCents > 0 && pattern.test(t.description))
    .sort(oldestFirst);
  const label = appName(app);
  if (sent.length === 0) return notFound(`money you sent by ${label}`);
  const total = sent.reduce((s, t) => s + t.amountCents, 0);
  const months = historyMonths(lines);
  return {
    body: `You've sent ${formatCents(total)} by ${label} since ${dayLabel(sent[0]!.date)} (${
      sent.length === 1 ? "once" : `${sent.length} times`
    })${months > 1 ? `, about ${formatCents(Math.round(total / months))} a month` : ""}.`,
    actions: [openLink("See your transactions", `/transactions?q=${encodeURIComponent(label)}`)],
    refs: {},
  };
}

// "How much do I put into savings each month?": transfers out to savings, as the bank files them or
// as its line says ("ONLINE TRANSFER TO ALLY BANK SAVINGS").
export function savingsTransfersReply(lines: readonly MoveLine[]): Reply {
  const moved = lines
    .filter(
      (t) =>
        t.amountCents > 0 &&
        (t.pfcDetailed === "TRANSFER_OUT_SAVINGS" ||
          (/\btransfer\b/i.test(t.description) &&
            INTO_SAVINGS.test(t.description) &&
            !OUT_OF_SAVINGS.test(t.description))),
    )
    .sort(oldestFirst);
  if (moved.length === 0) return notFound("money moved into savings");
  const total = moved.reduce((s, t) => s + t.amountCents, 0);
  const months = historyMonths(lines);
  const to = nameOf(moved[moved.length - 1]!);
  return {
    body: `You move about ${formatCents(Math.round(total / months))} a month into savings${to ? `, to ${to}` : ""}: ${formatCents(total)} in ${
      moved.length === 1 ? "one transfer" : `${moved.length} transfers`
    } since ${dayLabel(moved[0]!.date)}.`,
    actions: [openLink("See your goals", "/goals")],
    refs: {},
  };
}

function appName(app: string): string {
  const a = app.toLowerCase().replace(/\s/g, "");
  return a === "cashapp"
    ? "Cash App"
    : a === "paypal"
      ? "PayPal"
      : a[0]!.toUpperCase() + a.slice(1);
}
