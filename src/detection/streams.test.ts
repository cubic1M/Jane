import { describe, expect, it } from "vitest";
import {
  AS_OF,
  CARD,
  GROCERIES,
  HULU,
  NETFLIX,
  SPOTIFY,
  input,
  monthly,
  monthsAgo,
  plaidStream,
  tx,
} from "./__fixtures__/build";
import { buildStreams, detectRecurring } from "./streams";
import { addDays } from "./units";

const RENT = { pfcPrimary: "RENT_AND_UTILITIES", pfcDetailed: "RENT_AND_UTILITIES_RENT" };

describe("fallback recurring detection", () => {
  it("finds a monthly charge with steady amounts", () => {
    const [stream] = detectRecurring(input({ transactions: monthly(4, 1549, NETFLIX) }));

    expect(stream).toMatchObject({
      key: "merchant:netflix",
      merchant: "Netflix",
      frequency: "MONTHLY",
      lastAmountCents: 1549,
      priorAverageCents: 1549,
      priorCount: 3,
      annualCostCents: 1549 * 12,
      pfcDetailed: "ENTERTAINMENT_TV_AND_MOVIES",
      active: true,
      confidence: "medium",
    });
    expect(stream.charges).toHaveLength(4);
  });

  it("rates six or more charges high confidence", () => {
    const [stream] = detectRecurring(input({ transactions: monthly(6, 1549, NETFLIX) }));

    expect(stream.confidence).toBe("high");
  });

  it("finds weekly charges", () => {
    const transactions = ["2026-09-17", "2026-09-24", "2026-10-01", "2026-10-08"].map((date) =>
      tx({ ...NETFLIX, date }),
    );

    const [stream] = detectRecurring(input({ transactions }));

    expect(stream.frequency).toBe("WEEKLY");
    expect(stream.annualCostCents).toBe(1000 * 52);
  });

  it("needs at least three charges, or two a month apart for a bill or a subscription", () => {
    const shop = { ...GROCERIES, pfcPrimary: "GENERAL_MERCHANDISE", pfcDetailed: null };
    expect(detectRecurring(input({ transactions: monthly(2, 4999, shop) }))).toEqual([]);

    const [stream] = detectRecurring(input({ transactions: monthly(2, 1549, NETFLIX) }));
    expect(stream).toMatchObject({ frequency: "MONTHLY", confidence: "low" });
    expect(
      detectRecurring(input({ transactions: monthly(2, 9000, { ...GROCERIES, ...RENT }) })),
    ).toHaveLength(1);

    // Two a week apart is a second purchase.
    const week = ["2026-10-01", "2026-10-08"].map((date) => tx({ ...NETFLIX, date }));
    expect(detectRecurring(input({ transactions: week }))).toEqual([]);
  });

  it("isn't fooled by a few of a shop's many charges landing a month apart", () => {
    // Weekly groceries, small and big; three middling ones happen to come a month apart.
    const weekly = Array.from({ length: 10 }, (_, i) =>
      tx({ ...GROCERIES, date: addDays(AS_OF, -7 * i - 1), amountCents: i % 2 ? 5_000 : 15_000 }),
    );
    const alike = [0, 28, 56].map((days) =>
      tx({ ...GROCERIES, date: addDays(AS_OF, -days - 3), amountCents: 10_000 + days }),
    );

    expect(detectRecurring(input({ transactions: [...weekly, ...alike] }))).toEqual([]);
    // Alone, the three are a run.
    expect(detectRecurring(input({ transactions: alike }))).toHaveLength(1);
  });

  it("finds each subscription billed through an app store, at its own price", () => {
    const apple = { description: "APPLE.COM/BILL 866-712-7753 CA", pfcDetailed: null };
    const transactions = [
      ...monthly(4, 99, apple).map((t) => ({ ...t, date: t.date.slice(0, 8) + "05" })),
      ...monthly(4, 1099, apple),
      tx({ ...apple, date: monthsAgo(2, 20), amountCents: 499 }),
    ];

    const streams = detectRecurring(input({ transactions }));

    expect(streams.map((s) => [s.key, s.merchantKey, s.lastAmountCents])).toEqual([
      ["merchant:apple", "apple", 99],
      ["merchant:apple@1099", "apple", 1099],
    ]);
  });

  it("finds a yearly plan seen once, under the plan's own name", () => {
    const prime = { description: "AMAZON PRIME*2K4AB7XY0", pfcDetailed: null };
    const once = (description: string, amountCents: number) =>
      detectRecurring(
        input({ transactions: [tx({ ...prime, description, date: monthsAgo(5), amountCents })] }),
      );

    expect(once(prime.description, 13_900)).toEqual([
      expect.objectContaining({
        key: "merchant:amazon prime",
        frequency: "ANNUALLY",
        annualCostCents: 13_900,
        confidence: "low",
        active: true,
      }),
    ]);
    expect(once("DUOLINGO PLUS", 8_399)).toHaveLength(1);
    // A rental, something else the company sells, a one-off too small or too big.
    expect(once("AMAZON PRIME VIDEO*2K4", 13_900)).toEqual([]);
    expect(once("ADOBE STOCK 408-536-6000", 7_999)).toEqual([]);
    expect(once(prime.description, 499)).toEqual([]);
    expect(once("PELOTON* BIKE", 144_500)).toEqual([]);
    // Something from the company's shop, at a plan's price (accuracy bench, second held-out set).
    expect(once("PELOTON* APPAREL", 10_001)).toEqual([]);
    expect(once("NYTIMES*STORE", 8_500)).toEqual([]);
    // The plan named after the "*", cut short by the bank, is the plan, and a subscription.
    expect(once("MICROSOFT*MICROSOFT 365 P", 9_999)).toEqual([
      expect.objectContaining({ key: "merchant:microsoft", namedPlan: true }),
    ]);
    expect(once("MSFT * MICROSOFT 365 FAMILY", 12_999)).toHaveLength(1);
    expect(once("MICROSOFT*XBOX GAME 4K2", 6_999)).toEqual([]);
    // Two of them in a year aren't a yearly plan.
    const twice = [3, 8].map((m) => tx({ ...prime, date: monthsAgo(m), amountCents: 13_900 }));
    expect(detectRecurring(input({ transactions: twice }))).toEqual([]);
  });

  it("joins one service written two ways, and nothing else", () => {
    const at = (m: number, description: string, amountCents = 7999) =>
      tx({ description, merchantName: null, pfcDetailed: null, date: monthsAgo(m), amountCents });
    const keys = (transactions: ReturnType<typeof tx>[]) =>
      detectRecurring(input({ transactions })).map((s) => s.key);

    // The name and the website, with the city after each.
    expect(
      keys([
        at(4, "DIRECTV STREAM SEATTLE WA"),
        at(3, "DIRECTV STREAM SEATTLE WA"),
        at(2, "DIRECTV.COM SEATTLE WA"),
        at(1, "DIRECTV STREAM SEATTLE WA"),
      ]),
    ).toEqual(["merchant:directv stream seattle"]);
    // Rides and food from one company, at prices that don't match, stay apart.
    expect(
      keys([
        at(4, "ACME RIDES", 1_250),
        at(3, "ACME RIDES", 1_250),
        at(2, "ACME RIDES", 1_250),
        at(1, "ACME", 2_310),
      ]),
    ).toEqual(["merchant:acme rides"]);
  });

  it("lists two plans from one company at two prices as two streams", () => {
    const at = (m: number, amountCents: number, day: number) =>
      tx({ ...SPOTIFY, id: `s-${m}-${amountCents}`, date: monthsAgo(m, day), amountCents });
    const transactions = [4, 3, 2, 1].flatMap((m) => [at(m, 1199, 5), at(m, 1699, 18)]);

    expect(detectRecurring(input({ transactions })).map((s) => [s.key, s.lastAmountCents])).toEqual(
      [
        ["merchant:spotify usa", 1199],
        ["merchant:spotify usa@1699", 1699],
      ],
    );
  });

  it("lists two plans billed together every month as two streams", () => {
    const twice = (m: number) => {
      const [a] = monthly(1, 1199, SPOTIFY).map((t) => ({ ...t, date: monthsAgo(m) }));
      return [a, { ...a, id: `${a.id}-b` }];
    };
    const streams = detectRecurring(input({ transactions: [4, 3, 2, 1].flatMap(twice) }));

    expect(streams.map((s) => [s.key, s.charges.length, s.frequency])).toEqual([
      ["merchant:spotify usa", 4, "MONTHLY"],
      ["merchant:spotify usa@second", 4, "MONTHLY"],
    ]);
  });

  it("ignores charges at irregular gaps", () => {
    const transactions = ["2026-07-02", "2026-07-20", "2026-09-28", "2026-10-03"].map((date) =>
      tx({ ...GROCERIES, date, amountCents: 5000 }),
    );

    expect(detectRecurring(input({ transactions }))).toEqual([]);
  });

  it("ignores a merchant whose amounts vary by more than 10%", () => {
    const transactions = monthly(5, [4000, 6100, 3200, 7800, 5000], GROCERIES);

    expect(detectRecurring(input({ transactions }))).toEqual([]);
  });

  it("keeps a new, higher price at the same gap as the newest charge", () => {
    const [stream] = detectRecurring(
      input({ transactions: monthly(5, [1549, 1549, 1549, 1549, 1799], NETFLIX) }),
    );

    expect(stream.charges).toHaveLength(5);
    expect(stream).toMatchObject({ lastAmountCents: 1799, priorAverageCents: 1549 });
  });

  it("skips one-off purchases at the same merchant", () => {
    const transactions = [
      ...monthly(4, 1549, NETFLIX),
      tx({ ...NETFLIX, date: monthsAgo(1, 3), amountCents: 399 }),
    ];

    const [stream] = detectRecurring(input({ transactions }));

    expect(stream.charges.map((c) => c.amountCents)).toEqual([1549, 1549, 1549, 1549]);
  });

  it("marks a stream inactive when the last charge is long overdue", () => {
    const transactions = [5, 4, 3].map((m) =>
      tx({ ...NETFLIX, date: monthsAgo(m), amountCents: 1549 }),
    );

    const [stream] = detectRecurring(input({ transactions }));

    expect(stream.active).toBe(false);
  });

  it("ignores money coming in", () => {
    expect(detectRecurring(input({ transactions: monthly(4, -250000, {}) }))).toEqual([]);
  });

  it("ignores charges outside the lookback window", () => {
    const transactions = ["2025-01-15", "2025-02-15", "2025-03-15"].map((date) =>
      tx({ ...NETFLIX, date }),
    );

    expect(detectRecurring(input({ transactions }))).toEqual([]);
  });
});

describe("buildStreams", () => {
  it("uses Plaid streams for the accounts they cover and the fallback for the rest", () => {
    const onCard = monthly(4, 1549, { ...NETFLIX, accountId: CARD.id });
    const onChecking = monthly(4, 1199, { ...HULU });
    const hulu = plaidStream({ merchantName: "Spotify" });

    expect(buildStreams(input({ transactions: onCard })).map((s) => s.merchant)).toEqual([
      "Netflix",
    ]);
    // The card has Plaid streams, so its charges aren't detected twice; the CSV checking
    // account still gets the fallback.
    expect(
      buildStreams(
        input({ transactions: [...onCard, ...onChecking], recurringStreams: [hulu] }),
      ).map((s) => s.merchant),
    ).toEqual(["Spotify", "Hulu"]);
  });

  it("keeps the Plaid stream when the fallback finds the same merchant elsewhere", () => {
    const onChecking = monthly(4, 1549, NETFLIX);

    expect(
      buildStreams(input({ transactions: onChecking, recurringStreams: [plaidStream()] })).map(
        (s) => [s.merchant, s.confidence],
      ),
    ).toEqual([["Netflix", "high"]]);
  });

  it("maps Plaid streams, matching their transactions by Plaid id", () => {
    const transactions = monthly(3, [1549, 1549, 1799], {
      ...NETFLIX,
      accountId: CARD.id,
    }).map((t, i) => ({ ...t, plaidTransactionId: `ptx_${i}` }));

    const [stream] = buildStreams(
      input({
        transactions,
        recurringStreams: [
          plaidStream({ lastAmountCents: 1799, transactionIds: ["ptx_0", "ptx_1", "ptx_2"] }),
        ],
      }),
    );

    expect(stream).toMatchObject({
      key: "merchant:netflix",
      frequency: "MONTHLY",
      lastAmountCents: 1799,
      priorAverageCents: 1549,
      priorCount: 2,
      annualCostCents: 1799 * 12,
      active: true,
      confidence: "high",
    });
  });

  it("uses Plaid's status for confidence and activity", () => {
    const streams = buildStreams(
      input({
        recurringStreams: [
          plaidStream({ plaidStreamId: "a", status: "EARLY_DETECTION" }),
          plaidStream({ plaidStreamId: "b", status: "TOMBSTONED" }),
          plaidStream({ plaidStreamId: "c", status: "UNKNOWN", isActive: false }),
        ],
      }),
    );

    expect(streams.map((s) => [s.confidence, s.active])).toEqual([
      ["medium", true],
      ["low", false],
      ["low", false],
    ]);
  });

  it("leaves out inflow streams and has no annual cost for unknown frequencies", () => {
    const streams = buildStreams(
      input({
        recurringStreams: [
          plaidStream({ plaidStreamId: "pay", averageAmountCents: -300000 }),
          plaidStream({ plaidStreamId: "odd", frequency: "UNKNOWN" }),
        ],
      }),
    );

    expect(streams).toHaveLength(1);
    expect(streams[0]).toMatchObject({ frequency: null, annualCostCents: null });
  });

  it("is stable whatever order the rows arrive in", () => {
    const transactions = [...monthly(4, 1549, NETFLIX), ...monthly(4, 1199, HULU)];

    expect(buildStreams(input({ transactions: [...transactions].reverse() }))).toEqual(
      buildStreams(input({ transactions })),
    );
  });
});
