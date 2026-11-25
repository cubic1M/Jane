import { describe, expect, it } from "vitest";
import { AS_OF, CHECKING, input, plaidStream, tx } from "./__fixtures__/build";
import { upcomingBills } from "./forecast";
import { addDays } from "./units";

// CodeRabbit 1c detn-01 #5: a Pay in 4's payments left were dropped when ANY stream, even a
// tombstoned one, held a charge to the same provider at the same amount.
const KLARNA = {
  description: "KLARNA* NIKE.COM",
  merchantName: null,
  pfcPrimary: "LOAN_PAYMENTS",
  pfcDetailed: "LOAN_PAYMENTS_OTHER_PAYMENT",
  accountId: CHECKING.id,
  amountCents: 3_249,
};

const klarnaDates = (stream: ReturnType<typeof plaidStream> | null) => {
  const transactions = [-21, -7].map((d, i) =>
    tx({ ...KLARNA, date: addDays(AS_OF, d), plaidTransactionId: `pt_${i}` }),
  );
  return upcomingBills(input({ transactions, recurringStreams: stream ? [stream] : [] }), 61)
    .filter((b) => /klarna/i.test(b.merchant))
    .map((b) => b.date);
};

describe("a new Pay in 4 beside a stream that has stopped", () => {
  const streamWith = (over: Partial<ReturnType<typeof plaidStream>>) =>
    plaidStream({
      accountId: CHECKING.id,
      merchantName: "Klarna",
      frequency: "BIWEEKLY",
      lastAmountCents: 3_249,
      averageAmountCents: 3_249,
      pfcPrimary: "LOAN_PAYMENTS",
      pfcDetailed: "LOAN_PAYMENTS_OTHER_PAYMENT",
      transactionIds: ["pt_0", "pt_1"],
      ...over,
    });

  it("still expects the plan's payments left when the stream is tombstoned", () => {
    expect(klarnaDates(streamWith({ status: "TOMBSTONED", isActive: false }))).toEqual([
      "2026-10-22",
      "2026-11-05",
    ]);
  });

  it("leaves the plan to a live stream that already expects them", () => {
    const dates = klarnaDates(streamWith({ status: "MATURE", isActive: true }));
    expect(new Set(dates).size).toBe(dates.length);
  });
});
