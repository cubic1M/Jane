import {
  CARD_PAYMENT_NAME,
  CARD_PAYMENT_THANKS,
  FORECAST_SUBTYPES,
  NOT_BILL_CATEGORIES,
} from "@/config/detection";
import { expectedPaydays, isPaycheck } from "./paydays";
import { buildStreams, detectRecurring, fromPlaidStream, type Stream } from "./streams";
import type { DetectionInput, DetectionTransaction } from "./types";
import { addDays, dayOfMonth, nextOccurrence } from "./units";

// Upcoming bills and income, and a day-by-day balance forecast for checking accounts.
// Pure: built from the same recurring streams the detection rules use.

export type Expected = {
  merchant: string;
  date: string;
  amountCents: number;
  accountId: string | null;
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

export function upcomingBills(input: DetectionInput, days: number): Expected[] {
  const bills = buildStreams(input)
    .filter((s) => !NOT_BILL_CATEGORIES.includes(s.pfcDetailed ?? ""))
    .map((s) =>
      s.pfcDetailed === "LOAN_PAYMENTS_CREDIT_CARD_PAYMENT" && CARD_PAYMENT_THANKS.test(s.merchant)
        ? { ...s, merchant: CARD_PAYMENT_NAME }
        : s,
    );
  return expand(bills, input.asOf, addDays(input.asOf, days));
}

export function forecastAccounts(input: DetectionInput, days: number): AccountForecast[] {
  const until = addDays(input.asOf, days);
  const bills = upcomingBills(input, days);
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
      let balance = account.currentBalanceCents!;
      const series: { date: string; balanceCents: number }[] = [];
      for (let i = 0; i <= days; i += 1) {
        const date = addDays(input.asOf, i);
        for (const r of accountIncome) if (r.date === date) balance += r.amountCents;
        for (const r of accountBills) if (r.date === date) balance -= r.amountCents;
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
