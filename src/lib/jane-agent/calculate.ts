// The chat's arithmetic (the `calculate` tool): the numbers Claude wants that no lookup gives
// directly ("4% of her balance", "a year of $15.49", "how long to pay off $2,410.50 at
// $200 a month"). Done here, on the figures Claude passes, so the amount in the answer is
// computed and the guardrail accepts it as coming from the data. Pure; amounts in dollars in,
// cents out.

export const OPERATIONS = [
  "percent_of",
  "per_year",
  "per_month",
  "difference",
  "sum",
  "payoff_months",
] as const;
export type Operation = (typeof OPERATIONS)[number];

export type CalcInput = {
  operation?: unknown;
  percent?: unknown;
  amount?: unknown;
  other_amount?: unknown;
  amounts?: unknown;
  balance?: unknown;
  monthly_payment?: unknown;
  apr_percent?: unknown;
};

export type CalcResult =
  | {
      ok: true;
      // What to say, as fields: amounts in cents, counts as numbers.
      cents: Record<string, number>;
      numbers: Record<string, number>;
      note: string;
    }
  | { ok: false; error: string };

const MAX = 1_000_000_000;
const num = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) && Math.abs(v) <= MAX ? v : null;
const toCents = (dollars: number) => Math.round(dollars * 100);

export function calculate(input: CalcInput): CalcResult {
  const op = String(input.operation ?? "") as Operation;
  const amount = num(input.amount);
  switch (op) {
    case "percent_of": {
      const percent = num(input.percent);
      if (percent === null || amount === null) {
        return { ok: false, error: "percent_of needs percent and amount (dollars)." };
      }
      return {
        ok: true,
        cents: { result: toCents((amount * percent) / 100) },
        numbers: {},
        note: `${percent}% of the amount.`,
      };
    }
    case "per_year":
    case "per_month": {
      if (amount === null) return { ok: false, error: `${op} needs amount (dollars).` };
      return {
        ok: true,
        cents: { result: toCents(op === "per_year" ? amount * 12 : amount / 12) },
        numbers: {},
        note: op === "per_year" ? "Twelve months of it." : "A twelfth of it.",
      };
    }
    case "difference": {
      const other = num(input.other_amount);
      if (amount === null || other === null) {
        return { ok: false, error: "difference needs amount and other_amount (dollars)." };
      }
      return {
        ok: true,
        cents: { result: Math.abs(toCents(amount) - toCents(other)) },
        numbers: {},
        note: amount >= other ? "amount is the larger." : "other_amount is the larger.",
      };
    }
    case "sum": {
      const raw = Array.isArray(input.amounts) ? input.amounts.map(num) : [];
      const list = raw.filter((v): v is number => v !== null);
      if (list.length === 0 || list.length !== raw.length) {
        return { ok: false, error: "sum needs amounts: a list of dollar amounts." };
      }
      return {
        ok: true,
        cents: { result: list.reduce((sum, v) => sum + toCents(v), 0) },
        numbers: {},
        note: `The sum of ${list.length} amounts.`,
      };
    }
    case "payoff_months": {
      const balance = num(input.balance);
      const payment = num(input.monthly_payment);
      const apr = num(input.apr_percent) ?? 0;
      if (balance === null || payment === null || balance <= 0 || payment <= 0 || apr < 0) {
        return {
          ok: false,
          error: "payoff_months needs balance and monthly_payment (dollars), and apr_percent.",
        };
      }
      const rate = apr / 100 / 12;
      if (rate > 0 && payment <= balance * rate) {
        return {
          ok: true,
          cents: { monthlyInterest: toCents(balance * rate) },
          numbers: {},
          note: "The payment doesn't cover the monthly interest, so the balance would never be paid off at this payment.",
        };
      }
      const months =
        rate === 0
          ? Math.ceil(balance / payment)
          : Math.ceil(-Math.log(1 - (rate * balance) / payment) / Math.log(1 + rate));
      // Simulated month by month, so the interest is what the card would really charge.
      let left = balance;
      let interest = 0;
      for (let m = 0; m < months && left > 0; m += 1) {
        const charge = left * rate;
        interest += charge;
        left = left + charge - Math.min(payment, left + charge);
      }
      return {
        ok: true,
        cents: { totalInterest: toCents(interest), totalPaid: toCents(balance + interest) },
        numbers: { months, years: Math.floor(months / 12), extraMonths: months % 12 },
        note: `${months} months at the stated payment${apr > 0 ? ` and ${apr}% APR` : ""}; the last payment may be smaller.`,
      };
    }
    default:
      return { ok: false, error: `operation must be one of: ${OPERATIONS.join(", ")}.` };
  }
}
