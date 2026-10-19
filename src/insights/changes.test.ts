import { describe, expect, it } from "vitest";
import {
  AS_OF,
  CARD,
  CHECKING,
  GROCERIES,
  NETFLIX,
  SPOTIFY,
  input,
  monthly,
  monthsAgo,
  tx,
} from "@/detection/__fixtures__/build";
import { buildStreams } from "@/detection/streams";
import type { DetectionInput, DetectionTransaction } from "@/detection/types";
import { addDays } from "@/detection/units";
import {
  billChanges,
  detectChanges,
  newFees,
  newSubscriptions,
  paceChanges,
  paycheckChanges,
} from "./changes";

// Spec step 97: each rule for what changed, with its edge cases. AS_OF is 2026-10-15.

const withStreams = (data: DetectionInput) => [data, buildStreams(data)] as const;
const bills = (transactions: DetectionTransaction[], asOf = AS_OF) =>
  billChanges(...withStreams(input({ transactions, asOf })));

describe("billChanges", () => {
  it("spots a bill that went up from a steady price", () => {
    const [change] = bills(monthly(6, [1549, 1549, 1549, 1549, 1549, 1799], NETFLIX));
    expect(change).toMatchObject({
      kind: "bill_changed",
      key: "bill:merchant:netflix:1799",
      title: "Netflix went up from $15.49 to $17.99.",
      amountCents: 1799,
      usualCents: 1549,
      up: true,
      streamKey: "merchant:netflix",
    });
  });

  it("spots one that went down", () => {
    const [change] = bills(monthly(6, [1799, 1799, 1799, 1799, 1799, 1549], NETFLIX));
    expect(change).toMatchObject({ title: "Netflix went down from $17.99 to $15.49.", up: false });
  });

  it("leaves small moves, unsteady prices, old changes and everyday spending alone", () => {
    // Under 5% and under the minimum.
    expect(bills(monthly(6, [1549, 1549, 1549, 1549, 1549, 1569], NETFLIX))).toEqual([]);
    // The price was never steady.
    expect(bills(monthly(6, [1500, 1600, 1450, 1650, 1500, 1999], NETFLIX))).toEqual([]);
    // The rise was a month ago: old news.
    expect(
      bills(monthly(6, [1549, 1549, 1549, 1549, 1799, 1799], NETFLIX), addDays(AS_OF, 1)),
    ).toEqual([]);
    // Groceries vary on purpose.
    expect(bills(monthly(6, [9000, 9000, 9000, 9000, 9000, 12_000], GROCERIES))).toEqual([]);
  });
});

describe("newSubscriptions", () => {
  const old = tx({ date: monthsAgo(8), amountCents: 500, description: "COFFEE" });

  it("spots a regular charge that started lately", () => {
    const transactions = [old, ...monthly(3, 1199, { ...SPOTIFY, accountId: CARD.id })];
    const [change] = newSubscriptions(...withStreams(input({ transactions })));
    expect(change).toMatchObject({
      kind: "new_subscription",
      key: "new:merchant:spotify usa",
      title: "Spotify Usa is a new regular charge: $11.99, since Aug 15.",
      merchant: "Spotify Usa",
    });
  });

  it("isn't fooled by a fresh import or a long-running charge", () => {
    // Only two months of history: everything would look new.
    const fresh = monthly(3, 1199, SPOTIFY);
    expect(newSubscriptions(...withStreams(input({ transactions: fresh })))).toEqual([]);
    const longRunning = [old, ...monthly(8, 1199, SPOTIFY)];
    expect(newSubscriptions(...withStreams(input({ transactions: longRunning })))).toEqual([]);
  });
});

describe("paycheckChanges", () => {
  const PAYROLL = {
    description: "ACME CORP PAYROLL",
    pfcPrimary: "INCOME",
    pfcDetailed: "INCOME_SALARY",
  };
  // Every two weeks, the last one on `last`, oldest first.
  const paychecks = (last: string, amounts: number[], over = PAYROLL) =>
    amounts.map((amount, i) =>
      tx({ ...over, date: addDays(last, -14 * (amounts.length - 1 - i)), amountCents: -amount }),
    );
  const changes = (transactions: DetectionTransaction[]) =>
    paycheckChanges(input({ transactions }));

  it("says a paycheck is late a few days after it was due", () => {
    const [change] = changes(paychecks("2026-09-24", [245_000, 245_000, 245_000, 245_000]));
    expect(change).toMatchObject({
      kind: "paycheck_late",
      key: "late:acme corp:2026-10-08",
      date: "2026-10-08",
      title:
        "Your paycheck from Acme Corp hasn't come in. It usually arrives around Oct 8; the last one was on Sep 24.",
    });
  });

  it("doesn't call it late before then, or forever after", () => {
    expect(changes(paychecks("2026-10-08", [245_000, 245_000, 245_000]))).toEqual([]);
    // Due Oct 13, so not late until after Oct 16.
    expect(changes(paychecks("2026-09-29", [245_000, 245_000, 245_000]))).toEqual([]);
    // Due in August: that job ended, it's no longer news.
    expect(changes(paychecks("2026-08-01", [245_000, 245_000, 245_000]))).toEqual([]);
  });

  it("spots a smaller paycheck, not normal wobble", () => {
    const [change] = changes(paychecks("2026-10-08", [245_000, 245_000, 245_000, 180_000]));
    expect(change).toMatchObject({
      kind: "paycheck_smaller",
      title:
        "Your paycheck from Acme Corp was smaller than usual: $1,800.00 on Oct 8, where it's usually $2,450.00.",
      amountCents: 180_000,
      usualCents: 245_000,
    });
    expect(changes(paychecks("2026-10-08", [245_000, 245_000, 245_000, 233_000]))).toEqual([]);
  });

  it("spots a paycheck from a new employer, only next to an old one", () => {
    const newJob = tx({
      description: "GLOBEX PAYROLL",
      pfcPrimary: "INCOME",
      pfcDetailed: "INCOME_WAGES",
      date: "2026-10-10",
      amountCents: -300_000,
    });
    const found = changes([...paychecks("2026-10-08", [245_000, 245_000, 245_000]), newJob]);
    expect(found).toEqual([
      expect.objectContaining({
        kind: "new_employer",
        key: "employer:globex",
        title: "A paycheck from a new employer: $3,000.00 from Globex on Oct 10.",
      }),
    ]);
    // A first paycheck ever isn't a new employer.
    expect(changes([newJob])).toEqual([]);
  });

  it("ignores money in that isn't pay", () => {
    const interest = { ...PAYROLL, pfcDetailed: "INCOME_INTEREST_EARNED" };
    expect(changes(paychecks("2026-09-01", [102, 102, 102, 50], interest))).toEqual([]);
  });
});

describe("paceChanges", () => {
  const SHOPPING = { description: "STORE", pfcPrimary: "GENERAL_MERCHANDISE" };
  // $100 a month for three months, on the 5th.
  const usual = [3, 2, 1].map((m) =>
    tx({ ...SHOPPING, date: monthsAgo(m, 5), amountCents: 10_000 }),
  );
  const pace = (transactions: DetectionTransaction[], asOf = AS_OF) =>
    paceChanges(input({ transactions, asOf }));

  it("spots a category running well above its usual pace", () => {
    const [change] = pace([...usual, tx({ ...SHOPPING, date: "2026-10-12", amountCents: 40_000 })]);
    expect(change).toMatchObject({
      kind: "category_pace",
      key: "pace:Shopping:2026-10",
      title:
        "You've spent $400.00 on Shopping so far this month. By now you'd usually have spent about $48.39.",
      amountCents: 40_000,
      usualCents: 4839,
      category: "Shopping",
      usualMonthCents: 10_000,
    });
  });

  it("leaves a usual month, a small overspend and a refund alone", () => {
    expect(pace([...usual, tx({ ...SHOPPING, date: "2026-10-12", amountCents: 9_000 })])).toEqual(
      [],
    );
    // Above pace, but by less than $100.
    expect(pace([...usual, tx({ ...SHOPPING, date: "2026-10-12", amountCents: 14_000 })])).toEqual(
      [],
    );
    // A big buy returned.
    expect(
      pace([
        ...usual,
        tx({ ...SHOPPING, date: "2026-10-10", amountCents: 50_000 }),
        tx({ ...SHOPPING, date: "2026-10-12", amountCents: -50_000 }),
      ]),
    ).toEqual([]);
  });

  it("early in the month, counts only spending past a whole usual month", () => {
    const usual200 = usual.map((t) => ({ ...t, amountCents: 20_000 }));
    const early = "2026-10-03";
    expect(
      pace([...usual200, tx({ ...SHOPPING, date: "2026-10-02", amountCents: 15_000 })], early),
    ).toEqual([]);
    expect(
      pace([...usual200, tx({ ...SHOPPING, date: "2026-10-02", amountCents: 25_000 })], early),
    ).toHaveLength(1);
  });

  it("skips rent and fees, and needs whole months of history", () => {
    const RENT = { description: "RENT", pfcPrimary: "RENT_AND_UTILITIES" };
    const rent = [3, 2, 1].map((m) => tx({ ...RENT, date: monthsAgo(m, 5), amountCents: 10_000 }));
    expect(pace([...rent, tx({ ...RENT, date: "2026-10-12", amountCents: 40_000 })])).toEqual([]);
    // Only since last month.
    expect(pace([usual[2], tx({ ...SHOPPING, date: "2026-10-12", amountCents: 40_000 })])).toEqual(
      [],
    );
  });
});

describe("newFees", () => {
  const OVERDRAFT = {
    description: "OVERDRAFT FEE",
    pfcPrimary: "BANK_FEES",
    pfcDetailed: "BANK_FEES_OVERDRAFT_FEES",
    amountCents: 3400,
  };
  const SERVICE = {
    description: "MONTHLY SERVICE FEE",
    pfcPrimary: "BANK_FEES",
    pfcDetailed: "BANK_FEES_OTHER_BANK_FEES",
    amountCents: 1200,
  };
  const fees = (transactions: DetectionTransaction[]) => newFees(input({ transactions }));

  it("spots a fee not charged in the months before", () => {
    const fee = tx({ ...OVERDRAFT, date: "2026-10-10" });
    const [change] = fees([tx({ ...OVERDRAFT, date: "2026-06-01" }), fee]);
    expect(change).toMatchObject({
      kind: "new_fee",
      key: `fee:${fee.id}`,
      title: "An overdraft fee of $34.00 on Everyday Checking, on Oct 10.",
      amountCents: 3400,
      accountId: CHECKING.id,
    });
  });

  it("doesn't call a monthly fee new every month, or an old fee news", () => {
    expect(fees(monthly(4, 1200, SERVICE))).toEqual([]);
    expect(fees([tx({ ...OVERDRAFT, date: "2026-09-20" })])).toEqual([]);
  });

  it("counts a fee of a new amount as new", () => {
    const found = fees([
      tx({ ...OVERDRAFT, date: "2026-09-01" }),
      tx({ ...OVERDRAFT, date: "2026-10-10", amountCents: 3600 }),
    ]);
    expect(found).toHaveLength(1);
  });
});

describe("detectChanges", () => {
  it("lists every kind, newest first", () => {
    const transactions = [
      ...monthly(6, [1549, 1549, 1549, 1549, 1549, 1799], { ...NETFLIX, accountId: CARD.id }),
      tx({
        description: "OVERDRAFT FEE",
        pfcPrimary: "BANK_FEES",
        pfcDetailed: "BANK_FEES_OVERDRAFT_FEES",
        amountCents: 3400,
        date: "2026-10-14",
      }),
    ];
    const found = detectChanges(...withStreams(input({ transactions })));
    expect(found.map((c) => c.kind)).toEqual(["bill_changed", "new_fee"]);
  });
});
