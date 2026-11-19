import {
  BILL_GAP,
  CARD_VS_CASH,
  FEDERAL_LOANS as F,
  NOT_STANFORD_UNIVERSITY,
  OPPORTUNITY_FUND,
  STANFORD_BILL,
  STANFORD_BILL_WORDS,
  STANFORD_GRAD_ADVANCE,
  STANFORD_MIN_LINES,
  STANFORD_PAYMENT_PLAN,
  STANFORD_WORDS,
} from "@/config/student-money";
import { addDays, addMonths, daysBetween } from "@/lib/dates";
import { dayLabel } from "@/lib/day-label";
import { formatCents, formatWholeDollars } from "@/lib/money";
import { formatRate } from "@/lib/percent";
import { dataEnd } from "@/detection/helpers";
import type { ProfileInput, ProfileTx } from "@/profile/build";
import { type Detector, suggestion } from "./contract";
import {
  cashKnown,
  cushionSpendCents,
  evidence,
  factEvidence,
  headlineOf,
  liquidCents,
  reportsWorth,
  weakest,
} from "./helpers";

// Money a student needs to see ahead of time (suggest-money lane, 11-18): a bill the cash and the
// usual money coming in won't cover, with the ways to cover it cheapest first; Stanford's own bill
// dates; and card interest paid while cash sits. Facts and official pages, no lender named and no
// pick, so they show on real accounts. Every figure is in src/config/student-money.ts with where
// it was read. Pure; see ./contract.ts.

type Data = ProfileInput;

const lineOf = (t: ProfileTx) => `${t.merchantName ?? ""} ${t.description}`.toUpperCase();

// Lines that name Stanford University (its bill, its pay, its campus), not its hospital or credit
// union. A student with a few of these is a Stanford student; anyone else gets no Stanford fact.
export function atStanford(data: Pick<Data, "transactions">): boolean {
  const lines = data.transactions.filter((t) => {
    const line = lineOf(t);
    return STANFORD_WORDS.test(line) && !NOT_STANFORD_UNIVERSITY.test(line);
  });
  return lines.length >= STANFORD_MIN_LINES;
}

// The data must reach close to today: a forecast from an old statement's balance says nothing
// about now (upload S7's statement ended four weeks before today). 17 days past an upload's last
// line, as 10 past where its statement closed was before an upload reached its last line (reachOf).
const FRESH_DAYS = 17;
const fresh = (data: Data) =>
  daysBetween(dataEnd(data.transactions, data.today), data.today) <= FRESH_DAYS;

// Payments to Stanford's student bill, newest first.
function billPayments(data: Data): ProfileTx[] {
  const since = addDays(data.today, -BILL_GAP.billSeenDays);
  return data.transactions
    .filter(
      (t) =>
        t.amountCents >= BILL_GAP.billMinCents &&
        t.date >= since &&
        t.date <= data.today &&
        STANFORD_BILL_WORDS.test(lineOf(t)),
    )
    .sort((a, b) => b.date.localeCompare(a.date));
}

// The next Stanford due date after today, for undergraduates (the earlier list) and graduates.
const nextDue = (today: string, list: readonly string[]) => list.find((d) => d > today) ?? null;

// Cash accounts: what pays a bill.
const cashIds = (data: Data) =>
  new Set(data.accounts.filter((a) => a.type === "depository").map((a) => a.id));

// What moves between the person's own accounts isn't money in or out.
const OWN_MOVE = /^TRANSFER_(?:IN|OUT)_(?:SAVINGS|INVESTMENT_AND_RETIREMENT_FUNDS)$/;
const OWN_WORDS =
  /\b(?:SAVINGS|SAV|CHECKING|CHK)\b.*\bTRANSFER\b|\bTRANSFER\b.*\b(?:SAVINGS|SAV|CHECKING|CHK)\b/;

// Money in and out of cash, a day, over the last stretch of data (at most 60 days, at least 21).
function cashPace(data: Data, leaveOut: (t: ProfileTx) => boolean) {
  const cash = cashIds(data);
  const end = dataEnd(data.transactions, data.today);
  const first = data.transactions.reduce((m, t) => (t.date < m ? t.date : m), end);
  const days = Math.min(60, daysBetween(first, end) + 1);
  if (days < 21) return null;
  const since = addDays(end, -days);
  let inCents = 0;
  let outCents = 0;
  for (const t of data.transactions) {
    if (!cash.has(t.accountId) || t.date <= since || t.date > end) continue;
    if (OWN_MOVE.test(t.pfc ?? "") || OWN_WORDS.test(lineOf(t)) || leaveOut(t)) continue;
    if (t.amountCents < 0) inCents -= t.amountCents;
    else outCents += t.amountCents;
  }
  return { inPerDay: inCents / days, outPerDay: outCents / days, days };
}

type Bill = { what: string; day: string; cents: number; stanford: boolean; txs: ProfileTx[] };

// The bill coming: Stanford's next due date if the person pays the bill themselves, else the next
// rent, inside the window. Rent is the latest rent payment, a month on.
function billAhead(data: Data): Bill | null {
  const paid = billPayments(data);
  if (paid.length > 0) {
    const day = nextDue(data.today, STANFORD_BILL.dueDates.undergraduate);
    if (day && daysBetween(data.today, day) <= BILL_GAP.aheadDays) {
      return { what: "Stanford bill", day, cents: paid[0]!.amountCents, stanford: true, txs: paid };
    }
  }
  const cash = cashIds(data);
  const rents = data.transactions
    .filter(
      (t) =>
        t.pfc === "RENT_AND_UTILITIES_RENT" &&
        t.amountCents >= BILL_GAP.billMinCents &&
        cash.has(t.accountId) &&
        t.date <= data.today,
    )
    .sort((a, b) => b.date.localeCompare(a.date));
  const latest = rents[0];
  if (!latest) return null;
  const day = addMonths(latest.date, 1);
  const ahead = daysBetween(data.today, day);
  if (ahead < 0 || ahead > BILL_GAP.aheadDays) return null;
  return { what: "rent", day, cents: latest.amountCents, stanford: false, txs: rents };
}

// The ways to cover a gap, cheapest first, each with its page: what the school offers that costs
// nothing, then federal loans, then the fact that private loans exist. No lender, no pick.
function waysToCover(bill: Bill, stanford: boolean, today: string) {
  const ways: string[] = [];
  const more: { label: string; href: string }[] = [];
  if (stanford) {
    const plan = STANFORD_PAYMENT_PLAN.windows.find((w) => w.to >= today);
    if (bill.stanford && plan && daysBetween(today, plan.from) <= BILL_GAP.aheadDays) {
      ways.push(
        `Stanford's undergraduate payment plan is free and splits a quarter's bill into three monthly parts; sign-up for ${plan.quarter} runs ${dayLabel(plan.from)} to ${dayLabel(plan.to)}.`,
      );
      more.push({ label: "Stanford payment plans", href: STANFORD_PAYMENT_PLAN.url });
    }
    const fund = OPPORTUNITY_FUND.windows.find((w) => w.from <= today && w.to >= today);
    if (fund) {
      ways.push(
        `Stanford's Opportunity Fund gives grants to undergraduates whose parent contribution is ${formatWholeDollars(OPPORTUNITY_FUND.parentContributionMaxCents)} or less; its ${fund.term} window closes ${dayLabel(fund.to)}.`,
      );
      more.push({ label: "The Opportunity Fund", href: OPPORTUNITY_FUND.url });
    }
    ways.push(
      `Graduate students can take a cash advance of ${formatWholeDollars(STANFORD_GRAD_ADVANCE.minCents)} to ${formatWholeDollars(STANFORD_GRAD_ADVANCE.maxCents)} a quarter on funding they expect, repaid within ${STANFORD_GRAD_ADVANCE.repayDays} days.`,
    );
    more.push({ label: "Stanford cash advances", href: STANFORD_GRAD_ADVANCE.url });
  }
  const [first, , third] = F.dependentLimits;
  ways.push(
    `Federal Direct Loans for 2026-27 are fixed at ${formatRate(F.undergradRateBps)} for undergraduates (${formatWholeDollars(first!.cents)} to ${formatWholeDollars(third!.cents)} a year for a dependent student) and ${formatRate(F.gradRateBps)} for graduate students (up to ${formatWholeDollars(F.gradUnsubsidizedCents)} a year), with a ${F.directFeeBps / 100}% fee; your financial aid office sets the amount.`,
  );
  more.push({ label: "Federal loan rates", href: F.ratesUrl });
  ways.push(
    "Private student loans also exist; they aren't federal, and each lender sets its own terms.",
  );
  return { ways, more };
}

const billGapAhead: Detector = {
  capability: "safe_to_spend",
  topic: "bill_gap_ahead",
  covers: ["tight_money"],
  needs: ["is_student"],
  detect({ profile, data }) {
    const student = profile.facts.is_student;
    if (student.value !== true || !cashKnown(data) || !fresh(data)) return null;
    const bill = billAhead(data);
    if (!bill) return null;
    const pace = cashPace(data, (t) => bill.txs.includes(t));
    if (!pace) return null;
    const days = daysBetween(data.today, bill.day);
    const cash = liquidCents(data);
    const comingIn = Math.round(pace.inPerDay * days);
    const goingOut = Math.round(pace.outPerDay * days);
    const gap = bill.cents - (cash + comingIn - goingOut);
    if (gap < BILL_GAP.minGapCents) return null;
    const stanford = atStanford(data);
    const due = dayLabel(bill.day, { long: true });
    const { ways, more } = waysToCover(bill, stanford, data.today);
    const what = bill.stanford ? "your Stanford bill" : "rent";
    return suggestion("safe_to_spend", "bill_gap_ahead", {
      title: `Plan how to cover ${what} on ${due}: you're about ${formatCents(gap)} short`,
      headline: headlineOf(
        `Plan for ${bill.stanford ? "your bill" : "rent"} on ${dayLabel(bill.day)}`,
        gap,
        "risk",
      ),
      short: `${formatCents(bill.cents)} due ${dayLabel(bill.day)}; you'll have about ${formatCents(bill.cents - gap)}.`,
      worthCents: gap,
      worthKind: "risk",
      confidence: weakest([
        factEvidence(student),
        evidence(
          "seen",
          profile.months,
          bill.txs.length,
          bill.stanford ? "bill payments" : "rent payments",
        ),
      ]),
      urgency: days <= 14 ? "now" : "soon",
      why: `Your last ${bill.stanford ? "Stanford bill payment" : "rent"} was ${formatCents(bill.cents)}, and the next is due ${due}${bill.stanford ? " for undergraduates (graduate students' next is January 20)" : ""}. You hold ${formatCents(cash)} in cash; at your pace over the last ${pace.days} days about ${formatCents(comingIn)} comes in and ${formatCents(goingOut)} goes out before then, leaving about ${formatCents(gap)} short. Ways to cover it, cheapest first: ${ways.join(" ")}`,
      action: { label: "Plan a tight month", href: "/loans/tight" },
      more,
    });
  },
};

// Stanford's bill, for an undergraduate who pays it themselves: the next due date, the late charge
// and, while sign-up is open, the free plan that splits it into three. Only while a payment plan
// window is open or about to be.
// The plan's sign-up window open now or within two weeks.
const planWindowNear = (today: string) => {
  const plan = STANFORD_PAYMENT_PLAN.windows.find((w) => w.to >= today);
  return plan && daysBetween(today, plan.from) <= 14 ? plan : null;
};

// A Stanford student whose bill isn't paid from these accounts, while the plan's sign-up is near:
// whether they pay it is theirs to say (the question in src/config/questions.ts).
export function payingBillUnknown(
  profile: Parameters<Detector["detect"]>[0]["profile"],
  data: Data,
): boolean {
  return (
    profile.facts.is_student.value === true &&
    atStanford(data) &&
    billPayments(data).length === 0 &&
    planWindowNear(data.today) !== null
  );
}

const stanfordBillDue: Detector = {
  capability: "safe_to_spend",
  topic: "stanford_bill_due",
  covers: [],
  needs: ["is_student", "pays_school_bill"],
  detect({ profile, data }) {
    const student = profile.facts.is_student;
    if (student.value !== true || !atStanford(data)) return null;
    const paid = billPayments(data);
    const told = profile.facts.pays_school_bill;
    // No payment in these accounts: only for someone who says they pay it.
    if (paid.length === 0 && told.value !== true) return null;
    // Two payments about a month apart: already paying in parts (the plan, or by hand).
    const [latest, before] = paid;
    if (before && daysBetween(before.date, latest!.date) <= BILL_GAP.monthlyGapDays) return null;
    const plan = planWindowNear(data.today);
    if (!plan) return null;
    const due = nextDue(plan.to, STANFORD_BILL.dueDates.undergraduate);
    if (!due) return null;
    const last = latest?.amountCents ?? null;
    const late = last === null ? 0 : Math.round((last * STANFORD_BILL.lateBpsPerMonth) / 10_000);
    const graduate = paidByStanford(data)
      ? " Graduate students can't use this plan; one on an assistantship can pay the bill from their pay over several months on Stanford's Payroll Deduction Plan instead."
      : "";
    const rules = `For undergraduates, Stanford's payment plan is free and splits a quarter's bill into three monthly parts paid automatically from your bank; ${plan.quarter} sign-up runs ${dayLabel(plan.from)} to ${dayLabel(plan.to)}, and the first part is due ${dayLabel(due, { long: true })}. It's for an enrolled undergraduate with a US bank account and no balance left from an earlier term.`;
    const steps = `To do it: sign in to Axess, open My Finances, then View & Pay My Bill, and choose the payment plan.${graduate}`;
    return suggestion("safe_to_spend", "stanford_bill_due", {
      title: `Split your ${plan.quarter} Stanford bill into three free payments: sign up by ${dayLabel(plan.to, { long: true })}`,
      headline: headlineOf("Pay your Stanford bill in three parts", late, "risk"),
      short:
        last === null
          ? `You pay your Stanford bill; ${plan.quarter} plan sign-up runs ${dayLabel(plan.from)} to ${dayLabel(plan.to)}.`
          : `You paid ${formatCents(last)} at once; in three parts that's about ${formatCents(Math.round(last / 3))} a month.`,
      worthCents: late,
      worthKind: "risk",
      confidence: weakest([
        factEvidence(student),
        last === null
          ? factEvidence(told)
          : evidence("seen", profile.months, paid.length, "Stanford bill payments"),
      ]),
      urgency: daysBetween(data.today, plan.to) <= 10 ? "now" : "soon",
      why:
        last === null
          ? `You told me you pay your Stanford bill. ${rules} Whatever isn't paid by a due date is charged ${formatRate(STANFORD_BILL.lateBpsPerMonth)} a month and can bring a hold on registering. ${steps}`
          : `You paid Stanford ${formatCents(last)} on ${dayLabel(latest!.date)}. ${rules} Whatever isn't paid by a due date is charged ${formatRate(STANFORD_BILL.lateBpsPerMonth)} a month (about ${formatCents(late)} a month on a bill like your last) and can bring a hold on registering. ${steps}`,
      action: { label: "See Stanford's payment plans", href: STANFORD_PAYMENT_PLAN.url },
      more: [{ label: "Stanford's billing dates", href: STANFORD_BILL.url }],
    });
  },
};

// Pay from Stanford University: a student worker or an assistant, who may be a graduate student.
const paidByStanford = (data: Data) =>
  data.transactions.some(
    (t) =>
      t.amountCents < 0 &&
      (t.pfc ?? "").startsWith("INCOME") &&
      STANFORD_WORDS.test(lineOf(t)) &&
      !NOT_STANFORD_UNIVERSITY.test(lineOf(t)),
  );

// Card interest while cash sits: the cash beyond a month's spending would clear the card, and the
// card costs far more than cash earns. The card_interest card steps aside when this one applies
// (the same money, ./money.ts).
export function cashClearsCard(data: Data): {
  owedCents: number;
  clearCents: number;
  keepCents: number;
  aprBps: number | null;
  interestCents: number;
  charges: number;
} | null {
  if (!cashKnown(data) || !fresh(data)) return null;
  const cards = data.accounts.filter((a) => a.type === "credit" && a.balanceKnown !== false);
  const owed = cards.reduce((s, a) => s + Math.max(0, Math.abs(a.balanceCents)), 0);
  if (owed <= 0) return null;
  const ids = new Set(cards.map((a) => a.id));
  const since = addDays(data.today, -120);
  const charges = data.transactions.filter(
    (t) =>
      t.pfc === "BANK_FEES_INTEREST_CHARGE" &&
      t.amountCents > 0 &&
      t.date >= since &&
      t.date <= data.today &&
      ids.has(t.accountId),
  );
  if (charges.length === 0) return null;
  const keep = Math.max(CARD_VS_CASH.keepFloorCents, cushionSpendCents(data));
  const clear = Math.min(owed, liquidCents(data) - keep);
  if (clear < CARD_VS_CASH.minClearCents) return null;
  const aprs = data.liabilities
    .filter((l) => ids.has(l.accountId) && typeof l.aprBps === "number" && l.aprBps > 0)
    .map((l) => l.aprBps!);
  const aprBps = aprs.length > 0 ? Math.max(...aprs) : null;
  // A year of interest on what cash could clear: at the card's rate when the bank says it, else
  // the charges seen, at a year's pace, for the share cleared.
  // The report's yearly figure when it has one, so the dock and the report say one (gate B;
  // debugger 11-18: "stops about $396.87 a year" beside the report's "$339.24 a year").
  const first = charges.reduce((m, t) => (t.date < m ? t.date : m), data.today);
  const spanDays = Math.max(30, daysBetween(first, data.today) + 15);
  const seenYear =
    reportsWorth(data, "card_interest") ??
    Math.round((charges.reduce((s, t) => s + t.amountCents, 0) * 365) / spanDays);
  const interest =
    aprBps !== null ? Math.round((clear * aprBps) / 10_000) : Math.round((seenYear * clear) / owed);
  return {
    owedCents: owed,
    clearCents: clear,
    keepCents: keep,
    aprBps,
    interestCents: interest,
    charges: charges.length,
  };
}

const cardFromCash: Detector = {
  capability: "debt",
  topic: "card_from_cash",
  covers: ["card_interest"],
  needs: [],
  detect({ profile, data }) {
    const c = cashClearsCard(data);
    if (!c || c.interestCents <= 0) return null;
    const all = c.clearCents >= c.owedCents;
    const cash = liquidCents(data);
    return suggestion("debt", "card_from_cash", {
      title: all
        ? "Pay off your card from the cash you hold: it charges interest while the cash earns little"
        : "Pay part of your card from the cash you hold: it charges interest while the cash earns little",
      headline: headlineOf(
        all ? "Pay off your card from cash" : "Pay down your card from cash",
        c.interestCents,
        "saves",
      ),
      short: `You owe ${formatCents(c.owedCents)} on cards and hold ${formatCents(cash)} in cash.`,
      worthCents: c.interestCents,
      worthKind: "saves",
      confidence: evidence("seen", profile.months, c.charges, "interest charges"),
      urgency: "soon",
      why: `Your cards charged interest ${c.charges} time${c.charges === 1 ? "" : "s"} lately and hold ${formatCents(c.owedCents)}${c.aprBps !== null ? ` at ${formatRate(c.aprBps)}` : ""}. You hold ${formatCents(cash)} in checking and savings. Keeping ${formatCents(c.keepCents)} back (about a month of spending), ${formatCents(c.clearCents)} could go to the card${all ? " and clear it" : ""}, which stops about ${formatCents(c.interestCents)} a year of interest; a savings account pays far less than that. To do it: from your bank or the card's app, pay ${formatCents(c.clearCents)} to the card before its statement closes, then pay each new statement in full.`,
      action: { label: "Cut your card interest", href: "/loans/interest" },
      watch: {
        kind: "fee_stops",
        pfcs: ["BANK_FEES_INTEREST_CHARGE"],
        monthlyCents: Math.round(c.interestCents / 12),
      },
    });
  },
};

export const STUDENT_MONEY_DETECTORS: readonly Detector[] = [
  billGapAhead,
  stanfordBillDue,
  cardFromCash,
];
