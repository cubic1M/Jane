import { describe, expect, it } from "vitest";
import { derivedBalances } from "./balances";
import { closingBalances } from "@/data-sources/csv/csv-source";

const row = (date: string, balanceCents?: number) => ({
  date,
  amountCents: 0,
  description: "x",
  hints: {},
  ...(balanceCents === undefined ? {} : { balanceCents }),
});

describe("closingBalances", () => {
  it("takes each day's latest balance from a newest-first file (Chase)", () => {
    expect(
      closingBalances([
        row("2026-10-14", 248451),
        row("2026-10-13", 250000),
        row("2026-10-13", 250575),
        row("2026-10-10", 251150),
      ]),
    ).toEqual([
      { date: "2026-10-10", balanceCents: 251150 },
      { date: "2026-10-13", balanceCents: 250000 },
      { date: "2026-10-14", balanceCents: 248451 },
    ]);
  });

  it("and from an oldest-first file (Bank of America)", () => {
    expect(
      closingBalances([
        row("2026-09-02", 118861),
        row("2026-09-02", 120000),
        row("2026-09-05", 438861),
      ]),
    ).toEqual([
      { date: "2026-09-02", balanceCents: 120000 },
      { date: "2026-09-05", balanceCents: 438861 },
    ]);
  });

  it("finds a day's closing row whatever order the day's rows are in", () => {
    // Newest first by day, but oldest first within 10-13: $50 out then $20 out, from $1,000.
    const rows = [
      { ...row("2026-10-14", 92000), amountCents: 1000 },
      { ...row("2026-10-13", 95000), amountCents: 5000 },
      { ...row("2026-10-13", 93000), amountCents: 2000 },
      { ...row("2026-10-12", 100000), amountCents: 0 },
    ];
    expect(closingBalances(rows)).toEqual([
      { date: "2026-10-12", balanceCents: 100000 },
      { date: "2026-10-13", balanceCents: 93000 },
      { date: "2026-10-14", balanceCents: 92000 },
    ]);
  });

  it("is empty for a layout with no balance column", () => {
    expect(closingBalances([row("2026-09-02"), row("2026-09-03")])).toEqual([]);
  });
});

describe("derivedBalances", () => {
  const txns = [
    { date: "2026-07-03", amountCents: 1000 },
    { date: "2026-08-15", amountCents: -50000 },
    { date: "2026-09-10", amountCents: 2500 },
    { date: "2026-10-05", amountCents: 1500 },
  ];

  it("works a bank account back from today: each month end and each day money moved", () => {
    expect(derivedBalances("depository", 100000, txns, "2026-10-27")).toEqual([
      // Before any of them: +15.00 +25.00 out added back, the 500.00 in taken off, +10.00 back.
      { date: "2026-06-30", balanceCents: 100000 + 1500 + 2500 - 50000 + 1000 },
      { date: "2026-07-03", balanceCents: 100000 + 1500 + 2500 - 50000 },
      { date: "2026-07-31", balanceCents: 100000 + 1500 + 2500 - 50000 },
      { date: "2026-08-15", balanceCents: 100000 + 1500 + 2500 },
      { date: "2026-08-31", balanceCents: 100000 + 1500 + 2500 },
      { date: "2026-09-10", balanceCents: 100000 + 1500 },
      { date: "2026-09-30", balanceCents: 100000 + 1500 },
      { date: "2026-10-05", balanceCents: 100000 },
      { date: "2026-10-27", balanceCents: 100000 },
    ]);
  });

  it("works a card the other way: purchases raised what's owed", () => {
    const card = derivedBalances(
      "credit",
      30000,
      [
        { date: "2026-09-10", amountCents: 2500 },
        { date: "2026-10-05", amountCents: -10000 },
      ],
      "2026-10-27",
    );
    expect(card).toEqual([
      { date: "2026-08-31", balanceCents: 30000 - 2500 + 10000 },
      { date: "2026-09-10", balanceCents: 30000 + 10000 },
      { date: "2026-09-30", balanceCents: 30000 + 10000 },
      { date: "2026-10-05", balanceCents: 30000 },
      { date: "2026-10-27", balanceCents: 30000 },
    ]);
  });

  it("works from the statement's own balances, so a gap in the rows stays a gap", () => {
    // Rows to Sep 10 only (the newer file was removed); today's balance came from that newer file.
    const rows = [
      { date: "2026-07-01", amountCents: -200000 },
      { date: "2026-07-03", amountCents: 140000 },
      { date: "2026-08-01", amountCents: -200000 },
      { date: "2026-09-10", amountCents: 8500 },
    ];
    const fromFile = [
      { date: "2026-07-01", balanceCents: 300000 },
      { date: "2026-07-03", balanceCents: 160000 },
      { date: "2026-08-01", balanceCents: 360000 },
      { date: "2026-09-10", balanceCents: 351500 },
    ];
    expect(derivedBalances("depository", 1101200, rows, "2026-10-27", fromFile)).toEqual([
      // Back from the next balance the file gave: before July 1's pay.
      { date: "2026-06-30", balanceCents: 100000 },
      { date: "2026-07-01", balanceCents: 300000 },
      { date: "2026-07-03", balanceCents: 160000 },
      { date: "2026-07-31", balanceCents: 160000 },
      { date: "2026-08-01", balanceCents: 360000 },
      { date: "2026-08-31", balanceCents: 351500 + 8500 },
      { date: "2026-09-10", balanceCents: 351500 },
      // Nothing the file says after Sep 10: forward from it, not back from today across the gap.
      { date: "2026-09-30", balanceCents: 351500 },
      { date: "2026-10-27", balanceCents: 1101200 },
    ]);
  });

  it("is just today's balance with no transactions", () => {
    expect(derivedBalances("depository", 5000, [], "2026-10-27")).toEqual([
      { date: "2026-10-27", balanceCents: 5000 },
    ]);
  });
});
