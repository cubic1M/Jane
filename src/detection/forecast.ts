import { cardPaymentNameFromWords } from "@/categorize/card-payments";
import {
  FORECAST_SUBTYPES,
  NOT_BILL_CATEGORIES,
  NOT_BILL_HABIT_FREQUENCIES,
  NOT_BILL_HABIT_PRIMARIES,
  OWN_ACCOUNT_TRANSFERS,
} from "@/config/detection";
import { expectedPaydays, isPaycheck } from "./paydays";
import {
  buildStreams,
  detectRecurring,
  fromPlaidStream,
  isSubscriptionBox,
  type Stream,
} from "./streams";
import type { DetectionAccount, DetectionInput, DetectionTransaction } from "./types";
import { addDays, dayOfMonth, nextOccurrence } from "./units";

// Upcoming bills and income, and a day-by-day balance forecast for checking accounts.
// Pure: built from the same recurring streams the detection rules use.

export type Expected = {
  merchant: string;
  date: string;
  amountCents: number;
  accountId: string | null;
  // A payment to a card, named for its card (see billName).
  cardPayment?: true;
};

export type AccountForecast = {
  accountId: string;
  accountName: string;
  startCents: number;
  lowest: { date: string; balanceCents: number };
  bills: Expected[];
  income: Expected[];
  // End-of-day balance for each day, today first.
  days: { date: string; balanceCents: number }[];
};

export { addDays };

// Every date the stream is expected on, from today through `until`.
export function expectedDates(stream: Stream, asOf: string, until: string): string[] {
  const frequency = stream.frequency;
  // Plaid's prediction when it's still ahead, else the last charge; later dates keep that
  // day of the month.
  const predicted =
    stream.predictedNextDate && stream.predictedNextDate >= asOf ? stream.predictedNextDate : null;
  const from = predicted ?? stream.lastDate;
  if (!from) return [];
  const anchor = dayOfMonth(from);
  const step = (date: string) => (frequency ? nextOccurrence(date, frequency, anchor) : null);

  let next: string | null = predicted ?? step(from);
  while (next && next < asOf) next = step(next);
  const dates: string[] = [];
  while (next && next <= until) {
    dates.push(next);
    next = step(next);
  }
  return dates;
}

function expand(streams: Stream[], asOf: string, until: string): Expected[] {
  return streams
    .filter((s) => s.active)
    .flatMap((s) =>
      expectedDates(s, asOf, until).map((date) => ({
        merchant: s.merchant,
        date,
        amountCents: s.lastAmountCents,
        accountId: s.accountId,
        ...(s.pfcDetailed === "LOAN_PAYMENTS_CREDIT_CARD_PAYMENT" && {
          cardPayment: true as const,
        }),
      })),
    )
    .sort((a, b) => a.date.localeCompare(b.date) || a.merchant.localeCompare(b.merchant));
}

// Recurring income (inflows Plaid or our categorizer call INCOME), as positive amounts.
export function incomeStreams(input: DetectionInput): Stream[] {
  const byPlaidId = new Map(
    input.transactions.flatMap((t) => (t.plaidTransactionId ? [[t.plaidTransactionId, t]] : [])),
  );
  const plaid = input.recurringStreams
    .filter((s) => s.averageAmountCents < 0 && s.pfcPrimary === "INCOME")
    .map((s) =>
      fromPlaidStream(
        { ...s, lastAmountCents: -s.lastAmountCents, averageAmountCents: -s.averageAmountCents },
        byPlaidId,
      ),
    );
  const covered = new Set(input.recurringStreams.map((s) => s.accountId));
  const flipped: DetectionTransaction[] = input.transactions
    .filter((t) => t.amountCents < 0 && t.pfcPrimary === "INCOME" && !covered.has(t.accountId))
    .map((t) => ({ ...t, amountCents: -t.amountCents }));
  return [...plaid, ...detectRecurring({ ...input, transactions: flipped })];
}

// Money expected in from today through `until`: paychecks on their pay schedules (spec
// step 182, src/detection/paydays.ts), and other regular deposits such as interest from
// their streams.
export function expectedIncome(input: DetectionInput, until: string): Expected[] {
  const paychecks = expectedPaydays(input, until).map((p) => ({
    merchant: p.employer,
    date: p.date,
    amountCents: p.amountCents,
    accountId: p.accountId,
  }));
  const payroll = (s: Stream) =>
    s.charges.some((c) => isPaycheck({ ...c, amountCents: -Math.abs(c.amountCents) }));
  const other = expand(
    incomeStreams(input).filter((s) => !payroll(s)),
    input.asOf,
    until,
  );
  return [...paychecks, ...other].sort(
    (a, b) => a.date.localeCompare(b.date) || a.merchant.localeCompare(b.merchant),
  );
}

// Books QA: card interest isn't a bill (the card's own payment covers it), and a card payment
// the bank names "... thank you" reads as what it is. Shared with the recurring charges.
export const isBillStream = (s: Stream) => !NOT_BILL_CATEGORIES.includes(s.pfcDetailed ?? "");
// A card payment reads as one whatever the card company calls it ("CHASE CREDIT CRD AUTOPAY",
// "AMEX EPAYMENT"), now that usage bills and card payments are found by their timing (accuracy
// bench), and is named for its card ("Chase Freedom payment"), not "Credit card payment"
// (overnight beta list): the card it's on, else the card of the company the payment names, else
// "Chase card payment", else the plain name (a lone card isn't assumed: the payment may be to
// one Jane hasn't seen).
export function billName(s: Stream, accounts: readonly DetectionAccount[] = []): string {
  if (s.pfcDetailed !== "LOAN_PAYMENTS_CREDIT_CARD_PAYMENT") return s.merchant;
  const own = accounts.find((a) => a.type === "credit" && a.id === s.accountId);
  if (own) return `${own.name} payment`;
  return cardPaymentNameFromWords(`${s.charges[0]?.description ?? ""} ${s.merchant}`, accounts);
}

// Money the person moves to their own savings or investments on a schedule: never a bill
// (messy-bank QA: "Online Transfer To Sav" was listed as a $500 bill), though the forecast
// still takes it out of checking.
const isOwnTransfer = (s: Stream) => OWN_ACCOUNT_TRANSFERS.includes(s.pfcDetailed ?? "");

export function scheduledTransfers(input: DetectionInput, days: number): Expected[] {
  return expand(buildStreams(input).filter(isOwnTransfer), input.asOf, addDays(input.asOf, days));
}

const isHabit = (s: Stream) =>
  !isSubscriptionBox(s) &&
  NOT_BILL_HABIT_PRIMARIES.includes(s.pfcPrimary ?? "") &&
  s.frequency !== null &&
  NOT_BILL_HABIT_FREQUENCIES.includes(s.frequency);

// What "Coming up" lists: bills, not moves to one's own accounts or a weekly habit.
export const isComingUp = (s: Stream) => isBillStream(s) && !isOwnTransfer(s) && !isHabit(s);

// `remindedElsewhere`: payment categories whose due date the bank reports, left out.
export function upcomingBills(
  input: DetectionInput,
  days: number,
  remindedElsewhere: ReadonlySet<string> = new Set(),
): Expected[] {
  const bills = buildStreams(input)
    .filter(isComingUp)
    .filter((s) => !remindedElsewhere.has(s.pfcDetailed ?? ""))
    .map((s) => ({ ...s, merchant: billName(s, input.accounts) }));
  return expand(bills, input.asOf, addDays(input.asOf, days));
}

export function forecastAccounts(input: DetectionInput, days: number): AccountForecast[] {
  const until = addDays(input.asOf, days);
  const bills = upcomingBills(input, days);
  const transfers = scheduledTransfers(input, days);
  const income = expectedIncome(input, until);

  return input.accounts
    .filter(
      (a) =>
        a.type === "depository" &&
        FORECAST_SUBTYPES.includes(a.subtype ?? "") &&
        a.currentBalanceCents !== null,
    )
    .map((account) => {
      const mine = (rows: Expected[]) => rows.filter((r) => r.accountId === account.id);
      const accountBills = mine(bills);
      const accountIncome = mine(income);
      const accountTransfers = mine(transfers);
      let balance = account.currentBalanceCents!;
      const series: { date: string; balanceCents: number }[] = [];
      for (let i = 0; i <= days; i += 1) {
        const date = addDays(input.asOf, i);
        for (const r of accountIncome) if (r.date === date) balance += r.amountCents;
        for (const r of accountBills) if (r.date === date) balance -= r.amountCents;
        for (const r of accountTransfers) if (r.date === date) balance -= r.amountCents;
        series.push({ date, balanceCents: balance });
      }
      const lowest = series.reduce((low, day) => (day.balanceCents < low.balanceCents ? day : low));
      return {
        accountId: account.id,
        accountName: account.name,
        startCents: account.currentBalanceCents!,
        lowest,
        bills: accountBills,
        income: accountIncome,
        days: series,
      };
    });
}
