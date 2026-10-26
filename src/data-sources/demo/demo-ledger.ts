import type { Transaction } from "plaid";
import type { PfcDetailed } from "@/categorize/taxonomy";
import { addDays, primaryOf, random } from "./demo-bank";

// A sample person's year as a ledger (founder, 2026-10-23): every balance rolls back through
// its own transactions to a believable one a year ago, so the net worth line is their real
// history. The people's templates (./demo-people.ts) say what they pay; this closes the books:
// - each card payment from checking also shows on the card, and pays the month's statement
//   (what was charged since the last payment) unless the person pays a fixed amount;
// - what checking takes in beyond what it pays out goes on payday to savings, the same each
//   month and no more than savings could have grown by, and the rest to everyday spending, or,
//   for income that comes in lumps (a freelancer, a shop), on payday to a savings account at
//   another bank: spent in lumps it would read as price rises, budgets blown and a cushion
//   sized to a shop's stock.
// Pure and deterministic, like the rest of the demo bank.

export type LedgerPlan = {
  seed: string;
  // The day the sample was linked: the year closed is the one before it.
  anchor: string;
  checking: string;
  savings: { id: string; balance: number } | null;
  // Each card account, what it owes today, and whether its payments are the fixed amounts the
  // templates give.
  cards: { id: string; balance: number; fixed: boolean }[];
  // Which card each checking payment pays, by transaction id; the first card otherwise.
  paysCard: (transactionId: string) => string | null;
  // The day of the month pay comes in.
  payDay: number;
  rest: "spending" | "transfer";
};

// Savings is never taken back below this share of today's balance a year ago.
export const LEDGER_SAVINGS_KEEP = 0.2;
const CARD_PAYMENT: PfcDetailed = "LOAN_PAYMENTS_CREDIT_CARD_PAYMENT";

// Everyday debit spending, one merchant per purchase so none of them looks like a bill.
const EVERYDAY: [name: string, merchant: string, category: PfcDetailed][] = [
  ["AMAZON MKTPL", "Amazon", "GENERAL_MERCHANDISE_ONLINE_MARKETPLACES"],
  ["TARGET", "Target", "GENERAL_MERCHANDISE_SUPERSTORES"],
  ["SHELL OIL", "Shell", "TRANSPORTATION_GAS"],
  ["WALGREENS", "Walgreens", "PERSONAL_CARE_OTHER_PERSONAL_CARE"],
  ["OLD NAVY", "Old Navy", "GENERAL_MERCHANDISE_CLOTHING_AND_ACCESSORIES"],
  ["CVS PHARMACY", "CVS", "PERSONAL_CARE_OTHER_PERSONAL_CARE"],
  ["CHEVRON", "Chevron", "TRANSPORTATION_GAS"],
  ["WALMART", "Walmart", "GENERAL_MERCHANDISE_SUPERSTORES"],
];
const EVERYDAY_PER_MONTH = 6;

const cents = (dollars: number) => Math.round(dollars * 100);
const dollars = (c: number) => c / 100;
const detailedOf = (t: Transaction) => t.personal_finance_category?.detailed ?? "";

const tx = (
  id: string,
  account: string,
  day: string,
  amountCents: number,
  name: string,
  merchant: string | null,
  category: PfcDetailed,
): Transaction =>
  ({
    transaction_id: id,
    account_id: account,
    date: day,
    amount: dollars(amountCents),
    name,
    merchant_name: merchant,
    pending: false,
    personal_finance_category: {
      primary: primaryOf(category),
      detailed: category,
      confidence_level: "VERY_HIGH",
    },
  }) as unknown as Transaction;

const sameDayLastMonth = (day: string) => {
  const [y, m, d] = day.split("-").map(Number);
  const back = new Date(Date.UTC(y, m - 2, Math.min(d, 28)));
  return back.toISOString().slice(0, 10);
};

// Each month (YYYY-MM) from the one holding `from` through the one holding `through`.
function months(from: string, through: string): string[] {
  const out: string[] = [];
  let [y, m] = from.split("-").map(Number);
  const [ty, tm] = through.split("-").map(Number);
  while (y < ty || (y === ty && m <= tm)) {
    out.push(`${y}-${String(m).padStart(2, "0")}`);
    if (m === 12) {
      m = 1;
      y += 1;
    } else m += 1;
  }
  return out;
}

// `raw` covers from at least 45 days before `from` (statements) through `through`, and the
// year before the anchor (the surplus); what comes back is the ledger's, all of it.
export function ledgered(
  raw: readonly Transaction[],
  plan: LedgerPlan,
  from: string,
  through: string,
): Transaction[] {
  const cardIds = new Set(plan.cards.map((c) => c.id));
  const fixed = new Set(plan.cards.filter((c) => c.fixed).map((c) => c.id));
  const charges = (card: string, after: string, upTo: string) =>
    raw
      .filter(
        (t) =>
          t.account_id === card &&
          t.amount > 0 &&
          detailedOf(t) !== CARD_PAYMENT &&
          t.date > after &&
          t.date <= upTo,
      )
      .reduce((s, t) => s + cents(t.amount), 0);

  // Card payments: the statement, and the card's side of it.
  const out: Transaction[] = [];
  for (const t of raw) {
    const card =
      t.account_id === plan.checking && detailedOf(t) === CARD_PAYMENT && t.amount > 0
        ? plan.paysCard(t.transaction_id)
        : null;
    if (!card || !cardIds.has(card)) {
      out.push(t);
      continue;
    }
    const paid = fixed.has(card)
      ? cents(t.amount)
      : charges(card, sameDayLastMonth(t.date), t.date);
    if (paid <= 0) continue;
    out.push({ ...t, amount: dollars(paid) });
    out.push(
      tx(
        `${t.transaction_id}-card`,
        card,
        t.date,
        -paid,
        "PAYMENT - THANK YOU",
        null,
        CARD_PAYMENT,
      ),
    );
  }

  // What a card owes today must cover what was charged since, or it would have owed less than
  // nothing before (a big repair charged after the last statement): a payment the day before
  // the sample was linked makes up the difference, from checking like the others.
  for (const card of plan.cards.filter((c) => !c.fixed)) {
    const own = out
      .filter((t) => t.account_id === card.id && t.date <= plan.anchor)
      .sort((a, b) => b.date.localeCompare(a.date));
    let since = 0;
    let lowest = cents(card.balance);
    for (const t of own) {
      since += cents(t.amount);
      lowest = Math.min(lowest, cents(card.balance) - since);
    }
    if (lowest >= 0) continue;
    const day = addDays(plan.anchor, -1);
    const id = `demo-${plan.seed}-ledger-catchup-${card.id}-${day}`;
    out.push(
      tx(id, plan.checking, day, -lowest, "CARD PAYMENT THANK YOU", null, CARD_PAYMENT),
      tx(`${id}-card`, card.id, day, lowest, "PAYMENT - THANK YOU", null, CARD_PAYMENT),
    );
  }
  const kept = out.filter((t) => t.amount !== 0);

  // What checking keeps beyond what it pays out in the year before the anchor, month by month:
  // it goes out in the month it came in, so checking keeps to its own level all year.
  const yearAgo = addDays(plan.anchor, -365);
  const byMonth = new Map<string, number>();
  for (const t of kept) {
    if (t.account_id !== plan.checking || t.date <= yearAgo || t.date > plan.anchor) continue;
    const month = t.date.slice(0, 7);
    byMonth.set(month, (byMonth.get(month) ?? 0) - cents(t.amount));
  }
  const surplus = [...byMonth.values()].reduce((s, v) => s + v, 0);
  if (surplus <= 0) return kept;
  const ahead = [...byMonth.values()].reduce((s, v) => s + Math.max(0, v), 0);
  const toSavings = plan.savings
    ? Math.min(surplus, Math.round(cents(plan.savings.balance) * (1 - LEDGER_SAVINGS_KEEP)))
    : 0;
  // The same each month: a transfer that grew would read as a trial that now bills.
  const savingsMonthly = Math.floor(toSavings / 12);
  // A month's share of the year's surplus; an average month outside the year.
  const monthly = (month: string) =>
    byMonth.has(month)
      ? Math.floor((surplus * Math.max(0, byMonth.get(month)!)) / ahead)
      : Math.floor(surplus / 12);

  const start = addDays(from, -45) < yearAgo ? addDays(from, -45) : yearAgo;
  const inRange = (day: string) => day > start && day <= through;
  for (const month of months(start, through)) {
    const restMonthly = Math.floor(monthly(month) * (1 - toSavings / surplus));
    const payDay = `${month}-${String(Math.min(plan.payDay, 28)).padStart(2, "0")}`;
    if (savingsMonthly > 0 && plan.savings && inRange(payDay)) {
      const id = `demo-${plan.seed}-ledger-save-${payDay}`;
      kept.push(
        tx(
          id,
          plan.checking,
          payDay,
          savingsMonthly,
          "TRANSFER TO SAVINGS",
          null,
          "TRANSFER_OUT_SAVINGS",
        ),
        tx(
          `${id}-in`,
          plan.savings.id,
          payDay,
          -savingsMonthly,
          "TRANSFER FROM CHECKING",
          null,
          "TRANSFER_IN_SAVINGS",
        ),
      );
    }
    if (restMonthly <= 0) continue;
    if (plan.rest === "transfer") {
      if (inRange(payDay)) {
        kept.push(
          tx(
            `demo-${plan.seed}-ledger-out-${payDay}`,
            plan.checking,
            payDay,
            restMonthly,
            "ONLINE TRANSFER TO SAVINGS ····9012",
            null,
            "TRANSFER_OUT_ACCOUNT_TRANSFER",
          ),
        );
      }
      continue;
    }
    const count = EVERYDAY_PER_MONTH;
    const weights = Array.from(
      { length: count },
      (_, i) => 0.5 + random(`${plan.seed}|ledger|${month}|w${i}`),
    );
    const total = weights.reduce((s, w) => s + w, 0);
    let left = restMonthly;
    weights.forEach((w, i) => {
      const day = `${month}-${String(1 + Math.floor(random(`${plan.seed}|ledger|${month}|d${i}`) * 28)).padStart(2, "0")}`;
      const amount = i === count - 1 ? left : Math.round((restMonthly * w) / total);
      left -= amount;
      if (!inRange(day) || amount <= 0) return;
      const [name, merchant, category] =
        EVERYDAY[Math.floor(random(`${plan.seed}|ledger|${month}|m${i}`) * EVERYDAY.length)];
      kept.push(
        tx(
          `demo-${plan.seed}-ledger-${month}-${i}`,
          plan.checking,
          day,
          amount,
          name,
          merchant,
          category,
        ),
      );
    });
  }
  return kept;
}
