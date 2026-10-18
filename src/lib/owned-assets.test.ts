import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));

import { AssetError, assetPrompts, checkAsset, promptHref } from "./owned-assets";

const TODAY = "2026-10-18";
const input = (overrides = {}) => ({
  kind: "home",
  name: " Our house ",
  value: "$450,000",
  valuedOn: "2026-09-01",
  loanAccountId: "",
  ...overrides,
});

describe("checkAsset", () => {
  it("turns the form into cents, a UTC day and a trimmed name", () => {
    expect(checkAsset(input({ loanAccountId: " loan1 " }), TODAY)).toEqual({
      kind: "home",
      name: "Our house",
      valueCents: 45_000_000,
      valuedOn: new Date("2026-09-01T00:00:00Z"),
      loanAccountId: "loan1",
    });
  });

  it("dates the value today when no date is given, and has no loan when none is picked", () => {
    const checked = checkAsset(input({ valuedOn: "" }), TODAY);
    expect(checked.valuedOn).toEqual(new Date("2026-10-18T00:00:00Z"));
    expect(checked.loanAccountId).toBeNull();
  });

  it.each([
    [{ kind: "boat" }, "Pick what kind"],
    [{ name: "  " }, "short name"],
    [{ name: "x".repeat(81) }, "short name"],
    [{ value: "" }, "worth"],
    [{ value: "0" }, "worth"],
    [{ value: "-5" }, "worth"],
    [{ value: "abc" }, "worth"],
    // Over $20 million, the typo guard (and what a 32-bit cents column holds).
    [{ value: "20000000.01" }, "worth"],
    [{ valuedOn: "2026-10-19" }, "future"],
    [{ valuedOn: "2026-02-30" }, "Pick the date"],
    [{ valuedOn: "10/01/2026" }, "Pick the date"],
  ])("refuses %o", (overrides, message) => {
    expect(() => checkAsset(input(overrides), TODAY)).toThrow(AssetError);
    expect(() => checkAsset(input(overrides), TODAY)).toThrow(message);
  });

  it("takes every kind, the most it allows, and today's date", () => {
    for (const kind of ["home", "vehicle", "other"]) {
      expect(checkAsset(input({ kind }), TODAY).kind).toBe(kind);
    }
    expect(checkAsset(input({ value: "20000000" }), TODAY).valueCents).toBe(2_000_000_000);
    expect(checkAsset(input({ valuedOn: TODAY }), TODAY).valuedOn).toEqual(
      new Date("2026-10-18T00:00:00Z"),
    );
  });
});

describe("assetPrompts", () => {
  const loans = [
    { id: "m1", name: "Home Loan", type: "loan", subtype: "mortgage" },
    { id: "a1", name: "Car Loan", type: "loan", subtype: "auto" },
    { id: "s1", name: "Student Loan", type: "loan", subtype: "student" },
    { id: "c1", name: "Card", type: "credit", subtype: "credit card" },
  ];

  it("asks for a home's value for a mortgage and a car's for a car loan", () => {
    expect(assetPrompts(loans, [])).toEqual([
      {
        loanId: "m1",
        loanName: "Home Loan",
        kind: "home",
        text: "Add your home's value to see your equity",
      },
      {
        loanId: "a1",
        loanName: "Car Loan",
        kind: "vehicle",
        text: "Add your car's value to see your equity",
      },
    ]);
  });

  it("stops asking once something is linked to the loan", () => {
    expect(assetPrompts(loans, ["m1", null]).map((p) => p.loanId)).toEqual(["a1"]);
    expect(assetPrompts(loans, ["m1", "a1"])).toEqual([]);
  });

  it("links to the form with the kind and loan filled in", () => {
    expect(promptHref({ kind: "home", loanId: "m1" })).toBe("/things?kind=home&loan=m1");
  });
});
