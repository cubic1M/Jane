import { describe, expect, it } from "vitest";
import {
  CARD,
  GROCERIES,
  HULU,
  NETFLIX,
  input,
  monthly,
  monthsAgo,
  plaidStream,
  tx,
} from "./__fixtures__/build";
import { buildStreams, detectRecurring } from "./streams";

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

  it("needs at least three charges", () => {
    expect(detectRecurring(input({ transactions: monthly(2, 1549, NETFLIX) }))).toEqual([]);
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
