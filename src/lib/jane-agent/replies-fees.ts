import { addDays } from "@/lib/dates";
import { dayLabel } from "@/lib/day-label";
import { formatCents } from "@/lib/money";
import { merchantOf } from "@/detection/streams";
import { FEE_LIST_PATH } from "@/detectors/bank-fees-of";
import { bankFeesYear, feeKindOf, isBankFee } from "@/planning/bank-fees";
import type { Reply } from "./replies";
import { openLink } from "./types";

// The backup chat's fee answers (the walkers' "why did I get charged $34?", "what fees have I
// paid?", "can I get my bank fee waived?", unanswered on every pass from the fifth): a charge found
// by its amount, the fees paid as the pages count them (src/planning/bank-fees.ts), and the waiver
// as the dock's card says it. Each opens the fee list (FEE_LIST_PATH), as the card does since #2222:
// Insights and Spending list categories, not the fees an answer names. Pure.

export type FeeLine = {
  date: string;
  // Money out is positive, as the detection input has it.
  amountCents: number;
  description: string;
  merchantName: string | null;
  pfcDetailed: string | null;
  accountId: string;
};

// The item an overdraft or a returned payment was for, as banks write it: "FOR A $16.40 ITEM".
const ITEM = /\bfor an? \$([\d,]+\.\d{2}) item\b/i;
// Asked without a day, a charge is looked for this far back.
const LOOK_BACK_DAYS = 120;

const feeKind = (t: FeeLine) => feeKindOf({ description: t.description, pfc: t.pfcDetailed });

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
  // A purchase of the same amount beside a fee: which one was meant is for the person to say,
  // before either is named.
  const feeCount = found.filter((t) => isFee(t, cash)).length;
  if (feeCount > 0 && feeCount < found.length) {
    return {
      body: `More than one charge was ${money}: ${found
        .slice(0, 3)
        .map(
          (t) =>
            `${isFee(t, cash) ? feeKind(t) : (nameOf(t) ?? "a charge")} on ${dayLabel(t.date)}`,
        )
        .join(", ")}.`,
      actions,
      refs: {},
    };
  }
  const [latest] = found as [FeeLine, ...FeeLine[]];
  const account = ctx.accounts.get(latest.accountId)?.name ?? "your account";
  if (isFee(latest, cash)) {
    const item = ITEM.exec(latest.description)?.[1];
    const kind = feeKind(latest);
    // Repeats are the same kind of fee on the same account, not any charge of the amount.
    const same = found.filter((t) => feeKind(t) === kind && t.accountId === latest.accountId);
    // The first time it was charged: a calendar day, not a moment.
    const sameFirstDay = same[same.length - 1]!.date;
    const times =
      same.length > 1
        ? ` It's been charged ${same.length} times since ${dayLabel(sameFirstDay)}.`
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
  // The first time it was charged: a calendar day, not a moment.
  const firstDay = found[found.length - 1]!.date;
  const times =
    found.length > 1
      ? ` It's been ${money} ${found.length} times since ${dayLabel(firstDay)}.`
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
  const year = bankFeesYear(inWindow, months);
  // The fees the headline counts (a fee given back, and the refund that paid it, are both left
  // out) and the refunds it takes off that are not paired with a fee.
  const counted = new Set<unknown>(year?.lines ?? []);
  const fees = inWindow.filter((t) => t.amountCents > 0 && counted.has(t));
  const givenBack = (year?.lines ?? [])
    .filter((t) => t.amountCents < 0)
    .reduce((sum, t) => sum - t.amountCents, 0);
  const period =
    months >= 12
      ? "the last 12 months"
      : months === 1
        ? "1 month of data"
        : `${months} months of data`;
  const actions = [openLink("See the fees", FEE_LIST_PATH)];
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
  if (givenBack > 0) parts.push(`less ${formatCents(givenBack)} given back`);
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
      actions: [openLink("See the fees", FEE_LIST_PATH)],
      refs: {},
    };
  }
  const account = ctx.accounts.get(monthly.accountId)?.name ?? "your account";
  return {
    body: `${account} charged a ${formatCents(monthly.amountCents)} monthly fee on ${dayLabel(monthly.date)}. Banks usually waive it with a set direct deposit or balance, but I don't know your account's rules, so ask your bank which applies to yours.`,
    actions: [openLink("See the fees", FEE_LIST_PATH)],
    refs: {},
  };
}

// Money given back for a fee, as banks write it ("OVERDRAFT FEE REVERSAL", "FEE REFUND", "MAINT
// FEE CREDIT"), or any money in that the bank files as a fee.
const GIVEN_BACK = /\b(?:revers\w*|refund\w*|credit\w*|waived|rebate)\b/i;
const FEE_WORD = /\b(?:fees?|charges?)\b/i;

// "Did my fee get refunded?", "which fees were removed?": a question of fact, answered from the
// lines (manager 11-23: the waiver route had taken them, and gave its rule). Each fee given back,
// when, how much, and the fee it was for when one of that amount was charged on the same account in
// the FEE_REVERSAL_DAYS before; or that none was, with what was charged.
export function refundsReply(ctx: FeeContext, reversalDays: number): Reply {
  const cash = (id: string) => ctx.accounts.get(id)?.cash ?? false;
  const fees = ctx.lines.filter((t) => isFee(t, cash));
  const back = ctx.lines
    .filter(
      (t) =>
        t.amountCents < 0 &&
        ((t.pfcDetailed ?? "").startsWith("BANK_FEES") ||
          (FEE_WORD.test(t.description) && GIVEN_BACK.test(t.description))),
    )
    .sort((a, b) => a.date.localeCompare(b.date));
  const seeFees = [openLink("See the fees", FEE_LIST_PATH)];
  if (back.length === 0) {
    const charged = fees.reduce((s, t) => s + t.amountCents, 0);
    return {
      body:
        fees.length === 0
          ? "I don't see any bank fees, or any given back, in your accounts."
          : `I don't see a fee given back in your accounts. They show ${formatCents(charged)} in ${fees.length === 1 ? "one fee" : `${fees.length} fees`} charged, the latest on ${dayLabel(fees[fees.length - 1]!.date)}.`,
      actions: seeFees,
      refs: {},
    };
  }
  const used = new Set<FeeLine>();
  const lines = back.slice(-4).map((r) => {
    const fee = fees.find(
      (f) =>
        !used.has(f) &&
        f.accountId === r.accountId &&
        f.amountCents === -r.amountCents &&
        f.date <= r.date &&
        f.date >= addDays(r.date, -reversalDays),
    );
    if (fee) used.add(fee);
    const account = ctx.accounts.get(r.accountId)?.name ?? "your account";
    return `${formatCents(-r.amountCents)} back on ${dayLabel(r.date)} on ${account}${
      fee ? `, for ${feeKind(fee)} of that amount on ${dayLabel(fee.date)}` : ""
    }`;
  });
  return {
    body: `${back.length === 1 ? "One fee was given back" : `${back.length} fees were given back`}: ${lines.join("; ")}.`,
    actions: seeFees,
    refs: {},
  };
}

// The amount of the latest fee the bank charged, null with none: what "why am I paying fees?" is
// about when it names no amount.
// `named`, the kind of fee asked about ("overdraft"), picks the latest of that kind when there is one.
export function latestFeeCents(ctx: FeeContext, named: string | null = null): number | null {
  const cash = (id: string) => ctx.accounts.get(id)?.cash ?? false;
  const fees = ctx.lines.filter((t) => isFee(t, cash)).sort((a, b) => a.date.localeCompare(b.date));
  const word = named === "nsf" ? "insufficient" : named;
  const ofKind = word
    ? fees.filter((t) => `${feeKind(t)} ${t.description}`.toLowerCase().includes(word))
    : [];
  return (ofKind.at(-1) ?? fees.at(-1))?.amountCents ?? null;
}
