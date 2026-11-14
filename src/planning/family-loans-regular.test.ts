import { describe, expect, it } from "vitest";
import { candidatesFrom, type Transfer } from "./family-loans";

const t = (id: string, date: string, amountCents: number, description: string): Transfer => ({
  id,
  date,
  amountCents,
  description,
  merchantName: null,
});

// Debugger 11-14: a student who uploaded a checking statement was asked "You sent Roommate Rent
// $650.00 on Zelle on Nov 3, with no note. Yes, I lent Roommate that…", for the rent they Zelle
// on the 3rd of every month. A regular payment isn't a loan; a one-off of the same size still is.
describe("a regular payment to the same person", () => {
  const rent = [
    t("sep", "2026-09-03", 65_000, "ZELLE TO ROOMMATE RENT"),
    t("oct", "2026-10-03", 65_000, "ZELLE TO ROOMMATE RENT"),
    t("nov", "2026-11-03", 65_000, "ZELLE TO ROOMMATE RENT"),
  ];

  it("isn't asked about as a loan", () => {
    expect(candidatesFrom(rent, [])).toEqual([]);
  });

  it("still isn't when the amount moves a little, as a share of the bills does", () => {
    const bills = [
      t("a", "2026-09-05", 18_000, "VENMO PAYMENT TO JORDAN LEE"),
      t("b", "2026-10-05", 17_600, "VENMO PAYMENT TO JORDAN LEE"),
      t("c", "2026-11-05", 18_400, "VENMO PAYMENT TO JORDAN LEE"),
    ];
    expect(candidatesFrom(bills, [])).toEqual([]);
  });

  it("leaves a one-off to someone else, or a different sum to the same person, to ask about", () => {
    const ids = candidatesFrom(
      [
        ...rent,
        t("pat", "2026-11-04", 65_000, "ZELLE TO PAT ROE"),
        t("more", "2026-11-06", 120_000, "ZELLE TO ROOMMATE RENT"),
      ],
      [],
    ).map((c) => c.id);
    expect(ids).toEqual(["tx:more", "tx:pat"]);
  });

  it("is asked about while it has only shown in two months", () => {
    expect(candidatesFrom(rent.slice(1), []).map((c) => c.id)).toEqual(["tx:nov", "tx:oct"]);
  });
});
