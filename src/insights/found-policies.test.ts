import { describe, expect, it } from "vitest";
import { AS_OF, CARD, GEICO, input, monthly, monthsAgo, tx } from "@/detection/__fixtures__/build";
import { buildStreams } from "@/detection/streams";
import type { DetectionTransaction } from "@/detection/types";
import {
  annualFeeDeadlines,
  estimatedRenewal,
  insurerKind,
  insurerName,
  policiesFromStreams,
} from "./found-policies";

// Spec step 99: regular payments to an insurer become policies found from payments, with
// a renewal estimated a year from the first payment; card annual fees become deadlines.

const found = (transactions: DetectionTransaction[]) => {
  const data = input({ transactions });
  return policiesFromStreams(data, buildStreams(data));
};

describe("policiesFromStreams", () => {
  it("finds car insurance paid every month, renewing a year from the first payment", () => {
    // Six payments, the first on May 15.
    expect(found(monthly(6, 14_200, GEICO))).toEqual([
      {
        merchantKey: "geico",
        carrier: "GEICO",
        kind: "auto",
        premiumCents: 14_200,
        premiumFrequency: "monthly",
        renewalDate: "2027-05-15",
        termMonths: 12,
      },
    ]);
  });

  // Overnight upload QA: "Geico Auto Payment car", "State Farm Ro 27 car".
  it("names a known insurer by its own name, not the statement's words", () => {
    const statement = {
      ...GEICO,
      description: "STATE FARM RO 27 DES:CPC-CLIENT",
      merchantName: "State Farm Ro 27",
    };
    expect(found(monthly(4, 11_840, statement))).toMatchObject([{ carrier: "State Farm" }]);
    expect(insurerName("geico auto payment")).toBe("GEICO");
    expect(insurerName("progressive ins prem")).toBe("Progressive");
    expect(insurerName("maple mutual")).toBeNull();
  });

  it("takes anything regular in the insurance category, as 'other' when the insurer is unknown", () => {
    const local = { ...GEICO, description: "MAPLE MUTUAL", merchantName: "Maple Mutual" };
    expect(found(monthly(4, 5_000, local))).toMatchObject([
      { carrier: "Maple Mutual", kind: "other" },
    ]);
  });

  it("knows an insurer by name when the category is missing, but not a bank", () => {
    const lemonade = {
      description: "LEMONADE INC",
      merchantName: "Lemonade",
      pfcPrimary: null,
      pfcDetailed: null,
    };
    expect(found(monthly(4, 1_400, lemonade))).toMatchObject([{ kind: "renters" }]);
    const usaaLoan = {
      description: "USAA LOAN PMT",
      merchantName: "USAA",
      pfcPrimary: "LOAN_PAYMENTS",
      pfcDetailed: "LOAN_PAYMENTS_CAR_PAYMENT",
    };
    expect(found(monthly(6, 40_000, usaaLoan))).toEqual([]);
  });

  it("leaves one-off payments alone", () => {
    expect(found([tx({ ...GEICO, date: AS_OF, amountCents: 60_000 })])).toEqual([]);
  });
});

describe("insurerKind and estimatedRenewal", () => {
  it("names the cover from the insurer", () => {
    expect(insurerKind("state farm")).toBe("auto");
    expect(insurerKind("trupanion")).toBe("pet");
    expect(insurerKind("netflix")).toBeNull();
  });

  it("rolls the anniversary forward to the next one on or after today", () => {
    expect(estimatedRenewal("2024-03-10", "2026-10-15", 12)).toBe("2027-03-10");
    expect(estimatedRenewal("2026-01-31", "2026-07-01", 6)).toBe("2026-07-31");
  });
});

describe("annualFeeDeadlines", () => {
  it("expects a card's annual fee again a year after the last one", () => {
    const fee = tx({
      accountId: CARD.id,
      description: "ANNUAL MEMBERSHIP FEE",
      amountCents: 9_500,
      date: monthsAgo(11, 1),
    });
    expect(annualFeeDeadlines(input({ transactions: [fee] }))).toEqual([
      {
        key: `annual_fee:${CARD.id}:2026-11-01`,
        title: "Example Rewards Card's annual fee",
        date: "2026-11-01",
        kind: "renewal",
        source: "transactions",
        amountCents: 9_500,
        href: "/transactions",
        detail: expect.stringMatching(/an estimate/),
        chargedOn: monthsAgo(11, 1),
        evidence: { kind: "word" },
      },
    ]);
  });

  it("leaves out a fee due beyond the horizon and other fees", () => {
    const recent = tx({ description: "ANNUAL FEE", amountCents: 9_500, date: monthsAgo(1, 1) });
    const late = tx({ description: "LATE FEE", amountCents: 4_000, date: monthsAgo(11, 1) });
    expect(annualFeeDeadlines(input({ transactions: [recent, late] }))).toEqual([]);
  });
});
