import { describe, expect, it } from "vitest";
import {
  candidatesFrom,
  loanBalance,
  nameKey,
  parseTransfer,
  reminderText,
  type Transfer,
} from "./family-loans";

const t = (id: string, date: string, amountCents: number, description: string): Transfer => ({
  id,
  date,
  amountCents,
  description,
  merchantName: null,
});

describe("reading a payment-app transfer", () => {
  it("finds the app, who it was with, the direction and the note", () => {
    expect(
      parseTransfer({
        amountCents: 40_000,
        description: "VENMO PAYMENT TO JORDAN LEE - rent loan",
      }),
    ).toEqual({
      app: "Venmo",
      counterparty: "Jordan Lee",
      note: "rent loan",
      direction: "out",
    });
    expect(
      parseTransfer({
        amountCents: -15_000,
        description: "ZELLE FROM SAM RIVERA: paying you back",
      }),
    ).toEqual({
      app: "Zelle",
      counterparty: "Sam Rivera",
      note: "paying you back",
      direction: "in",
    });
    expect(parseTransfer({ amountCents: 5_000, description: "CASH APP*TO MOM" })).toMatchObject({
      app: "Cash App",
      counterparty: "Mom",
      note: null,
    });
  });
  it("ignores everything that isn't a payment app with a name", () => {
    expect(parseTransfer({ amountCents: 1_000, description: "NETFLIX.COM" })).toBeNull();
    expect(parseTransfer({ amountCents: 1_000, description: "VENMO PAYMENT 1234567" })).toBeNull();
    expect(nameKey("Jordan  Lee")).toBe("jordanlee");
  });
});

describe("which transfers might be a loan", () => {
  const transfers = [
    t("a", "2026-10-03", 40_000, "VENMO PAYMENT TO JORDAN LEE - rent loan"),
    t("b", "2026-10-05", 2_500, "VENMO PAYMENT TO JORDAN LEE - lunch"),
    t("c", "2026-10-06", 12_000, "VENMO PAYMENT TO ALEX KIM - concert tickets"),
    t("d", "2026-10-07", 6_000, "ZELLE TO PAT ROE - loan"),
    t("e", "2026-10-08", -30_000, "ZELLE FROM SAM RIVERA - borrow until friday"),
    t("f", "2026-10-09", 2_000, "ZELLE TO CHRIS HALL"),
    t("g", "2026-10-10", -10_000, "ZELLE FROM JORDAN LEE - paying you back"),
  ];
  it("asks about big ones and ones noted like a loan, not small ones or split bills", () => {
    const ids = candidatesFrom(transfers, []).map((c) => c.id);
    expect(ids).toEqual(["tx:g", "tx:e", "tx:d", "tx:a"]);
  });
  it("says which way the loan goes", () => {
    const c = candidatesFrom(transfers, []);
    expect(c.find((x) => x.id === "tx:a")!.kind).toBe("lent");
    expect(c.find((x) => x.id === "tx:e")!.kind).toBe("borrowed");
  });
  it("doesn't ask about money coming back from someone the person already lent to", () => {
    const ids = candidatesFrom(transfers, [{ counterpartyKey: "jordanlee", kind: "lent" }]).map(
      (c) => c.id,
    );
    expect(ids).not.toContain("tx:g");
  });
});

describe("what's left on a loan", () => {
  const loan = {
    kind: "lent" as const,
    counterpartyKey: "jordanlee",
    principalCents: 40_000,
    openedOn: "2026-10-03",
  };
  it("takes off what the other person sent back since", () => {
    const b = loanBalance(loan, [
      t("a", "2026-10-03", 40_000, "VENMO PAYMENT TO JORDAN LEE - rent loan"),
      t("g", "2026-10-20", -10_000, "ZELLE FROM JORDAN LEE - paying you back"),
      t("h", "2026-10-25", -5_000, "VENMO FROM JORDAN LEE - more"),
      t("x", "2026-10-26", -9_000, "ZELLE FROM SAM RIVERA"),
    ]);
    expect(b.balanceCents).toBe(25_000);
    expect(b.repaid).toEqual([
      { date: "2026-10-20", cents: 10_000 },
      { date: "2026-10-25", cents: 5_000 },
    ]);
  });
  it("is never below zero, and borrowed loans count what the person sends", () => {
    expect(
      loanBalance(loan, [t("g", "2026-10-20", -90_000, "ZELLE FROM JORDAN LEE")]).balanceCents,
    ).toBe(0);
    const borrowed = { ...loan, kind: "borrowed" as const };
    expect(
      loanBalance(borrowed, [t("o", "2026-10-20", 15_000, "ZELLE TO JORDAN LEE")]).balanceCents,
    ).toBe(25_000);
  });
});

describe("the reminder", () => {
  it("is kind, uses the first name and the figures, and is only text", () => {
    const text = reminderText({
      counterparty: "Jordan Lee",
      balanceCents: 25_000,
      principalCents: 40_000,
      openedOn: "2026-10-03",
      app: "Venmo",
    });
    expect(text).toContain("Hi Jordan");
    expect(text).toContain("$400.00 from Oct 3");
    expect(text).toContain("$250.00 is left");
    expect(text).toContain("No rush");
    expect(text).toContain("on Venmo");
  });
});
