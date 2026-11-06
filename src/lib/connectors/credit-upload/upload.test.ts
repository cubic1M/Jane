import { describe, expect, it } from "vitest";
import { CreditUploadError, creditForLlm, validateCreditUpload, validateScore } from "./upload";

// What Jane keeps of a person's own credit report, and what Claude may see of it (roadmap round 9).

// A report as a reader might return it, with everything a real one carries that Jane must drop.
const READ = {
  bureau: "experian",
  reportDate: "2026-11-01",
  name: "Alex Q. Sample",
  address: "1 Test Lane, Springfield, IL 62702",
  ssnLast4: "6789",
  openCards: [
    { limitCents: 500_000, balanceCents: 125_000, accountNumber: "4111111111111111" },
    { limitCents: 300_000, balanceCents: 0, issuer: "Example Bank" },
  ],
  oldestAccountMonths: 96,
  averageAgeMonths: 41,
  hardInquiries12m: 2,
  late24m: { days30: 1, days60: 0, days90: 0 },
  collections: [
    { creditor: "Example Medical Billing", amountCents: 42_000, medical: true, ref: "AC-99812" },
  ],
  tradelines: [{ creditor: "Example Bank", account: "****1234" }],
};

describe("validateCreditUpload", () => {
  it("keeps exactly the derived fields and drops the rest", () => {
    const kept = validateCreditUpload(READ, { today: "2026-11-06" });
    expect(Object.keys(kept).sort()).toEqual(
      [
        "averageAgeMonths",
        "bureau",
        "collections",
        "hardInquiries12m",
        "late24m",
        "oldestAccountMonths",
        "openCards",
        "reportDate",
      ].sort(),
    );
    const text = JSON.stringify(kept);
    for (const gone of ["Alex", "Test Lane", "6789", "4111", "Example Bank", "AC-99812", "1234"]) {
      expect(text, gone).not.toContain(gone);
    }
    expect(kept.openCards[0]).toEqual({ limitCents: 500_000, balanceCents: 125_000 });
  });

  it("refuses what doesn't fit", () => {
    const bad = [
      { ...READ, bureau: "innovis" },
      { ...READ, reportDate: "Nov 1" },
      { ...READ, hardInquiries12m: -1 },
      { ...READ, averageAgeMonths: 1.5 },
      { ...READ, collections: [{ creditor: "Acct 12345678", amountCents: 1, medical: false }] },
      { ...READ, collections: [{ creditor: "a@b.com", amountCents: 1, medical: false }] },
      // An account number in short groups is still one.
      { ...READ, collections: [{ creditor: "Acct 123-456-789", amountCents: 1, medical: false }] },
      { ...READ, openCards: "none" },
      // A day that isn't on the calendar, or one after today.
      { ...READ, reportDate: "2026-99-99" },
      { ...READ, reportDate: "2026-02-30" },
      { ...READ, reportDate: "2026-11-07" },
    ];
    for (const raw of bad) {
      expect(() => validateCreditUpload(raw, { today: "2026-11-06" }), JSON.stringify(raw)).toThrow(
        CreditUploadError,
      );
    }
  });
});

describe("validateScore", () => {
  const today = "2026-11-06";
  it("takes a score in its model's range, dated lately and not in the future", () => {
    expect(validateScore({ model: "fico_8", score: 712, asOf: "2026-11-01" }, { today })).toEqual({
      model: "fico_8",
      score: 712,
      asOf: "2026-11-01",
    });
    for (const raw of [
      { model: "fico_8", score: 299, asOf: "2026-11-01" },
      { model: "fico_8", score: 851, asOf: "2026-11-01" },
      { model: "fico_9", score: 700, asOf: "2026-11-01" },
      { model: "vantagescore_3", score: 700, asOf: "2026-11-07" },
      { model: "vantagescore_3", score: 700, asOf: "2026-09-01" },
      { model: "vantagescore_3", score: 700.5, asOf: "2026-11-01" },
      // Not on the calendar: no age to check, so never taken as fresh.
      { model: "fico_8", score: 700, asOf: "2025-13-01" },
      { model: "fico_8", score: 700, asOf: "2026-00-10" },
    ]) {
      expect(() => validateScore(raw, { today }), JSON.stringify(raw)).toThrow(CreditUploadError);
    }
  });
});

describe("creditForLlm", () => {
  it("is numbers and labels only: no creditor, no name, no address, no account digits", () => {
    const view = creditForLlm(validateCreditUpload(READ, { today: "2026-11-06" }), {
      model: "vantagescore_3",
      score: 688,
      asOf: "2026-11-01",
    });
    expect(view).toMatchObject({
      score: 688,
      scoreModel: "VantageScore 3.0",
      openCards: 2,
      utilisationPercent: 16,
      collections: 1,
      collectionsCents: 42_000,
      medicalCollections: 1,
    });
    const text = JSON.stringify(view).replace(/\d{4}-\d{2}-\d{2}/g, "<day>");
    expect(text).not.toMatch(/Example|Alex|Lane|Medical Billing|@/);
    // No run of digits long enough to be part of an account number or an SSN.
    expect(text).not.toMatch(/\d{7,}/);
    const strings = Object.values(view).filter((v) => typeof v === "string");
    expect(strings.sort()).toEqual(["2026-11-01", "2026-11-01", "VantageScore 3.0"].sort());
  });
});
