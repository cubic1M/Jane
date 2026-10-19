import { describe, expect, it } from "vitest";
import {
  harvestChances,
  locationHints,
  lotsFor,
  realised,
  unrealised,
  washReplacements,
  type InvHolding,
  type InvTransaction,
} from "./investment-taxes";

// Spec step 124: gains from the holdings' cost basis, lots, and the wash-sale rule.

const TODAY = "2026-10-18";
const holding = (o: Partial<InvHolding>): InvHolding => ({
  accountId: "brk",
  securityId: "pdifx",
  ticker: "PDIFX",
  name: "Pinnacle Dividend Income Fund",
  type: "mutual fund",
  quantity: 100,
  valueCents: 200_000,
  costBasisCents: 250_000,
  ...o,
});
const tx = (o: Partial<InvTransaction>): InvTransaction => ({
  accountId: "brk",
  securityId: "pdifx",
  date: "2026-09-24",
  type: "buy",
  subtype: "buy",
  quantity: 10,
  amountCents: 20_000,
  ...o,
});

describe("lots", () => {
  it("opening shares (date unknown) first, then buys; sales take the oldest", () => {
    const { left, sales } = lotsFor(100, [
      tx({ date: "2026-03-01", quantity: 30 }),
      tx({
        date: "2026-05-01",
        type: "sell",
        subtype: "sell",
        quantity: -50,
        amountCents: -90_000,
      }),
    ]);
    // 100 held now = 120 opening + 30 bought − 50 sold.
    expect(sales[0].taken).toEqual([{ date: null, quantity: 50 }]);
    expect(left).toEqual([
      { date: null, quantity: 70 },
      { date: "2026-03-01", quantity: 30 },
    ]);
  });
});

describe("unrealised gains match the holdings' cost basis", () => {
  it("is value less basis, split by when the shares were bought", () => {
    const h = holding({
      quantity: 10,
      valueCents: 452_300,
      costBasisCents: 424_000,
      securityId: "klcx",
    });
    const { left } = lotsFor(10, [tx({ securityId: "klcx", date: "2026-07-15", quantity: 10 })]);
    expect(unrealised(h, left, TODAY)).toMatchObject({
      gainCents: 28_300,
      shortTermCents: 28_300,
      longTermCents: 0,
    });
    const old = unrealised(
      holding({ quantity: 38, valueCents: 518_320, costBasisCents: 228_000 }),
      [{ date: null, quantity: 38 }],
      TODAY,
    );
    expect(old).toMatchObject({ gainCents: 290_320, shortTermCents: 0, longTermCents: 290_320 });
    expect(unrealised(holding({ costBasisCents: null }), [], TODAY)).toBeNull();
  });
});

describe("wash sales", () => {
  const sale = tx({
    date: "2026-09-24",
    type: "sell",
    subtype: "sell",
    quantity: -60,
    amountCents: -128_400,
  });

  it("finds the same security bought 30 days either side, in any account", () => {
    const buys = [
      tx({ date: "2026-08-25", quantity: 1 }),
      tx({ date: "2026-08-24", quantity: 1 }),
      tx({ date: "2026-10-24", quantity: 2, accountId: "ira" }),
      tx({ date: "2026-10-25", quantity: 4 }),
      tx({ date: "2026-09-28", quantity: 3, securityId: "other" }),
    ];
    expect(
      washReplacements({ securityId: "pdifx", date: "2026-09-24", accountId: "brk" }, buys),
    ).toEqual([
      { date: "2026-08-25", quantity: 1, accountId: "brk" },
      { date: "2026-10-24", quantity: 2, accountId: "ira" },
    ]);
  });

  it("disallows the loss for the replacement shares only", () => {
    const h = holding({ quantity: 100, costBasisCents: 250_000 });
    const { sales } = lotsFor(100, [sale]);
    const replacement = tx({ date: "2026-09-28", quantity: 15, subtype: "dividend reinvestment" });
    const [r] = realised(h, sales, [replacement]);
    // Cost at $25 a share average: $1,500; proceeds $1,284: a $216 loss.
    expect(r.costCents).toBe(150_000);
    // 15 of 60 shares replaced: a quarter of the loss is disallowed.
    expect(r.washDisallowedCents).toBe(5_400);
    expect(r.gainCents).toBe(-21_600 + 5_400);
    expect(r.shortTermCents + r.longTermCents).toBe(r.gainCents);
    // A gain is never a wash sale.
    const [g] = realised(holding({ costBasisCents: 100_000 }), sales, [replacement]);
    expect(g.washDisallowedCents).toBe(0);
    // Replacing all of it disallows all of it.
    const [all] = realised(h, sales, [tx({ date: "2026-10-01", quantity: 80 })]);
    expect(all.gainCents).toBe(0);
  });
});

describe("harvesting and where to hold what", () => {
  it("lists losses worth harvesting, with the wash-sale risk of buying again soon", () => {
    const loss = unrealised(holding({}), [{ date: null, quantity: 100 }], TODAY)!;
    const small = unrealised(
      holding({ securityId: "x", valueCents: 249_000 }),
      [{ date: null, quantity: 100 }],
      TODAY,
    )!;
    const chances = harvestChances(
      [loss, small],
      [tx({ date: "2026-09-28", subtype: "dividend reinvestment", quantity: 0.5 })],
      TODAY,
    );
    expect(chances).toHaveLength(1);
    expect(chances[0]).toMatchObject({
      lossCents: 50_000,
      washRisk: { boughtRecently: true, reinvests: true },
    });
  });

  it("suggests income and bond funds sit in a 401(k) or IRA", () => {
    expect(
      locationHints([
        holding({}),
        holding({ name: "Keystone US Large Cap Index ETF", type: "etf" }),
        holding({ name: "Short Treasury Fund", type: "fixed income" }),
        holding({ name: "California Muni Bond Fund", type: "fixed income" }),
      ]).map((h) => h.name),
    ).toEqual(["Pinnacle Dividend Income Fund", "Short Treasury Fund"]);
  });
});
