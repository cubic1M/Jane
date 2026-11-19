import type { MethodAccount } from "./api";

// Method's own examples (docs.methodfi.com, API reference 2026-03-30: the Account object's
// "Liability" example and the Update object's credit card, auto loan and student loans examples,
// read 2026-11-19), cut to the fields Jane reads. The tests read them as Method sends them; the
// sandbox twin moves their payment dates to around the person's day (sampleAccounts).

export const METHOD_DOCS_ACCOUNTS: MethodAccount[] = [
  {
    id: "acc_RGACQH7XdfYhC",
    holder_id: "ent_y1a9e1fbnJ1f3",
    status: "active",
    type: "liability",
    liability: { type: "credit_card", name: "Chase Sapphire Reserve Credit Card", mask: "1580" },
    update: {
      id: "upt_NYV5kfjskTTCJ",
      status: "completed",
      source: "direct",
      type: "credit_card",
      data_as_of: "2024-03-20T04:43:21.434Z",
      credit_card: {
        balance: 80000,
        credit_limit: 200000,
        interest_rate_percentage_max: 23.5,
        interest_rate_percentage_min: 12.0,
        interest_rate_type: "variable",
        last_payment_amount: 5000,
        last_payment_date: "2024-04-05",
        next_payment_due_date: "2024-05-01",
        next_payment_minimum_amount: 4000,
        opened_at: "2018-10-30",
      },
    },
  },
  {
    id: "acc_aEBDiLxiR8bqc",
    holder_id: "ent_y1a9e1fbnJ1f3",
    status: "active",
    type: "liability",
    liability: { type: "auto_loan", name: "Auto Loan", mask: "8831" },
    update: {
      id: "upt_ELGT4hfikTTCJ",
      status: "completed",
      source: "direct",
      type: "auto_loan",
      data_as_of: "2024-03-20T04:43:21.434Z",
      auto_loan: {
        balance: 1500000,
        expected_payoff_date: "2029-04-15",
        interest_rate_percentage: 3.5,
        interest_rate_type: "fixed",
        last_payment_amount: 35000,
        last_payment_date: "2024-03-15",
        next_payment_due_date: "2024-05-15",
        next_payment_minimum_amount: 35000,
        opened_at: "2019-04-15",
        original_loan_amount: 2000000,
        sub_type: "loan",
        term_length: 120,
      },
    },
  },
  {
    id: "acc_uHDiQGxiR8bqc",
    holder_id: "ent_y1a9e1fbnJ1f3",
    status: "active",
    type: "liability",
    liability: { type: "student_loans", name: "Federal Student Loans", mask: "0921" },
    update: {
      id: "upt_NJK9kfjskTTCJ",
      status: "completed",
      source: "snapshot",
      type: "student_loans",
      data_as_of: "2024-03-20T04:43:21.434Z",
      student_loans: {
        balance: 12000000,
        disbursements: [{ balance: 326300, interest_rate_percentage: 4.29 }],
        last_payment_amount: 250000,
        last_payment_date: "2024-03-15",
        next_payment_due_date: "2024-05-15",
        next_payment_minimum_amount: 250000,
        opened_at: "2019-08-15",
        original_loan_amount: 12000000,
        sub_type: "federal",
        term_length: 120,
      },
    },
  },
];

const DAY_MS = 86_400_000;
const shift = (value: unknown, days: number) =>
  typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)
    ? new Date(Date.parse(`${value}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10)
    : value;

// The same accounts for a sample-data person, every payment date moved by the same days so the
// card's next payment is due 12 days after `today` (the person's own day, YYYY-MM-DD).
export function sampleAccounts(today: string): MethodAccount[] {
  const days =
    Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse("2024-05-01T00:00:00Z")) / DAY_MS) +
    12;
  return METHOD_DOCS_ACCOUNTS.map((account) => {
    const update = account.update as Record<string, unknown>;
    const type = String(update.type);
    const data = update[type] as Record<string, unknown>;
    const moved = Object.fromEntries(
      Object.entries(data).map(([k, v]) => [k, /_date$/.test(k) ? shift(v, days) : v]),
    );
    return { ...account, update: { ...(update as object), [type]: moved } as never };
  });
}
