import { describe, expect, it } from "vitest";
import {
  PAYCHECK_MIN_CENTS,
  REFUND_MAX_AGE_DAYS,
  TRIAL_MAX_DAYS,
  TRIAL_MIN_DAYS,
  TRIAL_MIN_FULL_CENTS,
} from "@/config/detection";
import { AS_OF, CARD, CHECKING, GEICO, NETFLIX, input, monthly, tx } from "../__fixtures__/build";
import { forecastAccounts } from "../forecast";
import { isPaycheck } from "../paydays";
import { buildStreams } from "../streams";
import { recurringCharges } from "../subscriptions";
import type { DetectionInput, DetectionTransaction } from "../types";
import { addDays } from "../units";
import { bankFees } from "./bank-fees";
import { chargeAfterCancel } from "./charge-after-cancel";
import { duplicateCharge } from "./duplicate-charge";
import { priceIncrease } from "./price-increase";
import { trialConversion } from "./trial-conversion";

// The edges of the rules that put a dollar figure in front of someone, where Stryker showed a change
// could pass unnoticed: the day a window ends, which side of a refund counts, and rows that must
// not be counted.

const ago = (days: number) => addDays(AS_OF, -days);
const withStreams = (data: DetectionInput) => buildStreams(data);

describe("a double charge", () => {
  const shop = (days: number, over: Partial<DetectionTransaction> = {}) =>
    tx({
      accountId: CARD.id,
      date: ago(days),
      amountCents: 4_999,
      description: "GADGET SHOP 12",
      merchantName: "Gadget Shop",
      pfcPrimary: "GENERAL_MERCHANDISE",
      ...over,
    });
  const run = (transactions: DetectionTransaction[]) => {
    const data = input({ transactions });
    return duplicateCharge(data, withStreams(data));
  };

  it("is forgiven by a refund after the first charge, not by one before it", () => {
    const refund = (days: number) => shop(days, { amountCents: -4_999 });
    expect(run([shop(5), shop(4), refund(3)])).toEqual([]);
    expect(run([shop(5), shop(4), refund(5)])).toEqual([]);
    expect(run([refund(30), shop(5), shop(4)])).toHaveLength(1);
  });

  it("isn't three or more on one day: that's a group's seats", () => {
    expect(run([shop(5), shop(5)])).toHaveLength(1);
    expect(run([shop(5), shop(5), shop(5)])).toEqual([]);
  });

  it("is within a day, and only while it can still be disputed", () => {
    expect(run([shop(5), shop(3)])).toEqual([]);
    expect(run([shop(REFUND_MAX_AGE_DAYS + 1), shop(REFUND_MAX_AGE_DAYS)])).toHaveLength(1);
    expect(run([shop(REFUND_MAX_AGE_DAYS + 2), shop(REFUND_MAX_AGE_DAYS + 1)])).toEqual([]);
  });

  it("is the second charge's amount, once", () => {
    const [finding] = run([shop(5), shop(4)]);
    expect(finding?.amountCents).toBe(4_999);
    expect(finding?.annualSavingsCents).toBe(4_999);
    expect(finding?.evidence.charges).toHaveLength(2);
  });

  it("needs the same order number when both rows have one, and any case reads the same", () => {
    const order = (days: number, description: string) =>
      shop(days, { merchantName: null, description });
    expect(run([order(5, "AMZN Mktp US*2K4L91Z3"), order(5, "AMZN Mktp US*7HQ2MX0PB")])).toEqual(
      [],
    );
    expect(run([order(5, "amzn mktp us*2k4l91z3"), order(5, "amzn mktp us*7hq2mx0pb")])).toEqual(
      [],
    );
    expect(run([order(5, "AMZN Mktp US*2K4L91Z3"), order(5, "AMZN Mktp US")])).toHaveLength(1);
  });
});

describe("a trial that became a charge", () => {
  const plan = { description: "SOME APP", merchantName: "Some App" };
  const run = (transactions: DetectionTransaction[]) => {
    const data = input({ transactions });
    return trialConversion(data, withStreams(data));
  };
  const at = (daysAfterStart: number, full = TRIAL_MIN_FULL_CENTS) =>
    run([
      tx({ ...plan, date: ago(daysAfterStart + 5), amountCents: 100 }),
      tx({ ...plan, date: ago(5), amountCents: full }),
    ]);

  it("has a gap in the window, both ends included", () => {
    expect(at(TRIAL_MIN_DAYS)).toHaveLength(1);
    expect(at(TRIAL_MIN_DAYS - 1)).toEqual([]);
    expect(at(TRIAL_MAX_DAYS)).toHaveLength(1);
    expect(at(TRIAL_MAX_DAYS + 1)).toEqual([]);
  });

  it("wants a full price that's a real one", () => {
    expect(at(10, TRIAL_MIN_FULL_CENTS - 1)).toEqual([]);
  });

  it("ignores a refund when it looks for the first two charges", () => {
    const found = run([
      tx({ ...plan, date: ago(30), amountCents: -300 }),
      tx({ ...plan, date: ago(20), amountCents: 100 }),
      tx({ ...plan, date: ago(5), amountCents: 999 }),
    ]);
    expect(found[0]?.amountCents).toBe(999);
    expect(found[0]?.evidence.charges).toHaveLength(2);
  });
});

describe("a charge after cancelling", () => {
  const data = (rows: DetectionTransaction[], cancelledOn = ago(40)) =>
    input({
      transactions: rows,
      cancelledMerchants: [{ merchantKey: "netflix", cancelledOn }],
    });
  const netflix = (days: number, amountCents = 1_549) =>
    tx({ ...NETFLIX, date: ago(days), amountCents });

  it("counts only money out, from another merchant nothing", () => {
    const found = chargeAfterCancel(
      data([netflix(5), netflix(4, -1_549), tx({ date: ago(5), description: "HULU" })]),
      [],
    );
    expect(found[0]?.amountCents).toBe(1_549);
    expect(found[0]?.evidence.charges).toHaveLength(1);
  });

  it("doesn't count one too old to get back", () => {
    const old = chargeAfterCancel(data([netflix(REFUND_MAX_AGE_DAYS + 1)], ago(200)), []);
    expect(old).toEqual([]);
    const inTime = chargeAfterCancel(data([netflix(REFUND_MAX_AGE_DAYS)], ago(200)), []);
    expect(inTime).toHaveLength(1);
  });

  it("adds them up", () => {
    const found = chargeAfterCancel(data([netflix(10), netflix(5, 2_000)]), []);
    expect(found[0]?.amountCents).toBe(3_549);
    expect(found[0]?.annualSavingsCents).toBe(3_549);
  });
});

describe("a fee's yearly pace", () => {
  const fee = (days: number, amountCents: number, description = "LATE FEE") =>
    tx({
      date: ago(days),
      amountCents,
      description,
      pfcPrimary: "BANK_FEES",
      pfcDetailed: "BANK_FEES_OTHER_BANK_FEES",
    });
  const run = (transactions: DetectionTransaction[]) =>
    bankFees(input({ accounts: [CHECKING], transactions, historyFrom: ago(90) }), [])[0];

  it("needs two real fees: a refund isn't one", () => {
    expect(run([fee(30, 3_000)])?.annualSavingsCents).toBe(3_000);
    expect(run([fee(30, 3_000), fee(20, -500)])?.annualSavingsCents).toBe(2_500);
    expect(run([fee(30, 3_000), fee(20, 3_000)])?.annualSavingsCents).toBe(6_000 * 4);
  });

  it("is sure only when every row was sorted by a rule or the bank", () => {
    expect(run([fee(30, 3_000), fee(20, 3_000)])?.confidence).toBe("high");
    expect(run([fee(30, 3_000), { ...fee(20, 3_000), categorySource: "llm" }])?.confidence).toBe(
      "medium",
    );
  });

  it("says nothing when refunds cover the fees", () => {
    expect(run([fee(30, 3_000), fee(20, -3_000)])).toBeUndefined();
  });
});

describe("a price rise", () => {
  const run = (data: DetectionInput) => priceIncrease(data, withStreams(data));

  it("isn't found on a plan that has stopped", () => {
    const rows = monthly(6, [1549, 1549, 1549, 1549, 1549, 1799], NETFLIX).map((t) => ({
      ...t,
      date: addDays(t.date, -200),
    }));
    expect(run(input({ transactions: rows }))).toEqual([]);
  });

  it("wants two earlier charges to compare with", () => {
    expect(run(input({ transactions: monthly(2, [1549, 1799], NETFLIX) }))).toEqual([]);
    expect(run(input({ transactions: monthly(3, [1549, 1549, 1799], NETFLIX) }))).toHaveLength(1);
  });

  it("isn't a fall", () => {
    expect(run(input({ transactions: monthly(4, [1799, 1799, 1799, 1549], NETFLIX) }))).toEqual([]);
  });

  it("is high confidence only with enough charges before it", () => {
    const few = run(input({ transactions: monthly(3, [1549, 1549, 1799], NETFLIX) }));
    const many = run(
      input({ transactions: monthly(6, [1549, 1549, 1549, 1549, 1549, 1799], NETFLIX) }),
    );
    expect(few[0]?.confidence).not.toBe("high");
    expect(many[0]?.confidence).toBe("high");
  });
});

describe("recurring charges, as listed for a person", () => {
  it("leaves out what has stopped", () => {
    const stopped = monthly(4, 1549, NETFLIX).map((t) => ({ ...t, date: addDays(t.date, -200) }));
    expect(recurringCharges(input({ transactions: stopped }))).toEqual([]);
  });

  it("takes Claude's no on a charge known only by its one price, not on a plan known by name", () => {
    const fixedPrice = {
      description: "ACME MONTHLY SVC",
      merchantName: "Acme Svc",
      pfcPrimary: "GENERAL_SERVICES",
      pfcDetailed: "GENERAL_SERVICES_OTHER_GENERAL_SERVICES",
    };
    const rows = monthly(6, 2500, fixedPrice);
    const [guessed] = recurringCharges(input({ transactions: rows }));
    expect(guessed?.subscription).toBe(true);
    const [declined] = recurringCharges(
      input({ transactions: rows, declinedSubscriptionMerchantKeys: [guessed!.merchantKey] }),
    );
    expect(declined?.subscription).toBe(false);
    const [known] = recurringCharges(
      input({
        transactions: monthly(4, 1549, NETFLIX),
        declinedSubscriptionMerchantKeys: ["netflix"],
      }),
    );
    expect(known?.subscription).toBe(true);
  });

  it("has a yearly cost of a year's charges", () => {
    const [row] = recurringCharges(input({ transactions: monthly(4, 1549, NETFLIX) }));
    expect(row?.annualCostCents).toBe(1549 * 12);
    expect(row?.lastAmountCents).toBe(1549);
  });

  it("gives a next date only when one is coming", () => {
    const [row] = recurringCharges(input({ transactions: monthly(4, 1549, NETFLIX) }));
    expect(row?.nextDate && row.nextDate > AS_OF).toBe(true);
  });
});

describe("a forecast with two checking accounts", () => {
  it("takes each bill from the account it comes out of, not from both", () => {
    const second = { ...CHECKING, id: "acct_second", name: "Second", currentBalanceCents: 50_000 };
    const data = input({
      accounts: [{ ...CHECKING, currentBalanceCents: 20_000 }, second],
      transactions: monthly(4, 9_800, { ...GEICO, accountId: second.id }),
    });
    const [first, other] = forecastAccounts(data, 31);
    expect(first?.bills).toEqual([]);
    expect(first?.days.at(-1)?.balanceCents).toBe(20_000);
    expect(other?.days.at(-1)?.balanceCents).toBe(50_000 - 9_800);
  });
});

describe("a paycheck", () => {
  const deposit = (over: Partial<DetectionTransaction>) =>
    tx({ description: "ACH CREDIT 123", amountCents: -PAYCHECK_MIN_CENTS, ...over });

  it("is big enough, by its size alone only at the limit or over", () => {
    expect(isPaycheck(deposit({ pfcDetailed: "INCOME_WAGES" }))).toBe(true);
    expect(
      isPaycheck(deposit({ pfcDetailed: "INCOME_WAGES", amountCents: -PAYCHECK_MIN_CENTS + 1 })),
    ).toBe(false);
  });

  it("is payroll by its category, or by its words when the category says nothing", () => {
    expect(isPaycheck(deposit({}))).toBe(false);
    expect(isPaycheck(deposit({ description: "ACME CORP PAYROLL" }))).toBe(true);
    expect(isPaycheck(deposit({ description: "X", merchantName: "Acme Payroll" }))).toBe(true);
  });

  it("is never money out", () => {
    expect(
      isPaycheck(deposit({ pfcDetailed: "INCOME_WAGES", amountCents: PAYCHECK_MIN_CENTS })),
    ).toBe(false);
  });
});
