import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));

import { documentTitle, policyLines, sameCompany } from "./dates";

describe("what documents mean elsewhere (spec step 68)", () => {
  it("matches an insurer however the bank or the policy spells it", () => {
    expect(sameCompany("GEICO General Insurance Company", "GEICO")).toBe(true);
    expect(sameCompany("State Farm Mutual Automobile Insurance Co", "STATE FARM INSURANCE")).toBe(
      true,
    );
    expect(sameCompany("Progressive", "PROGRESSIVE INS PMT")).toBe(true);
    expect(sameCompany("Allstate", "GEICO")).toBe(false);
    expect(sameCompany("Insurance Company", "Insurance Co")).toBe(false);
    expect(sameCompany("Farmers", "State Farm")).toBe(false);
  });

  it("names a document by its company and type, or its file", () => {
    const base = { kind: "insurance_policy", policyType: "auto", fileName: "scan.pdf" };
    expect(documentTitle({ ...base, provider: "GEICO" })).toBe("GEICO car insurance");
    expect(documentTitle({ ...base, provider: "GEICO", policyType: "other" })).toBe("GEICO");
    expect(documentTitle({ ...base, provider: null })).toBe("scan.pdf");
    expect(documentTitle({ ...base, kind: "receipt", provider: "Target" })).toBe("Target");
  });

  it("says what the policy shows on the insurance card", () => {
    expect(
      policyLines({
        documentId: "d1",
        renewalDate: "2027-03-01",
        premiumCents: 61_200,
        premiumFrequency: "semiannual",
      }),
    ).toEqual(["Renews on Mar 1, 2027", "$612.00 every 6 months"]);
    expect(
      policyLines({
        documentId: "d1",
        renewalDate: null,
        premiumCents: 100,
        premiumFrequency: null,
      }),
    ).toEqual([]);
  });
});
