import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));

import { buildProfile, type ProfileInput, type ProfileTx } from "@/profile/build";
import { runDetectors } from "./index";

// Debug 2, third desktop sweep (11-16, Plaid sandbox: checking from Jul 24 paying Nelnet $217.40
// on the 5th of each month, a Direct loan of $16,053.74): "A better student loan plan, $1k/yr:
// You pay about $228.18 a month on student loans." Four payments over the 3.8 months the data
// covers read as more than the payment. A month's payment is the usual month's total.

const tx = (date: string, amountCents: number, description: string, pfc: string): ProfileTx => ({
  date,
  amountCents,
  description,
  pfc,
  accountId: "chk",
});
const months = ["08", "09", "10", "11"];
const data: ProfileInput = {
  today: "2026-11-16",
  accounts: [
    {
      id: "chk",
      type: "depository",
      subtype: "checking",
      balanceCents: 164_025,
      balanceKnown: true,
    },
    { id: "ln", type: "loan", subtype: "student", balanceCents: 1_605_374, balanceKnown: true },
  ],
  liabilities: [],
  told: {},
  transactions: [
    tx("2026-07-24", -93_850, "TARGET CORP PAYROLL PPD", "INCOME_WAGES"),
    ...months.flatMap((m) => [
      tx(`2026-${m}-05`, 21_740, "NELNET STUDENT LN PAYMENT", "LOAN_PAYMENTS_STUDENT_LOAN_PAYMENT"),
      tx(`2026-${m}-07`, -93_850, "TARGET CORP PAYROLL PPD", "INCOME_WAGES"),
      tx(`2026-${m}-21`, -93_850, "TARGET CORP PAYROLL PPD", "INCOME_WAGES"),
    ]),
  ],
};

describe("what a student loan costs each month", () => {
  it("is the payment made each month", () => {
    const plan = runDetectors({ profile: buildProfile(data), data }).find(
      (s) => s.topic === "student_repayment",
    );
    expect(plan?.why).toMatch(/^You pay about \$217\.40 a month on student loans\./);
  });
});
