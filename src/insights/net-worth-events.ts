import {
  DEBT_ACCOUNT_TYPES,
  NET_WORTH_EVENT_MIN_CENTS,
  NET_WORTH_EVENT_MIN_SHARE,
  NET_WORTH_EVENTS_MAX,
  NET_WORTH_INVESTMENT_MOVE_CENTS,
} from "@/config/net-worth";

// The net worth chart's events (founder: "expand to see points on the graph how the money moved
// based on what event"): paydays, big purchases, bills, card payments, loans paid off,
// investment months, refunds and what Jane saved, worked out from the same transactions,
// balances and actions the rest of Jane reads. Pure; the loader is src/lib/hub/net-worth-events.ts.

export type EventKind =
  | "pay"
  | "purchase"
  | "bill"
  | "card_payment"
  | "loan_paid_off"
  | "investments"
  | "refund"
  | "jane_saved";

export type NetWorthEvent = {
  date: string;
  kind: EventKind;
  // A few words: "Payday: Acme Corp", "Bought: Best Buy".
  label: string;
  // What it did to net worth: + in, − out. A card payment moves money between the person's
  // own accounts, so it is 0 here and `moved` says how much.
  cents: number;
  moved?: number;
  // Where to see it: the transaction, the account or what Jane did.
  href: string;
  // The account it happened in, as the loan pages name it ("Chase ····5003"), when there is one.
  account?: string;
  // Who it was with ("Acme Corp", "Best Buy"), for a transaction.
  name?: string;
};

// A kind in a word or two, as the dot's summary says it: "−$1,640 · card payment · Chase ····5003".
export const EVENT_KIND_WORDS: Record<EventKind, string> = {
  pay: "pay",
  purchase: "purchase",
  bill: "bill",
  card_payment: "card payment",
  loan_paid_off: "paid off",
  investments: "investments",
  refund: "refund",
  jane_saved: "Jane saved",
};

export type EventGroup = { date: string; cents: number; events: NetWorthEvent[] };

export type EventTransaction = {
  date: string;
  // Plaid's sign: positive is money out of the account.
  amountCents: number;
  name: string;
  pfcPrimary: string | null;
  pfcDetailed: string | null;
  accountType: string;
  account?: string;
};

const isDebt = (type: string) => DEBT_ACCOUNT_TYPES.includes(type);
const search = (name: string) => `/transactions?q=${encodeURIComponent(name)}`;

const BILLS = ["RENT_AND_UTILITIES", "LOAN_PAYMENTS"];
const BILL_DETAILS = ["GENERAL_SERVICES_INSURANCE"];

// One transaction as an event, or null for money moving between the person's own accounts.
export function transactionEvent(t: EventTransaction): NetWorthEvent | null {
  const base = {
    date: t.date,
    href: search(t.name),
    name: t.name,
    ...(t.account ? { account: t.account } : {}),
  };
  const detailed = t.pfcDetailed ?? "";
  const primary = t.pfcPrimary ?? "";
  const out = t.amountCents > 0;
  const cents = -t.amountCents;
  if (detailed === "LOAN_PAYMENTS_CREDIT_CARD_PAYMENT") {
    // Counted once, from the account it was paid from.
    if (isDebt(t.accountType) || !out) return null;
    return {
      ...base,
      kind: "card_payment",
      label: `Card payment: ${t.name}`,
      cents: 0,
      moved: t.amountCents,
    };
  }
  if (primary === "TRANSFER_IN" || primary === "TRANSFER_OUT") return null;
  if (primary === "INCOME" && !out) {
    return { ...base, kind: "pay", label: `Payday: ${t.name}`, cents };
  }
  if (!out) return { ...base, kind: "refund", label: `Refund: ${t.name}`, cents };
  if (BILLS.includes(primary) || BILL_DETAILS.includes(detailed)) {
    return { ...base, kind: "bill", label: `Bill: ${t.name}`, cents };
  }
  return { ...base, kind: "purchase", label: `Bought: ${t.name}`, cents };
}

export type DebtBalances = {
  id: string;
  name: string;
  // Its name with the last four digits, when known.
  label?: string;
  // Oldest first.
  balances: { date: string; cents: number }[];
};

// The day a loan or card that was owed reached zero, if it did.
export function paidOff(debt: DebtBalances): NetWorthEvent | null {
  let owed = 0;
  for (const b of debt.balances) {
    if (b.cents > 0) owed = b.cents;
    else if (owed > 0) {
      return {
        date: b.date,
        kind: "loan_paid_off",
        label: `Paid off: ${debt.name}`,
        cents: 0,
        moved: owed,
        href: "/loans",
        account: debt.label ?? debt.name,
      };
    }
  }
  return null;
}

// An investment account's months that moved enough to see, from its month-end balances.
export function investmentMonths(account: DebtBalances): NetWorthEvent[] {
  const ends = new Map<string, { date: string; cents: number }>();
  for (const b of account.balances) ends.set(b.date.slice(0, 7), b);
  const months = [...ends.values()];
  return months.slice(1).flatMap((b, i) => {
    const change = b.cents - months[i].cents;
    if (Math.abs(change) < NET_WORTH_INVESTMENT_MOVE_CENTS) return [];
    return [
      {
        date: b.date,
        kind: "investments" as const,
        label: `Investments ${change > 0 ? "up" : "down"}: ${account.name}`,
        cents: change,
        href: "/investments",
        account: account.label ?? account.name,
      },
    ];
  });
}

export type JaneAction = { date: string; title: string; cents: number };

// What Jane got back or cut, on the day it was done.
export function janeSaved(action: JaneAction): NetWorthEvent | null {
  if (action.cents <= 0) return null;
  return {
    date: action.date,
    kind: "jane_saved",
    label: `Jane saved: ${action.title}`,
    cents: action.cents,
    href: "/actions",
  };
}

// How big a day is: what it did to net worth, or what it moved when that was nothing.
const size = (g: EventGroup) =>
  Math.max(Math.abs(g.cents), ...g.events.map((e) => Math.abs(e.cents) || Math.abs(e.moved ?? 0)));

// Events grouped by day, kept when the day is big enough to see (at least MIN_CENTS, or
// MIN_SHARE of net worth if that's less), oldest first.
export function significantDays(
  events: readonly NetWorthEvent[],
  netWorthCents: number,
): EventGroup[] {
  const byDay = new Map<string, NetWorthEvent[]>();
  for (const e of events) byDay.set(e.date, [...(byDay.get(e.date) ?? []), e]);
  const floor = Math.min(
    NET_WORTH_EVENT_MIN_CENTS,
    Math.max(1, Math.abs(netWorthCents) * NET_WORTH_EVENT_MIN_SHARE),
  );
  return [...byDay.entries()]
    .map(([date, list]) => ({
      date,
      cents: list.reduce((sum, e) => sum + e.cents, 0),
      // Biggest first within the day.
      events: [...list].sort(
        (a, b) => (Math.abs(b.cents) || b.moved || 0) - (Math.abs(a.cents) || a.moved || 0),
      ),
    }))
    .filter((g) => size(g) >= floor)
    .sort((a, b) => a.date.localeCompare(b.date));
}

// The days to mark on the range on screen: the biggest few from `from` on, oldest first.
export function daysToMark(
  groups: readonly EventGroup[],
  from: string,
  max = NET_WORTH_EVENTS_MAX,
): EventGroup[] {
  return groups
    .filter((g) => g.date >= from)
    .sort((a, b) => size(b) - size(a))
    .slice(0, max)
    .sort((a, b) => a.date.localeCompare(b.date));
}
