import { MAX_PAYOFF_MONTHS } from "@/config/planning";

// Credit card payoff math for the planner. Education, not advice: it shows what two
// common orders of paying cards down would cost, and never says which to pick.
//
// Each month, in this order: every card is charged a month of interest (APR / 12, rounded
// to the cent); every card gets its minimum payment (or its balance, if smaller); then the
// rest of the monthly budget goes to cards in the strategy's order, rolling over to the
// next card when one is paid off. The budget stays the same every month, so a paid-off
// card's minimum goes to the next one.

export type DebtCard = {
  id: string;
  name: string;
  balanceCents: number;
  // Yearly rate in basis points: 2499 is 24.99%.
  aprBps: number;
  minimumCents: number;
};

export type Strategy = "avalanche" | "snowball";

export type PayoffMonth = {
  month: number;
  interestCents: number;
  paidCents: number;
  // Balance of each card after this month's payments, by card id.
  balances: Record<string, number>;
};

export type PayoffPlan =
  | {
      ok: true;
      strategy: Strategy;
      months: number;
      totalInterestCents: number;
      totalPaidCents: number;
      // The month each card reaches zero (1 = the first month), by card id.
      paidOffMonth: Record<string, number>;
      schedule: PayoffMonth[];
    }
  | { ok: false; strategy: Strategy; reason: "budget_below_minimums" | "never_pays_off" };

const BASIS_POINTS = 10_000;
const MONTHS_PER_YEAR = 12;

export function monthlyInterest(balanceCents: number, aprBps: number): number {
  return Math.round((balanceCents * aprBps) / BASIS_POINTS / MONTHS_PER_YEAR);
}

// Which card gets extra money first. Avalanche: highest rate first. Snowball: smallest
// balance first. Ties go to the other measure, then the card's position in the list.
export function payoffOrder(cards: DebtCard[], strategy: Strategy): DebtCard[] {
  return cards
    .map((card, index) => ({ card, index }))
    .sort((a, b) => {
      const rate = b.card.aprBps - a.card.aprBps;
      const size = a.card.balanceCents - b.card.balanceCents;
      const [first, second] = strategy === "avalanche" ? [rate, size] : [size, rate];
      return first || second || a.index - b.index;
    })
    .map(({ card }) => card);
}

export function payoffPlan(cards: DebtCard[], budgetCents: number, strategy: Strategy): PayoffPlan {
  const owing = cards.filter((c) => c.balanceCents > 0);
  const minimums = owing.reduce((sum, c) => sum + c.minimumCents, 0);
  if (budgetCents < minimums || budgetCents <= 0) {
    return { ok: false, strategy, reason: "budget_below_minimums" };
  }

  const order = payoffOrder(owing, strategy);
  const balance = new Map(owing.map((c) => [c.id, c.balanceCents]));
  const paidOffMonth: Record<string, number> = {};
  const schedule: PayoffMonth[] = [];
  let totalInterest = 0;
  let totalPaid = 0;

  for (let month = 1; month <= MAX_PAYOFF_MONTHS; month += 1) {
    let interest = 0;
    for (const card of order) {
      const owed = balance.get(card.id) ?? 0;
      if (owed <= 0) continue;
      const charge = monthlyInterest(owed, card.aprBps);
      balance.set(card.id, owed + charge);
      interest += charge;
    }

    let left = budgetCents;
    const pay = (card: DebtCard, most: number) => {
      const amount = Math.min(most, balance.get(card.id) ?? 0, left);
      balance.set(card.id, (balance.get(card.id) ?? 0) - amount);
      left -= amount;
    };
    for (const card of order) pay(card, card.minimumCents);
    for (const card of order) pay(card, left);

    const paid = budgetCents - left;
    totalInterest += interest;
    totalPaid += paid;
    for (const card of order) {
      if ((balance.get(card.id) ?? 0) === 0 && paidOffMonth[card.id] === undefined) {
        paidOffMonth[card.id] = month;
      }
    }
    schedule.push({
      month,
      interestCents: interest,
      paidCents: paid,
      balances: Object.fromEntries(order.map((c) => [c.id, balance.get(c.id) ?? 0])),
    });

    if (order.every((c) => (balance.get(c.id) ?? 0) === 0)) {
      return {
        ok: true,
        strategy,
        months: month,
        totalInterestCents: totalInterest,
        totalPaidCents: totalPaid,
        paidOffMonth,
        schedule,
      };
    }
  }
  return { ok: false, strategy, reason: "never_pays_off" };
}

// "24.99" or "24.99%" to basis points; null if it isn't a sensible APR.
export function parseApr(text: string): number | null {
  const match = text
    .trim()
    .replace(/%$/, "")
    .trim()
    .match(/^\d{1,2}(\.\d{1,2})?$/);
  if (!match) return null;
  return Math.round(Number(match[0]) * 100);
}
