import {
  FORECAST_DAYS,
  FORECAST_SUBTYPES,
  OWN_MOVE_DAYS,
  PAYMENT_TRANSFERS,
} from "@/config/detection";
import {
  balanceDay,
  staleBalanceFrom,
  expectedBetween,
  irregularDue,
  nextUnevenPayBy,
  scheduledTransfers,
  scheduledTransfersIn,
  unevenPay,
  unevenPayMonths,
  upcomingBills,
  type Expected,
} from "@/detection/forecast";
import { addDays, daysBetween } from "@/detection/units";
import { expectedPaydays, missedPaydays, type Payday } from "@/detection/paydays";
import type { DetectionInput } from "@/detection/types";
import type { PayDue } from "@/planning/pay-due";
import type { SinceStatement } from "@/planning/since-statement";

// "Safe to spend until payday": checking balance today, minus regular bills and regular moves
// out (to savings, or a Zelle that may be rent) from checking before the next expected deposit, minus what's left in this month's budgets,
// minus this month's amounts toward goals, minus this month's set-aside for yearly bills
// (spec step 70). Each part comes from the page that shows it (bills forecast, budgets,
// goals), so the number reconciles with them. Math only.

// The tax left to cover, as src/lib/tax-set-aside.ts works it out.
export type SafeTax = {
  holdCents: number;
  status: "needed" | "covered" | "unknown" | "no_income";
  keptApartCents: number;
  confidencePercent: number;
};

export type SafeToSpend = {
  // The next expected paycheck after today, or null when none is expected in the forecast window.
  payday: string | null;
  // Pay due today, or due a day ago and still expected, not in checking yet: counted in safeCents
  // (as bills due today are), never in balanceCents.
  payDue: PayDue[];
  // Pay that didn't come in once the wait ran out: not counted, said so.
  payMissed: PayDue[];
  balanceCents: number;
  // What balanceCents adds to a statement's balance for the pay and bills expected since its day
  // (the earliest, with more than one); null when it's the balance as it stands.
  sinceStatement: SinceStatement | null;
  bills: Expected[];
  billsCents: number;
  budgetsLeftCents: number;
  goalsCents: number;
  setAsideCents: number;
  // Tax on the income so far not yet withheld or paid (src/planning/tax-set-aside.ts): all of it, and
  // as much as the money left can hold. It isn't due before payday, so it takes the number to zero
  // but never makes it "short".
  taxSoFarCents: number;
  taxHeldCents: number;
  taxStatus: SafeTax["status"];
  taxKeptApartCents: number;
  taxConfidencePercent: number;
  safeCents: number;
  // About what comes in a month into checking with no payday to count it on; not in safeCents.
  unevenPayMonthlyCents: number | null;
  // The months that figure is over (unevenPayMonths), which Home says beside it.
  unevenPayMonths: number | null;
  // Checking accounts with no balance on file: neither their money nor their bills are counted.
  leftOut: string[];
};

export function safeToSpend(
  input: DetectionInput,
  {
    budgetsLeftCents,
    goalsCents,
    setAsideCents = 0,
    tax = { holdCents: 0, status: "no_income", keptApartCents: 0, confidencePercent: 0 },
  }: {
    budgetsLeftCents: number;
    goalsCents: number;
    setAsideCents?: number;
    tax?: SafeTax;
  },
): SafeToSpend {
  const checking = input.accounts.filter(
    (a) =>
      a.type === "depository" &&
      FORECAST_SUBTYPES.includes(a.subtype ?? "") &&
      a.currentBalanceCents !== null &&
      // Too old to walk forward (a bank signed out for weeks, an old statement): it isn't today's.
      staleBalanceFrom(a, input.asOf) === null,
  );
  const checkingIds = new Set(checking.map((a) => a.id));
  // Today's balance: an uploaded statement's, walked forward with what was due since, as the
  // forecast does (debugger 10-31).
  const walked = checking.map((a) => {
    const from = balanceDay(a, input.asOf);
    return { from, cents: expectedBetween(input, a.id, from, input.asOf) };
  });
  const sinceCents = walked.reduce((sum, w) => sum + w.cents, 0);
  const balance = checking.reduce((sum, a) => sum + (a.currentBalanceCents ?? 0), 0) + sinceCents;
  const sinceFrom = walked
    .filter((w) => w.cents !== 0)
    .map((w) => w.from)
    .sort()[0];

  // The next paycheck (spec step 182): payroll deposits only, never interest or a refund. Pay due
  // today that hasn't come in counts today, as a bill due today does, and safe to spend runs to
  // the payday after it (phone debugger, 11-20: "until Dec 4: $1,150" left out Nov 20's $1,650).
  const paydays = expectedPaydays(input, addDays(input.asOf, FORECAST_DAYS));
  // Only the share paid into checking: pay split with savings isn't all spendable.
  const intoChecking = (p: Payday): PayDue[] => {
    const cents = p.shares
      .filter((s) => checkingIds.has(s.accountId))
      .reduce((n, s) => n + s.amountCents, 0);
    return cents > 0 ? [{ employer: p.employer, cents, dueOn: p.dueOn }] : [];
  };
  const payDue = paydays.filter((p) => p.date === input.asOf).flatMap(intoChecking);
  const payDueCents = payDue.reduce((sum, p) => sum + p.cents, 0);
  // The next payday into an account counted here: another account's earlier one isn't this one's.
  const payday =
    paydays.find((p) => p.date > input.asOf && p.shares.some((s) => checkingIds.has(s.accountId)))
      ?.date ?? null;
  // Without one, pay that comes every week or two is still likely before a month's bills are due
  // (debugger 11-03: "Short $1,303" for a driver DoorDash pays each week).
  const until = payday ?? nextUnevenPayBy(input, [...checkingIds]);

  // Bills and regular moves out that may be payments to others (Zelle, Venmo, "transfer to")
  // from checking up to the day before payday (or across the window without one), as the
  // forecast takes them out (debugger 10-30: rent sent by Zelle left checking in the forecast but
  // not here, so safe to spend was $1,400 too high). Not moves to savings, investments or cash:
  // a goal's monthly amount already holds those back. Not a move into another of the person's
  // checking accounts: it's still in checking (review 10-31).
  const arriving = scheduledTransfersIn(input, FORECAST_DAYS).filter(
    (t) => t.accountId !== null && checkingIds.has(t.accountId),
  );
  const toOwnChecking = (t: Expected) =>
    arriving.some(
      (a) =>
        a.accountId !== t.accountId &&
        a.amountCents === t.amountCents &&
        Math.abs(daysBetween(a.date, t.date)) <= OWN_MOVE_DAYS,
    );
  const bills = [
    ...upcomingBills(input, FORECAST_DAYS),
    // A bill that comes twice a year or less, due before payday: the whole of it, not this month's
    // slice of the set-aside (debugger 11-02: $6,259 "safe" with $2,210.50 due the day before payday).
    ...irregularDue(input, FORECAST_DAYS),
    ...scheduledTransfers(input, FORECAST_DAYS, PAYMENT_TRANSFERS).filter((t) => !toOwnChecking(t)),
  ]
    .sort((a, b) => a.date.localeCompare(b.date) || a.merchant.localeCompare(b.merchant))
    .filter(
      (b) =>
        b.accountId !== null &&
        checkingIds.has(b.accountId) &&
        // Due today counts: one that has posted already moved the next date on, so a bill dated
        // today is still to come out (phone walk: an evening in the US is the next day in UTC,
        // and tomorrow's card payment dropped out, raising safe to spend by $1,640).
        b.date >= input.asOf &&
        (until === null || b.date < until),
    );
  const billsCents = bills.reduce((sum, b) => sum + b.amountCents, 0);
  const setAside = Math.max(
    0,
    setAsideCents - bills.reduce((sum, b) => sum + (b.setAsideCents ?? 0), 0),
  );
  const beforeTax = balance + payDueCents - billsCents - budgetsLeftCents - goalsCents - setAside;
  const taxSoFarCents = tax.holdCents;
  const taxHeldCents = Math.min(taxSoFarCents, Math.max(0, beforeTax));
  return {
    payday,
    payDue,
    payMissed: missedPaydays(input).flatMap(intoChecking),
    balanceCents: balance,
    sinceStatement:
      sinceFrom === undefined || sinceCents === 0 ? null : { day: sinceFrom, cents: sinceCents },
    bills,
    billsCents,
    budgetsLeftCents,
    goalsCents,
    setAsideCents: setAside,
    taxSoFarCents,
    taxHeldCents,
    taxStatus: tax.status,
    taxKeptApartCents: tax.keptApartCents,
    taxConfidencePercent: tax.confidencePercent,
    safeCents: beforeTax - taxHeldCents,
    unevenPayMonthlyCents:
      checking.reduce((sum, a) => sum + (unevenPay(input, a.id, [...checkingIds]) ?? 0), 0) || null,
    unevenPayMonths:
      Math.max(
        0,
        ...checking.flatMap((a) =>
          unevenPay(input, a.id, [...checkingIds]) === null ? [] : [unevenPayMonths(input, a.id)],
        ),
      ) || null,
    leftOut: input.accounts
      .filter(
        (a) =>
          a.type === "depository" &&
          FORECAST_SUBTYPES.includes(a.subtype ?? "") &&
          (a.currentBalanceCents === null || staleBalanceFrom(a, input.asOf) !== null),
      )
      .map((a) => a.name),
  };
}
