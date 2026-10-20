import { describe, expect, it } from "vitest";
import {
  essentialGroup,
  firstShortfall,
  payFirst,
  tightItems,
  type TightDebt,
} from "./tight-money";

describe("the first shortfall", () => {
  it("is the first day under the cushion, with how far under", () => {
    const days = [
      { date: "2026-10-19", balanceCents: 90_000 },
      { date: "2026-10-20", balanceCents: 4_000 },
      { date: "2026-10-21", balanceCents: -20_000 },
    ];
    expect(firstShortfall(days)).toEqual({
      date: "2026-10-20",
      balanceCents: 4_000,
      shortCents: 6_000,
    });
    expect(firstShortfall(days.slice(0, 1))).toBeNull();
    expect(firstShortfall([])).toBeNull();
  });
});

describe("bills in order", () => {
  it("puts housing, utilities and insurance first, then the rest by date", () => {
    expect(essentialGroup("PG&E WEB ONLINE")).toBe("utilities");
    expect(essentialGroup("GEICO AUTO")).toBe("insurance");
    expect(essentialGroup("Rent - Oak Street")).toBe("housing");
    expect(essentialGroup("NETFLIX.COM")).toBeNull();
    const ordered = payFirst([
      { payee: "NETFLIX.COM", date: "2026-10-20", amountCents: 1_799 },
      { payee: "Rent - Oak Street", date: "2026-10-25", amountCents: 180_000 },
      { payee: "SPOTIFY USA", date: "2026-10-19", amountCents: 1_199 },
      { payee: "PG&E WEB ONLINE", date: "2026-10-22", amountCents: 12_000 },
    ]);
    expect(ordered.map((b) => b.payee)).toEqual([
      "PG&E WEB ONLINE",
      "Rent - Oak Street",
      "SPOTIFY USA",
      "NETFLIX.COM",
    ]);
  });
});

describe("the requests Jane prepares", () => {
  const card: TightDebt = {
    key: "account:card",
    name: "Demo Credit Card",
    kind: "card",
    balanceCents: 241_050,
    aprBps: 2_299,
    paymentCents: 3_500,
    nextDue: "2026-10-26",
  };
  const mortgage: TightDebt = {
    key: "account:mortgage",
    name: "Home mortgage",
    kind: "mortgage",
    balanceCents: 30_000_000,
    aprBps: 650,
    paymentCents: 219_831,
    nextDue: "2026-10-25",
  };

  it("moves a due date after payday, asks for hardship and a lower rate, and a waived late fee", () => {
    const items = tightItems({
      debts: [card, mortgage],
      shortfallOn: "2026-10-28",
      paydayDay: 1,
      lateFees: [{ debtKey: "account:card", cents: 4_000 }],
    });
    expect(items.map((i) => i.id)).toEqual([
      "due_move:account:card",
      "hardship:account:card",
      "lower_rate:account:card",
      "waive_fee:account:card",
    ]);
    expect(items[0].body).toContain("from the 26th to the 3rd of each month");
    expect(items[0].freesCents).toBe(3_500);
    expect(items[2].body).toContain("22.99%");
    expect(items[3].label).toBe("Ask Demo Credit Card to waive its $40.00 late fee");
  });

  it("never asks to delay housing: a mortgage is paid first", () => {
    const items = tightItems({
      debts: [mortgage],
      shortfallOn: "2026-10-28",
      paydayDay: 1,
      lateFees: [],
    });
    expect(items).toEqual([]);
  });

  it("only moves a due date that falls before the shortfall, and only with a payday", () => {
    const later = { ...card, nextDue: "2026-11-20" };
    const ids = (d: TightDebt, paydayDay: number | null) =>
      tightItems({ debts: [d], shortfallOn: "2026-10-28", paydayDay, lateFees: [] }).map(
        (i) => i.kind,
      );
    expect(ids(later, 1)).toEqual(["hardship", "lower_rate"]);
    expect(ids(card, null)).toEqual(["hardship", "lower_rate"]);
  });
});
