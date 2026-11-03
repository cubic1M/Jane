import { describe, expect, it } from "vitest";
import { MISREAD_MIN_ROWS, planCorrections, type IncomingRow, type StoredRow } from "./corrections";

const stored = (over: Partial<StoredRow> = {}): StoredRow => ({
  id: "s1",
  dedupeKey: "k1",
  date: "2026-10-01",
  amountCents: 1000,
  description: "SHOP",
  merchantName: "Shop",
  pfcDetailed: "GENERAL_MERCHANDISE_OTHER",
  categorySource: "rule",
  ...over,
});
const incoming = (over: Partial<IncomingRow> = {}): IncomingRow => ({
  externalId: "k1",
  date: "2026-10-01",
  amountCents: 1000,
  description: "SHOP",
  merchantName: "Shop",
  category: { primary: "GENERAL_MERCHANDISE", detailed: "GENERAL_MERCHANDISE_OTHER" },
  categorySource: "rule",
  ...over,
});
const FOOD = { primary: "FOOD_AND_DRINK", detailed: "FOOD_AND_DRINK_GROCERIES" };

describe("the same row again", () => {
  it("changes nothing when it reads the same", () => {
    expect(planCorrections([stored()], [incoming()])).toEqual({
      corrections: [],
      rekeyed: new Set(),
    });
  });

  it("follows the new reading of its category", () => {
    const { corrections } = planCorrections([stored()], [incoming({ category: FOOD })]);
    expect(corrections).toEqual([
      {
        id: "s1",
        data: {
          pfcPrimary: "FOOD_AND_DRINK",
          pfcDetailed: "FOOD_AND_DRINK_GROCERIES",
          categorySource: "rule",
        },
      },
    ]);
  });

  it("follows a new merchant name, and never blanks a known one", () => {
    expect(
      planCorrections([stored()], [incoming({ merchantName: "Better" })]).corrections[0]?.data,
    ).toEqual({ merchantName: "Better" });
    expect(planCorrections([stored()], [incoming({ merchantName: null })]).corrections).toEqual([]);
  });

  it("never blanks a category the file can't read", () => {
    expect(planCorrections([stored()], [incoming({ category: null })]).corrections).toEqual([]);
  });

  it("keeps a category the person chose, or a card payment found by its timing", () => {
    const chosen = stored({ categorySource: "user" });
    const paid = stored({ pfcDetailed: "LOAN_PAYMENTS_CREDIT_CARD_PAYMENT" });
    expect(planCorrections([chosen], [incoming({ category: FOOD })]).corrections).toEqual([]);
    expect(planCorrections([paid], [incoming({ category: FOOD })]).corrections).toEqual([]);
  });
});

describe("a whole file read differently before", () => {
  const old = (id: string, date: string, amountCents = 1000, description = `OLD ${id}`) =>
    stored({ id, dedupeKey: `old-${id}`, date, amountCents, description });
  const now = (id: string, date: string, amountCents = -1000, description = `NEW ${id}`) =>
    incoming({ externalId: `new-${id}`, date, amountCents, description });

  it("corrects the stored rows in place, sign and words, and doesn't save them again", () => {
    const { corrections, rekeyed } = planCorrections(
      [old("a", "2026-10-01"), old("b", "2026-10-02")],
      [now("a", "2026-10-01"), now("b", "2026-10-02")],
    );
    expect(rekeyed).toEqual(new Set(["new-a", "new-b"]));
    expect(corrections[0]).toEqual({
      id: "a",
      data: {
        dedupeKey: "new-a",
        amountCents: -1000,
        description: "NEW a",
        merchantName: "Shop",
        pfcPrimary: "GENERAL_MERCHANDISE",
        pfcDetailed: "GENERAL_MERCHANDISE_OTHER",
        categorySource: "rule",
      },
    });
    expect(corrections.map((c) => c.id)).toEqual(["a", "b"]);
  });

  it("leaves one -$50 beside an old +$50: two real transactions", () => {
    expect(MISREAD_MIN_ROWS).toBe(2);
    const { corrections, rekeyed } = planCorrections(
      [old("a", "2026-10-01")],
      [now("a", "2026-10-01")],
    );
    expect(corrections).toEqual([]);
    expect(rekeyed.size).toBe(0);
  });

  it("wants half of what's new to pair, not just two rows", () => {
    const twoOfFive = planCorrections(
      [old("a", "2026-10-01"), old("b", "2026-10-02")],
      [
        now("a", "2026-10-01"),
        now("b", "2026-10-02"),
        now("c", "2026-10-03"),
        now("d", "2026-10-04"),
        now("e", "2026-10-05"),
      ],
    );
    expect(twoOfFive.rekeyed.size).toBe(0);
    const twoOfFour = planCorrections(
      [old("a", "2026-10-01"), old("b", "2026-10-02")],
      [
        now("a", "2026-10-01"),
        now("b", "2026-10-02"),
        now("c", "2026-10-03"),
        now("d", "2026-10-04"),
      ],
    );
    expect(twoOfFour.rekeyed.size).toBe(2);
  });

  it("pairs by day and amount only, each stored row once", () => {
    const { rekeyed } = planCorrections(
      [old("a", "2026-10-01"), old("b", "2026-10-02", 2000)],
      [
        now("x", "2026-10-01", -1000),
        now("y", "2026-10-01", -1000),
        now("z", "2026-10-02", -999),
        now("w", "2026-10-03", -2000),
      ],
    );
    // Only x can pair: y's stored row is taken, z's amount differs, w's day does.
    expect(rekeyed.size).toBe(0);
  });

  it("leaves a stored row whose words are on the file's rows: it's a real one", () => {
    const { rekeyed } = planCorrections(
      [old("a", "2026-10-01", 1000, "SAME"), old("b", "2026-10-02", 1000, "SAME")],
      [now("a", "2026-10-01", -1000, "SAME"), now("b", "2026-10-02", -1000, "SAME")],
    );
    expect(rekeyed.size).toBe(0);
  });

  it("keeps a stored row's own category when it corrects the rest", () => {
    const { corrections } = planCorrections(
      [
        stored({ id: "a", dedupeKey: "old-a", description: "OLD a", categorySource: "user" }),
        old("b", "2026-10-02"),
      ],
      [now("a", "2026-10-01"), now("b", "2026-10-02")],
    );
    expect(corrections[0]?.data).not.toHaveProperty("pfcDetailed");
    expect(corrections[1]?.data).toHaveProperty("pfcDetailed");
  });

  it("gives a row stored at $0.00 its amount by day and words", () => {
    const missed = (id: string, date: string) =>
      stored({ id, dedupeKey: `old-${id}`, date, amountCents: 0, description: "SHOP" });
    const { corrections, rekeyed } = planCorrections(
      [missed("a", "2026-10-01"), missed("b", "2026-10-02")],
      [
        incoming({ externalId: "new-a", amountCents: 1250, description: "SHOP 123" }),
        incoming({
          externalId: "new-b",
          date: "2026-10-02",
          amountCents: 700,
          description: "SHOP 456",
        }),
      ],
    );
    expect(rekeyed.size).toBe(2);
    expect(corrections.map((c) => c.data.amountCents)).toEqual([1250, 700]);
  });
});
