import { describe, expect, it } from "vitest";
import { MY_AID_FILE } from "./__fixtures__/my-aid";
import { MyAidError, myAidForLlm, parseMyAid } from "./parse";

// The studentaid.gov "Download My Aid Data" file, read in memory, loan fields only (round 15).

describe("parseMyAid", () => {
  const loans = parseMyAid(MY_AID_FILE);

  it("reads every loan's fields, past a long file's start", () => {
    expect(MY_AID_FILE.length).toBeGreaterThan(20_000);
    expect(loans).toHaveLength(2);
    expect(loans[0]).toEqual({
      typeCode: "D1",
      type: "DIRECT STAFFORD SUBSIDIZED",
      principalCents: 341_218,
      interestCents: 4_207,
      rateType: "F",
      rateBps: 453,
      planCode: "IB",
      plan: "INCOME-BASED REPAYMENT",
      planBegan: "2024-01-01",
      scheduledCents: 6_100,
      idrAnniversary: "2027-01-01",
      nextDue: "2026-12-01",
      pslfMonths: 22,
      status: "RP",
      loanDate: "2019-08-15",
      disbursedCents: 350_000,
      servicer: "EXAMPLE LOAN SERVICING",
    });
  });

  it("reads loosely, and leaves what it can't read, or doesn't know, as it is or empty", () => {
    expect(loans[1]).toMatchObject({
      loanDate: "2020-08-14",
      disbursedCents: 200_000,
      principalCents: 198_750,
      interestCents: null,
      rateBps: 275,
      // An unknown plan code stays unknown, never guessed.
      planCode: "ZZ",
      plan: null,
      nextDue: null,
      pslfMonths: null,
      servicer: null,
    });
  });

  it("keeps nothing about the person", () => {
    const kept = JSON.stringify(loans);
    for (const gone of [
      "TESTY",
      "SAMPLEPERSON",
      "FAKE STREET",
      "62702",
      "example.com",
      "2175550100",
      "8005550199",
      "PO BOX",
    ]) {
      expect(kept, gone).not.toContain(gone);
    }
  });

  it("refuses a file with no loans", () => {
    expect(() => parseMyAid("Student First Name:TESTY\nGrant Type Code:PL")).toThrow(MyAidError);
    expect(() => parseMyAid("")).toThrow(MyAidError);
  });
});

describe("myAidForLlm", () => {
  it("is numbers, codes and names of plans and statuses: no servicer, no full dates", () => {
    const view = myAidForLlm(parseMyAid(MY_AID_FILE));
    expect(view[0]).toEqual({
      type: "DIRECT STAFFORD SUBSIDIZED",
      principalCents: 341_218,
      interestCents: 4_207,
      rateBps: 453,
      rateType: "F",
      plan: "INCOME-BASED REPAYMENT",
      scheduledCents: 6_100,
      nextDueMonth: "2026-12",
      pslfMonths: 22,
      status: "RP",
    });
    expect(JSON.stringify(view)).not.toMatch(/SERVICING|\d{4}-\d{2}-\d{2}/);
  });
});
