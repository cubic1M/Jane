import { describe, expect, it } from "vitest";
import { regularPayers, type PayerRow } from "./regular-payers";

// Debugger 11-02: "NORTHWIND LABS" with no pay word in the line stayed uncategorized, and Claude
// is only asked what a typical purchase there is, so a person's pay wasn't income anywhere.
const biweekly = (name: string, cents: number, count = 8, from = "2026-07-03"): PayerRow[] =>
  Array.from({ length: count }, (_, i) => {
    const day = new Date(Date.parse(`${from}T00:00:00Z`) + i * 14 * 86_400_000);
    return {
      id: `${name}-${i}`,
      date: day.toISOString().slice(0, 10),
      amountCents: -cents,
      merchantName: name,
    };
  });

describe("regular money in from one payer", () => {
  it("is income when it comes back at a steady cadence and a similar amount", () => {
    expect(regularPayers(biweekly("Northwind Labs", 261_025))).toHaveLength(8);
  });

  it("keeps monthly pay, four months of it", () => {
    const monthly = ["07", "08", "09", "10"].map((m, i) => ({
      id: `m${i}`,
      date: `2026-${m}-01`,
      amountCents: -410_000,
      merchantName: "City Of Oak Park",
    }));
    expect(regularPayers(monthly)).toHaveLength(4);
  });

  it("counts pay that varies a little", () => {
    const rows = biweekly("Northwind Labs", 200_000).map((r, i) => ({
      ...r,
      amountCents: r.amountCents - (i % 2) * 40_000,
    }));
    expect(regularPayers(rows)).toHaveLength(8);
  });

  it.each([
    ["too few", biweekly("Northwind Labs", 261_025, 3)],
    ["too small: a roommate's share of a bill", biweekly("Jo Park", 4_000)],
    ["an account of their own", biweekly("Ally Bank", 50_000)],
    ["a card company", biweekly("American Express", 50_000)],
    ["money moved from a broker", biweekly("Fidelity Investments", 50_000)],
    ["a payment app", biweekly("Venmo", 50_000)],
    // Debugger 11-02: "DEPOSIT FROM SANTANDER CHECKING" on a savings account, $3,000 of false pay.
    ["an account of their own, by its kind", biweekly("Santander Checking", 50_000)],
  ])("isn't income: %s", (_, rows) => {
    expect(regularPayers(rows)).toEqual([]);
  });

  describe("when the same money left another of their accounts", () => {
    const into = biweekly("Home Fund", 50_000).map((r) => ({ ...r, accountId: "savings" }));
    const out = (accountId: string, cents = 50_000, days = 0) =>
      into.map((r) => ({
        accountId,
        amountCents: cents,
        date: new Date(Date.parse(`${r.date}T00:00:00Z`) + days * 86_400_000)
          .toISOString()
          .slice(0, 10),
      }));

    it("isn't income: it's their own money moving", () => {
      expect(regularPayers(into, out("checking"))).toEqual([]);
      expect(regularPayers(into, out("checking", 50_000, 2))).toEqual([]);
    });

    it("is still income when pay leaves the account it came into, whole", () => {
      expect(regularPayers(into, out("savings"))).toHaveLength(8);
    });

    it("is still income when the amount or the days don't match", () => {
      expect(regularPayers(into, out("checking", 49_999))).toHaveLength(8);
      expect(regularPayers(into, out("checking", 50_000, 6))).toHaveLength(8);
    });

    it("is still income when only an odd one matches", () => {
      expect(regularPayers(into, out("checking").slice(0, 1))).toHaveLength(8);
    });
  });

  it("isn't income when the amounts are all over the place", () => {
    const amounts = [30_000, 900_000, 25_000, 700_000, 40_000, 1_200_000];
    const rows = biweekly("Acme Resale", 1, 6).map((r, i) => ({
      ...r,
      amountCents: -amounts[i],
    }));
    expect(regularPayers(rows)).toEqual([]);
  });

  it("isn't income when the days are all over the place", () => {
    const rows = ["2026-01-02", "2026-01-05", "2026-03-20", "2026-03-22", "2026-10-01"].map(
      (date, i) => ({ id: `r${i}`, date, amountCents: -50_000, merchantName: "Acme Resale" }),
    );
    expect(regularPayers(rows)).toEqual([]);
  });

  it("looks at each payer on its own, and skips rows with no name", () => {
    const rows = [
      ...biweekly("Northwind Labs", 261_025),
      ...biweekly("Jo Park", 4_000),
      { id: "x", date: "2026-07-01", amountCents: -90_000, merchantName: null },
    ];
    expect(regularPayers(rows).every((id) => id.startsWith("Northwind"))).toBe(true);
  });
});
