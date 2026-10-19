import { describe, expect, it } from "vitest";
import { NO_OVERRIDES, tagAll, tagChecks, tagOf, tagTotals, type TagTransaction } from "./tax-tags";

// Spec step 119: tax tags from the category, and the person's own always win.

let n = 0;
const tx = (o: Partial<TagTransaction>): TagTransaction => ({
  id: `t${(n += 1)}`,
  date: "2026-05-01",
  amountCents: 5_000,
  description: "SOMETHING",
  merchantName: null,
  pfcDetailed: "GENERAL_MERCHANDISE_OTHER_GENERAL_MERCHANDISE",
  ...o,
});
const overrides = (
  byTransaction: [string, string][] = [],
  byMerchant: [string, string][] = [],
) => ({
  byTransaction: new Map(byTransaction),
  byMerchant: new Map(byMerchant),
});

describe("tagOf", () => {
  it("tags by category, and asks about education", () => {
    expect(
      tagOf(tx({ pfcDetailed: "GOVERNMENT_AND_NON_PROFIT_DONATIONS" }), NO_OVERRIDES),
    ).toMatchObject({ tag: "donation", source: "jane" });
    expect(tagOf(tx({ pfcDetailed: "MEDICAL_DENTAL_CARE" }), NO_OVERRIDES)?.tag).toBe("medical");
    expect(tagOf(tx({ pfcDetailed: "GENERAL_SERVICES_CHILDCARE" }), NO_OVERRIDES)?.tag).toBe(
      "childcare",
    );
    expect(
      tagOf(
        tx({ pfcDetailed: "GENERAL_SERVICES_EDUCATION", merchantName: "MasterClass" }),
        NO_OVERRIDES,
      ),
    ).toMatchObject({
      tag: "education",
      source: "check",
      merchantKey: "masterclass",
      payee: "MasterClass",
    });
  });

  it("leaves out refunds, vet bills and everyday spending", () => {
    expect(
      tagOf(tx({ amountCents: -5_000, pfcDetailed: "MEDICAL_DENTAL_CARE" }), NO_OVERRIDES),
    ).toBeNull();
    expect(tagOf(tx({ pfcDetailed: "MEDICAL_VETERINARY_SERVICES" }), NO_OVERRIDES)).toBeNull();
    expect(tagOf(tx({ pfcDetailed: "FOOD_AND_DRINK_GROCERIES" }), NO_OVERRIDES)).toBeNull();
    expect(tagOf(tx({ pfcDetailed: null }), NO_OVERRIDES)).toBeNull();
  });

  it("the person's tag wins: a transaction's over a merchant's over Jane's", () => {
    const staples = tx({ id: "s1", merchantName: "Staples" });
    expect(tagOf(staples, overrides([], [["staples", "work"]]))).toMatchObject({
      tag: "work",
      source: "yours",
    });
    expect(tagOf(staples, overrides([["s1", "none"]], [["staples", "work"]]))).toBeNull();
    const gift = tx({
      id: "g1",
      merchantName: "Red Cross",
      pfcDetailed: "GOVERNMENT_AND_NON_PROFIT_DONATIONS",
    });
    expect(tagOf(gift, overrides([], [["red cross", "none"]]))).toBeNull();
    expect(tagOf(gift, overrides([["g1", "medical"]]))).toMatchObject({
      tag: "medical",
      source: "yours",
    });
    // A tag that doesn't exist counts as none.
    expect(tagOf(gift, overrides([["g1", "lottery"]]))).toBeNull();
  });

  it("never changes the transaction", () => {
    const t = tx({ pfcDetailed: "MEDICAL_DENTAL_CARE" });
    const before = JSON.stringify(t);
    tagAll([t], overrides([[t.id, "work"]]));
    expect(JSON.stringify(t)).toBe(before);
  });
});

describe("totals and checks", () => {
  const tagged = tagAll(
    [
      tx({
        date: "2026-02-01",
        amountCents: 12_000,
        merchantName: "MasterClass",
        pfcDetailed: "GENERAL_SERVICES_EDUCATION",
      }),
      tx({
        date: "2026-01-01",
        amountCents: 100,
        merchantName: "MasterClass",
        pfcDetailed: "GENERAL_SERVICES_EDUCATION",
      }),
      tx({
        amountCents: 2_999,
        merchantName: "Duolingo",
        pfcDetailed: "GENERAL_SERVICES_EDUCATION",
      }),
      tx({ amountCents: 5_000, pfcDetailed: "GOVERNMENT_AND_NON_PROFIT_DONATIONS" }),
    ],
    NO_OVERRIDES,
  );

  it("are in date order and add up by tag", () => {
    expect(tagged[0].date).toBe("2026-01-01");
    const totals = tagTotals(tagged);
    expect(totals.education).toEqual({ count: 3, totalCents: 15_099 });
    expect(totals.donation).toEqual({ count: 1, totalCents: 5_000 });
    expect(totals.work).toEqual({ count: 0, totalCents: 0 });
  });

  it("asks once per merchant Jane is unsure about, most spent first", () => {
    expect(tagChecks(tagged)).toEqual([
      {
        merchantKey: "masterclass",
        payee: "MasterClass",
        tag: "education",
        count: 2,
        totalCents: 12_100,
      },
      { merchantKey: "duolingo", payee: "Duolingo", tag: "education", count: 1, totalCents: 2_999 },
    ]);
  });
});
