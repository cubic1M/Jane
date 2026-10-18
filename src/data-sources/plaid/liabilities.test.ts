import type { LiabilitiesObject } from "plaid";
import { describe, expect, it } from "vitest";
import { cardApr, normalizeLiabilities, toBps } from "./liabilities";

// Shaped like Plaid's sandbox /liabilities/get response for user_good.
const SANDBOX = {
  credit: [
    {
      account_id: "acc_card",
      aprs: [
        {
          apr_percentage: 15.24,
          apr_type: "balance_transfer_apr",
          balance_subject_to_apr: 1562.32,
          interest_charge_amount: 130.22,
        },
        {
          apr_percentage: 27.95,
          apr_type: "cash_apr",
          balance_subject_to_apr: 56.22,
          interest_charge_amount: 14.81,
        },
        {
          apr_percentage: 12.5,
          apr_type: "purchase_apr",
          balance_subject_to_apr: 157.01,
          interest_charge_amount: 25.66,
        },
      ],
      is_overdue: false,
      last_payment_amount: 168.25,
      last_payment_date: "2019-05-22",
      last_statement_issue_date: "2019-05-28",
      last_statement_balance: 1708.77,
      minimum_payment_amount: 20,
      next_payment_due_date: "2020-05-28",
    },
  ],
  mortgage: [
    {
      account_id: "acc_mortgage",
      account_number: "3120194154",
      current_late_fee: 25,
      escrow_balance: 3141.54,
      has_pmi: true,
      has_prepayment_penalty: true,
      interest_rate: { percentage: 3.99, type: "fixed" },
      last_payment_amount: 3141.54,
      last_payment_date: "2019-08-01",
      loan_term: "30 year",
      loan_type_description: "conventional",
      maturity_date: "2045-07-31",
      next_monthly_payment: 3141.54,
      next_payment_due_date: "2019-11-15",
      origination_date: "2015-08-01",
      origination_principal_amount: 425000,
      past_due_amount: 2304,
      property_address: {
        city: "Malakoff",
        country: "US",
        postal_code: "14236",
        region: "NY",
        street: "2992 Cameron Road",
      },
      ytd_interest_paid: 12300.4,
      ytd_principal_paid: 12340.5,
    },
  ],
  student: [
    {
      account_id: "acc_student",
      account_number: "4277075694",
      disbursement_dates: ["2002-08-28"],
      expected_payoff_date: "2032-07-28",
      guarantor: "DEPT OF ED",
      interest_rate_percentage: 5.25,
      is_overdue: false,
      last_payment_amount: 138.05,
      last_payment_date: "2019-04-22",
      last_statement_issue_date: "2019-04-28",
      loan_name: "Consolidation",
      loan_status: { end_date: "2032-07-28", type: "repayment" },
      minimum_payment_amount: 25,
      next_payment_due_date: "2019-05-28",
      origination_date: "2002-08-28",
      origination_principal_amount: 25000,
      outstanding_interest_amount: 6227.36,
      payment_reference_number: "4277075694",
      pslf_status: {
        estimated_eligibility_date: null,
        payments_made: null,
        payments_remaining: null,
      },
      repayment_plan: { description: "Standard Repayment", type: "standard" },
      sequence_number: "1",
      servicer_address: {
        city: "San Matias",
        country: "US",
        postal_code: "99415",
        region: "CA",
        street: "123 Relaxation Road",
      },
      ytd_interest_paid: 280.55,
      ytd_principal_paid: 271.65,
    },
  ],
  loan: [
    {
      account_id: "acc_auto",
      account_number: null,
      interest_rate: { percentage: 6.9, type: "fixed" },
      principal_balance: 18000,
      origination_principal_amount: 25000,
      origination_date: "2023-03-01",
      loan_term_months: 60,
      maturity_date: "2028-03-01",
      payment_count: null,
      payment_frequency: null,
      next_payment_amount: 494.1,
      next_payment_due_date: "2026-11-01",
      last_payment_amount: 494.1,
      last_payment_date: "2026-10-01",
      payoff_amount: null,
      ytd_interest_paid: 1100.25,
      compounding_period: null,
    },
  ],
} as unknown as LiabilitiesObject;

describe("Plaid liabilities", () => {
  it("turns percentages into basis points, and refuses impossible rates", () => {
    expect(toBps(12.5)).toBe(1250);
    expect(toBps(3.99)).toBe(399);
    expect(toBps(0)).toBe(0);
    expect(toBps(null)).toBeNull();
    expect(toBps(-1)).toBeNull();
    expect(toBps(250)).toBeNull();
    expect(toBps(Number.NaN)).toBeNull();
  });

  it("uses a card's purchase APR, or the first one listed", () => {
    expect(cardApr(SANDBOX.credit![0].aprs)).toBe(1250);
    expect(cardApr([SANDBOX.credit![0].aprs[1]])).toBe(2795);
    expect(cardApr([])).toBeNull();
  });

  it("reads cards, mortgages, student loans and other loans in cents and basis points", () => {
    const rows = normalizeLiabilities(SANDBOX);
    expect(rows.map((r) => [r.accountRef, r.kind])).toEqual([
      ["acc_card", "credit"],
      ["acc_mortgage", "mortgage"],
      ["acc_student", "student"],
      ["acc_auto", "loan"],
    ]);
    const [card, mortgage, student, auto] = rows;
    expect(card).toMatchObject({
      aprBps: 1250,
      minimumPaymentCents: 2000,
      nextPaymentDueDate: "2020-05-28",
      isOverdue: false,
    });
    expect(mortgage).toMatchObject({
      aprBps: 399,
      rateType: "fixed",
      minimumPaymentCents: 314_154,
      payoffDate: "2045-07-31",
      originationPrincipalCents: 42_500_000,
      pastDueCents: 230_400,
      isOverdue: true,
      ytdInterestPaidCents: 1_230_040,
      description: "conventional",
    });
    expect(student).toMatchObject({
      aprBps: 525,
      minimumPaymentCents: 2500,
      payoffDate: "2032-07-28",
      description: "Consolidation",
    });
    expect(auto).toMatchObject({
      aprBps: 690,
      minimumPaymentCents: 49_410,
      payoffDate: "2028-03-01",
    });
  });

  it("never keeps account numbers, addresses or reference numbers", () => {
    const stored = JSON.stringify(normalizeLiabilities(SANDBOX));
    for (const secret of [
      "3120194154",
      "4277075694",
      "Cameron Road",
      "Relaxation Road",
      "DEPT OF ED",
    ]) {
      expect(stored).not.toContain(secret);
    }
  });

  it("copes with empty lists and missing values", () => {
    expect(normalizeLiabilities({ credit: null, mortgage: null, student: null })).toEqual([]);
    const [card] = normalizeLiabilities({
      credit: [
        {
          account_id: "acc_card",
          aprs: [],
          is_overdue: null,
          last_payment_amount: null,
          last_payment_date: "not a date",
          last_statement_issue_date: null,
          last_statement_balance: null,
          minimum_payment_amount: null,
          next_payment_due_date: null,
        },
      ],
      mortgage: null,
      student: null,
    } as unknown as LiabilitiesObject);
    expect(card).toMatchObject({ aprBps: null, minimumPaymentCents: null, lastPaymentDate: null });
  });
});
