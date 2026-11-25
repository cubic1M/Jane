import { describe, expect, it } from "vitest";
import { CARD, CHECKING, input, monthly, monthsAgo, plaidStream, tx } from "./__fixtures__/build";
import { buildStreams, detectRecurring } from "./streams";

const PLAN = { merchantName: "Nimbus", description: "NIMBUS CLOUD", accountId: CARD.id };

describe("a plan that ended and one charge after it", () => {
  // Five $15 months that ended four months ago, then one $180 charge a month ago.
  const ended = () => monthly(5, 1_500, PLAN).map((t, i) => ({ ...t, date: monthsAgo(9 - i) }));
  const streamsWith = (last: { description: string }) =>
    detectRecurring(
      input({
        transactions: [
          ...ended(),
          tx({ ...PLAN, ...last, date: monthsAgo(1), amountCents: 18_000 }),
        ],
      }),
    );

  it("is a yearly plan when nothing says it is goods", () => {
    expect(streamsWith({ description: "NIMBUS CLOUD" }).map((s) => s.key)).toContain(
      "merchant:nimbus@yearly",
    );
  });

  it("is not a yearly plan when the charge is from the apparel shop", () => {
    expect(streamsWith({ description: "NIMBUS APPAREL" }).map((s) => s.key)).not.toContain(
      "merchant:nimbus@yearly",
    );
  });
});

describe("one service written three ways", () => {
  it("keeps every row of directv, directv stream and directv tv in one group", () => {
    const names = ["DIRECTV", "DIRECTV STREAM", "DIRECTV TV"];
    const rows = Array.from({ length: 6 }, (_, i) =>
      tx({
        description: names[i % 3]!,
        merchantName: null,
        date: monthsAgo(5 - i),
        amountCents: 7_000,
      }),
    );
    const streams = detectRecurring(input({ transactions: rows }));
    const charges = streams.flatMap((s) => s.charges);
    expect(charges).toHaveLength(6);
  });
});

describe("Plaid and fallback streams for the same merchant", () => {
  it("keeps a second plan at the same merchant on another account", () => {
    const plaidCharges = monthly(3, 1_200, {
      ...PLAN,
      merchantName: "Netflix",
      description: "NETFLIX.COM",
      accountId: CARD.id,
    }).map((t, i) => ({ ...t, plaidTransactionId: `p${i}` }));
    const other = monthly(4, 2_000, {
      merchantName: "Netflix",
      description: "NETFLIX.COM",
      accountId: CHECKING.id,
    });
    const data = input({
      transactions: [...plaidCharges, ...other],
      recurringStreams: [
        plaidStream({
          accountId: CARD.id,
          merchantName: "Netflix",
          lastAmountCents: 1_200,
          averageAmountCents: 1_200,
          lastDate: plaidCharges.at(-1)!.date,
          transactionIds: ["p0", "p1", "p2"],
        }),
      ],
    });
    const streams = buildStreams(data);
    expect(streams.map((s) => s.lastAmountCents).sort()).toEqual([1_200, 2_000]);
    expect(new Set(streams.map((s) => s.key)).size).toBe(2);
  });
});

describe("two plans billed through one platform", () => {
  it("the plan that was there first keeps the bare merchant key", () => {
    // $10 monthly for a year; a $5 plan joined later.
    const ten = monthly(8, 1_000, { merchantName: "Apple", description: "APPLE.COM/BILL" });
    const five = monthly(4, 500, { merchantName: "Apple", description: "APPLE.COM/BILL" });
    const streams = detectRecurring(input({ transactions: [...ten, ...five] }));
    const byPrice = new Map(streams.map((s) => [s.lastAmountCents, s.key]));
    expect(byPrice.get(1_000)).toBe("merchant:apple");
    expect(byPrice.get(500)).toBe("merchant:apple@500");
  });
});
