import { addDays } from "@/lib/dates";
import { dayLabel } from "@/lib/day-label";
import { formatCents } from "@/lib/money";
import { merchantOf } from "@/detection/streams";
import { bankFeesYear, isBankFee } from "@/planning/bank-fees";
import type { Reply } from "./replies";
import { openLink } from "./types";

// The backup chat's fee answers (the walkers' "why did I get charged $34?", "what fees have I
// paid?", "can I get my bank fee waived?", unanswered on every pass from the fifth): a charge found
// by its amount, the fees paid as the pages count them (src/planning/bank-fees.ts), and the waiver
// as the dock's card says it. Pure.

export type FeeLine = {
  date: string;
  // Money out is positive, as the detection input has it.
  amountCents: number;
  description: string;
  merchantName: string | null;
  pfcDetailed: string | null;
  accountId: string;
};

// What kind of fee a line is, in words.
const FEE_KINDS: Record<string, string> = {
  BANK_FEES_OVERDRAFT_FEES: "an overdraft fee",
  BANK_FEES_INSUFFICIENT_FUNDS: "an insufficient funds fee",
  BANK_FEES_LATE_FEES: "a late fee",
  BANK_FEES_ATM_FEES: "an ATM fee",
  BANK_FEES_FOREIGN_TRANSACTION_FEES: "a foreign transaction fee",
  BANK_FEES_CASH_ADVANCE: "a cash advance fee",
};
const MONTHLY = /\b(?:monthly|maintenance|service charge|service fee|account fee)\b/i;
// The item an overdraft or a returned payment was for, as banks write it: "FOR A $16.40 ITEM".
const ITEM = /\bfor an? \$([\d,]+\.\d{2}) item\b/i;
// Asked without a day, a charge is looked for this far back.
const LOOK_BACK_DAYS = 120;

const feeKind = (t: FeeLine) =>
  FEE_KINDS[t.pfcDetailed ?? ""] ??
  (MONTHLY.test(t.description) ? "a monthly maintenance fee" : "a bank fee");

const isFee = (t: FeeLine, onCash: (accountId: string) => boolean) =>
  t.amountCents > 0 &&
  isBankFee({ description: t.description, pfc: t.pfcDetailed, onCash: onCash(t.accountId) });

// A merchant's name as the pages show it, never the bank's raw line.
const nameOf = (t: FeeLine) =>
  merchantOf({ merchantName: t.merchantName, description: t.description })?.name ?? null;

export type FeeContext = {
  asOf: string;
  lines: readonly FeeLine[];
  // Each account's name and whether it's checking or savings (a late fee there is a bill's).
  accounts: ReadonlyMap<string, { name: string; cash: boolean }>;
  // The dock's waiver card, when Jane raised one (fee_waiver_met): its explanation.
  waiver: { why: string; href: string } | null;
};

// "Why did I get charged $34?", "why was I charged $35 on Oct 28?", "why do I pay $12 every month?"
export function chargeReply(amountCents: number, day: string | null, ctx: FeeContext): Reply {
  const cash = (id: string) => ctx.accounts.get(id)?.cash ?? false;
  const from = day ? addDays(day, -1) : addDays(ctx.asOf, -LOOK_BACK_DAYS);
  const until = day ? addDays(day, 1) : ctx.asOf;
  const found = ctx.lines
    .filter((t) => t.amountCents === amountCents && t.date >= from && t.date <= until)
    .sort((a, b) => b.date.localeCompare(a.date));
  const money = formatCents(amountCents);
  const actions = [openLink("See your transactions", `/transactions?q=${amountCents / 100}`)];
  if (found.length === 0) {
    return {
      body: `I don't see a ${money} charge ${day ? `on ${dayLabel(day)}` : "in your last few months"}. If it's still pending, or on an account Jane can't see, it isn't here yet.`,
      actions,
      refs: {},
    };
  }
  const [latest] = found as [FeeLine, ...FeeLine[]];
  const account = ctx.accounts.get(latest.accountId)?.name ?? "your account";
  if (isFee(latest, cash)) {
    const item = ITEM.exec(latest.description)?.[1];
    const kind = feeKind(latest);
    const times =
      found.length > 1
        ? ` It's been charged ${found.length} times since ${dayLabel(found.at(-1)!.date)}.`
        : "";
    const ask = /overdraft|insufficient/.test(kind)
      ? " Banks often refund a first one if you ask."
      : "";
    const waiver = kind === "a monthly maintenance fee" && ctx.waiver ? ` ${ctx.waiver.why}` : "";
    return {
      body: `That's ${kind} on ${account}, ${dayLabel(latest.date)}${item ? `, for a $${item} item` : ""}.${times}${ask}${waiver}`,
      actions:
        ctx.waiver && waiver ? [openLink("See the bank's fee rules", ctx.waiver.href)] : actions,
      refs: {},
    };
  }
  const names = [...new Set(found.map((t) => nameOf(t) ?? "a charge"))];
  if (names.length > 1) {
    return {
      body: `More than one charge was ${money}: ${found
        .slice(0, 3)
        .map((t) => `${nameOf(t) ?? "a charge"} on ${dayLabel(t.date)}`)
        .join(", ")}.`,
      actions,
      refs: {},
    };
  }
  const times =
    found.length > 1
      ? ` It's been ${money} ${found.length} times since ${dayLabel(found.at(-1)!.date)}.`
      : "";
  return {
    body: `That's ${names[0]}, ${money} on ${dayLabel(latest.date)}, from ${account}.${times}`,
    actions,
    refs: {},
  };
}

// "What fees have I paid?", "how much did I pay in late fees?": the last twelve months' bank fees,
// counted as the pages count them.
export function feesPaidReply(late: boolean, months: number, ctx: FeeContext): Reply {
  const cash = (id: string) => ctx.accounts.get(id)?.cash ?? false;
  const since = addDays(ctx.asOf, -365);
  // Fees and the fees given back: a refunded fee doesn't count, as on the pages.
  const inWindow = ctx.lines
    .filter((t) => t.date > since && (!late || t.pfcDetailed === "BANK_FEES_LATE_FEES"))
    .map((t) => ({ ...t, pfc: t.pfcDetailed, onCash: cash(t.accountId) }))
    .filter((t) => isBankFee(t));
  const fees = inWindow.filter((t) => t.amountCents > 0);
  const period =
    months >= 12
      ? "the last 12 months"
      : months === 1
        ? "1 month of data"
        : `${months} months of data`;
  const actions = [openLink("See your spending", "/spending")];
  const year = bankFeesYear(inWindow, months);
  if (!year || fees.length === 0) {
    return {
      body: `I don't see ${late ? "a late fee" : "any bank fees"} in ${period}.`,
      actions,
      refs: {},
    };
  }
  const kinds = new Map<string, FeeLine[]>();
  for (const t of fees) kinds.set(feeKind(t), [...(kinds.get(feeKind(t)) ?? []), t]);
  const parts = [...kinds].map(([kind, list]) => {
    const total = formatCents(list.reduce((s, t) => s + t.amountCents, 0));
    const plural = kind.replace(/^an? /, "").replace(/fee$/, "fees");
    return list.length === 1
      ? `${kind.replace(/^an? /, "one ")} (${total}, ${dayLabel(list[0]!.date)})`
      : `${list.length} ${plural} (${total})`;
  });
  return {
    body: `You paid ${formatCents(year.seenCents)} in ${year.count === 1 ? "one fee" : `${year.count} fees`} in ${period}: ${parts.join(", ")}.`,
    actions,
    refs: {},
  };
}

// "Can I get my bank fee waived?": the waiver card's reason when Jane raised one, or what the fee is
// and who decides.
export function waiverReply(ctx: FeeContext): Reply {
  if (ctx.waiver) {
    return {
      body: ctx.waiver.why,
      actions: [openLink("See the bank's fee rules", ctx.waiver.href)],
      refs: {},
    };
  }
  const cash = (id: string) => ctx.accounts.get(id)?.cash ?? false;
  const monthly = ctx.lines
    .filter((t) => isFee(t, cash) && feeKind(t) === "a monthly maintenance fee")
    .sort((a, b) => b.date.localeCompare(a.date))[0];
  if (!monthly) {
    return {
      body: "I don't see a monthly bank fee to waive. For a one-off fee, like an overdraft, banks often refund a first one if you ask.",
      actions: [openLink("See your transactions", "/transactions")],
      refs: {},
    };
  }
  const account = ctx.accounts.get(monthly.accountId)?.name ?? "your account";
  return {
    body: `${account} charged a ${formatCents(monthly.amountCents)} monthly fee on ${dayLabel(monthly.date)}. Banks usually waive it with a set direct deposit or balance, but I don't know your account's rules, so ask your bank which applies to yours.`,
    actions: [openLink("See your transactions", "/transactions")],
    refs: {},
  };
}
