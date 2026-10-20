import { describe, expect, it } from "vitest";
import { kindOf, loanCost, pairLoans, summarize, type Tx } from "./costly-borrowing";

// Spec step 247: costly short-term borrowing found in payments, with its cost in dollars and as
// a yearly rate.

let n = 0;
const tx = (
  date: string,
  amountCents: number,
  description: string,
  pfcDetailed: string | null = null,
  card = false,
): Tx => ({
  id: `t${++n}`,
  date,
  amountCents,
  description,
  pfcDetailed,
  card,
});

describe("kindOf", () => {
  it("spots each kind by category or by name", () => {
    expect(kindOf(tx("2026-01-01", -30000, "X", "LOAN_DISBURSEMENTS_CASH_ADVANCES"))).toBe(
      "payday",
    );
    expect(kindOf(tx("2026-01-01", -30000, "CHECK INTO CASH LOAN"))).toBe("payday");
    expect(kindOf(tx("2026-01-01", -10000, "EARNIN ADVANCE", "LOAN_DISBURSEMENTS_EWA"))).toBe(
      "pay_app",
    );
    expect(kindOf(tx("2026-01-01", 599, "DAVE EXPRESS FEE"))).toBe("pay_app");
    expect(kindOf(tx("2026-01-01", 1000, "CASH ADVANCE FEE", "BANK_FEES_CASH_ADVANCE", true))).toBe(
      "cash_advance",
    );
    expect(kindOf(tx("2026-01-01", 20000, "ATM CASH ADVANCE", null, true))).toBe("cash_advance");
    expect(kindOf(tx("2026-01-01", 3400, "OVERDRAFT FEE", "BANK_FEES_OVERDRAFT_FEES"))).toBe(
      "overdraft",
    );
    expect(
      kindOf(tx("2026-01-01", 3400, "NSF RETURNED ITEM", "BANK_FEES_INSUFFICIENT_FUNDS")),
    ).toBe("overdraft");
    expect(kindOf(tx("2026-01-01", 4500, "STARBUCKS"))).toBeNull();
    // A normal ATM withdrawal on a debit account is not a cash advance.
    expect(kindOf(tx("2026-01-01", 20000, "ATM WITHDRAWAL"))).toBeNull();
  });
});

describe("pairLoans", () => {
  it("matches proceeds to the repayment from the same lender, and the fee is the difference", () => {
    const { loans, open } = pairLoans([
      tx("2026-01-01", -30000, "ADVANCE AMERICA LOAN PROCEEDS", "LOAN_DISBURSEMENTS_CASH_ADVANCES"),
      tx("2026-01-15", 34500, "ADVANCE AMERICA LOAN PAYMENT", "LOAN_PAYMENTS_CASH_ADVANCES"),
      tx("2026-03-01", -20000, "ADVANCE AMERICA LOAN PROCEEDS", "LOAN_DISBURSEMENTS_CASH_ADVANCES"),
    ]);
    expect(loans).toHaveLength(1);
    expect(loans[0]).toMatchObject({
      principalCents: 30000,
      repaidCents: 34500,
      feeCents: 4500,
      days: 14,
    });
    expect(open).toHaveLength(1);
  });
  it("adds a pay advance app's tip to what was repaid", () => {
    const { loans } = pairLoans([
      tx("2026-02-01", -10000, "EARNIN ADVANCE", "LOAN_DISBURSEMENTS_EWA"),
      tx("2026-02-08", 10000, "EARNIN REPAYMENT", "LOAN_PAYMENTS_EWA"),
      tx("2026-02-08", 500, "EARNIN TIP", "BANK_FEES_OTHER_BANK_FEES"),
    ]);
    expect(loans[0]).toMatchObject({ kind: "pay_app", feeCents: 500, days: 7 });
  });
});

describe("summarize", () => {
  const payday = [
    tx("2026-01-01", -30000, "ADVANCE AMERICA LOAN PROCEEDS", "LOAN_DISBURSEMENTS_CASH_ADVANCES"),
    tx("2026-01-15", 34500, "ADVANCE AMERICA LOAN PAYMENT", "LOAN_PAYMENTS_CASH_ADVANCES"),
  ];
  it("puts a payday loan's cost as dollars and a yearly rate (about 391%)", () => {
    const s = summarize(payday, "2026-02-01");
    expect(s.kinds[0]).toMatchObject({ kind: "payday", count: 1, costCents: 4500 });
    expect(s.kinds[0].aprBps).toBe(39_107);
    expect(s.totalYearlyCents).toBe(4500);
    expect(s.cycle).toBe(false);
  });
  it("calls two loans in 120 days a cycle", () => {
    const again = [
      tx("2026-02-20", -30000, "ADVANCE AMERICA LOAN PROCEEDS", "LOAN_DISBURSEMENTS_CASH_ADVANCES"),
      tx("2026-03-06", 34500, "ADVANCE AMERICA LOAN PAYMENT", "LOAN_PAYMENTS_CASH_ADVANCES"),
    ];
    const s = summarize([...payday, ...again], "2026-03-10");
    expect(s.kinds[0]).toMatchObject({ count: 2, costCents: 9000 });
    expect(s.cycle).toBe(true);
  });
  it("counts a card cash advance's fee and interest from day one", () => {
    const s = summarize(
      [
        tx("2026-01-05", 20000, "CASH ADVANCE", null, true),
        tx("2026-01-05", 1000, "CASH ADVANCE FEE", "BANK_FEES_CASH_ADVANCE", true),
      ],
      "2026-02-01",
    );
    const k = s.kinds[0];
    expect(k.kind).toBe("cash_advance");
    // $10 fee plus 29.99% for 30 days on $200 ($4.93).
    expect(k.costCents).toBe(1493);
    expect(k.aprBps).toBeGreaterThan(8_000);
  });
  it("turns overdraft fees into a yearly rate on the small amount they cover", () => {
    const s = summarize(
      [1, 2, 3].map((i) => tx(`2026-0${i}-10`, 3400, "OVERDRAFT FEE", "BANK_FEES_OVERDRAFT_FEES")),
      "2026-04-01",
    );
    expect(s.kinds[0]).toMatchObject({ kind: "overdraft", count: 3, costCents: 10_200 });
    expect(s.kinds[0].aprBps).toBeGreaterThan(1_000_000);
  });
  it("leaves out everything else, and adds the kinds up", () => {
    const s = summarize(
      [
        ...payday,
        tx("2026-01-20", 3400, "OVERDRAFT FEE", "BANK_FEES_OVERDRAFT_FEES"),
        tx("2026-01-21", 900, "COFFEE"),
      ],
      "2026-02-01",
    );
    expect(s.kinds.map((k) => k.kind)).toEqual(["payday", "overdraft"]);
    expect(s.totalYearlyCents).toBe(7_900);
  });
});

describe("loanCost", () => {
  it("prices a 28% PAL on $300 over 6 months", () => {
    const c = loanCost(30_000, 2_800, 6, 2_000);
    expect(c.paymentCents).toBeGreaterThan(5_000);
    expect(c.interestCents).toBeGreaterThan(2_000);
    expect(c.interestCents).toBeLessThan(6_000);
  });
});
