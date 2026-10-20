import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/session", () => ({ requireUser: vi.fn(async () => ({ id: "u1" })) }));
vi.mock("@/lib/tax-profile", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/tax-profile")>()),
  saveTaxAnswers: vi.fn(),
  savePayStub: vi.fn(),
  loadTaxProfile: vi.fn(async () => ({ state: { value: "NY" } })),
}));
vi.mock("@/lib/family-taxes", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/family-taxes")>()),
  saveFamilyDetails: vi.fn(),
}));
vi.mock("@/lib/home-taxes", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/home-taxes")>()),
  saveHomeAnswers: vi.fn(),
}));
vi.mock("@/lib/side-income", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/side-income")>()),
  saveSideIncomeAnswers: vi.fn(),
}));
vi.mock("@/lib/tax-states", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/tax-states")>()),
  saveMoves: vi.fn(),
  saveWorkState: vi.fn(),
  saveLocality: vi.fn(),
}));

import { revalidatePath } from "next/cache";
import { TaxProfileError, savePayStub, saveTaxAnswers } from "@/lib/tax-profile";
import { ResidencyError, saveLocality, saveMoves, saveWorkState } from "@/lib/tax-states";
import { FamilyTaxesError, saveFamilyDetails } from "@/lib/family-taxes";
import { HomeTaxesError, saveHomeAnswers } from "@/lib/home-taxes";
import { SideIncomeError, saveSideIncomeAnswers } from "@/lib/side-income";
import {
  saveFamilyAction,
  saveHomeAction,
  saveSideIncomeAction,
  savePayStubAction,
  saveResidencyAction,
  saveTaxProfile,
} from "./actions";
import {
  answersFrom,
  familyFrom,
  homeFrom,
  payStubFrom,
  residencyFrom,
  sideIncomeFrom,
} from "./answers";

// Spec step 118: the tax profile page saves only what was filled in.

const form = (fields: [string, string][]) => {
  const data = new FormData();
  for (const [k, v] of fields) data.append(k, v);
  return data;
};

describe("the tax profile form", () => {
  beforeEach(() => vi.clearAllMocks());

  it("reads every field that was filled in", () => {
    expect(
      answersFrom(
        form([
          ["incomeKinds", "investment"],
          ["incomeKinds", "w2"],
          ["filingStatus", "head_of_household"],
          ["childrenUnder17", "2"],
          ["otherDependants", ""],
          ["state", "WA"],
        ]),
      ),
    ).toEqual([
      { field: "incomeKinds", value: ["w2", "investment"] },
      { field: "filingStatus", value: "head_of_household" },
      { field: "dependants", childrenUnder17: 2, otherDependants: 0 },
      { field: "state", value: "WA" },
    ]);
  });

  it("leaves empty fields unanswered, and None of these means no income", () => {
    expect(answersFrom(form([]))).toEqual([]);
    expect(answersFrom(form([["noIncome", "1"]]))).toEqual([{ field: "incomeKinds", value: [] }]);
  });

  it("refuses a filing status or number that isn't one", () => {
    expect(() => answersFrom(form([["filingStatus", "widow"]]))).toThrow(TaxProfileError);
    expect(answersFrom(form([["childrenUnder17", "two"]]))).toEqual([
      { field: "dependants", childrenUnder17: NaN, otherDependants: 0 },
    ]);
  });

  it("saves for the signed-in person and says so", async () => {
    expect(await saveTaxProfile(null, form([["state", "WA"]]))).toEqual({
      ok: true,
      message: "Saved. I'll use these for your taxes.",
    });
    expect(saveTaxAnswers).toHaveBeenCalledWith("u1", [{ field: "state", value: "WA" }], {
      via: "page",
    });
    expect(revalidatePath).toHaveBeenCalledWith("/taxes");
  });

  it("says what's wrong instead of saving", async () => {
    expect(await saveTaxProfile(null, form([]))).toEqual({
      ok: false,
      message: "Fill in at least one answer.",
    });
    vi.mocked(saveTaxAnswers).mockRejectedValueOnce(
      new TaxProfileError("Pick a state from the list."),
    );
    expect(await saveTaxProfile(null, form([["state", "ZZ"]]))).toEqual({
      ok: false,
      message: "Pick a state from the list.",
    });
  });
});

describe("the pay stub form (spec step 120)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("reads dollars and cents, empty amounts as zero", () => {
    expect(
      payStubFrom(
        form([
          ["payAsOf", "2026-09-25"],
          ["payGross", "76,000.00"],
          ["payFederal", "9500"],
          ["payState", ""],
          ["payRetirement", "3,800"],
          ["payPretax", "1200.50"],
        ]),
      ),
    ).toEqual({
      asOf: "2026-09-25",
      grossCents: 7_600_000,
      federalCents: 950_000,
      stateCents: 0,
      retirementCents: 380_000,
      pretaxCents: 120_050,
    });
  });

  it("clears it when gross pay is empty, and refuses amounts that aren't money", () => {
    expect(payStubFrom(form([["payFederal", "100"]]))).toBeNull();
    expect(() => payStubFrom(form([["payGross", "lots"]]))).toThrow(TaxProfileError);
  });

  it("saves for the signed-in person and says what changed", async () => {
    expect(
      await savePayStubAction(
        null,
        form([
          ["payAsOf", "2026-09-25"],
          ["payGross", "100"],
        ]),
      ),
    ).toEqual({ ok: true, message: "Saved. Your estimate uses it now." });
    expect(savePayStub).toHaveBeenCalledWith(
      "u1",
      expect.objectContaining({ grossCents: 10_000 }),
      {
        via: "page",
      },
    );
    expect(await savePayStubAction(null, form([]))).toEqual({
      ok: true,
      message: "Cleared. Your estimate no longer uses a pay stub.",
    });
    vi.mocked(savePayStub).mockRejectedValueOnce(new TaxProfileError("Give the pay stub's date."));
    expect(await savePayStubAction(null, form([["payGross", "100"]]))).toEqual({
      ok: false,
      message: "Give the pay stub's date.",
    });
  });
});

describe("where you lived and worked (spec step 165)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("reads a move, one state all year, the employer's state and the city", () => {
    expect(
      residencyFrom(
        form([
          ["movedOn", "2026-08-03"],
          ["movedFrom", "CA"],
          ["movedTo", "NY"],
          ["workState", "CT"],
          ["locality", "nyc"],
        ]),
      ),
    ).toEqual({
      move: { date: "2026-08-03", from: "CA", to: "NY" },
      oneState: false,
      workState: "CT",
      locality: "nyc",
    });
    expect(residencyFrom(form([["oneState", "1"]]))).toEqual({
      move: null,
      oneState: true,
      workState: null,
      locality: null,
    });
    expect(() => residencyFrom(form([["movedOn", "2026-08-03"]]))).toThrow(ResidencyError);
  });

  it("saves for the signed-in person and says what's wrong instead", async () => {
    expect(
      await saveResidencyAction(
        null,
        form([
          ["movedOn", "2026-08-03"],
          ["movedFrom", "CA"],
          ["movedTo", "NY"],
        ]),
      ),
    ).toEqual({ ok: true, message: "Saved. Your state estimate uses it now." });
    expect(saveMoves).toHaveBeenCalledWith(
      "u1",
      2026,
      [{ date: "2026-08-03", from: "CA", to: "NY" }],
      expect.objectContaining({ via: "page" }),
    );
    expect(saveWorkState).toHaveBeenCalledWith("u1", null, { via: "page" });
    expect(saveLocality).not.toHaveBeenCalled();
    vi.mocked(saveMoves).mockRejectedValueOnce(new ResidencyError("Pick two different states."));
    expect(
      await saveResidencyAction(
        null,
        form([
          ["movedOn", "2026-08-03"],
          ["movedFrom", "CA"],
          ["movedTo", "CA"],
        ]),
      ),
    ).toEqual({ ok: false, message: "Pick two different states." });
  });
});

describe("family details (spec step 169)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("reads the children with an age, a spouse's wages, the home and a student", () => {
    expect(
      familyFrom(
        form([
          ["childAge0", "4"],
          ["childMonths0", "12"],
          ["childSsn0", "on"],
          ["childAge1", ""],
          ["childAge2", "9"],
          ["childMonths2", "5"],
          ["spouseWages", "40,000"],
          ["paysOverHalfHome", "on"],
          ["studentYears", "1"],
          ["studentHalfTime", "on"],
        ]),
      ),
    ).toEqual({
      children: [
        { ageAtYearEnd: 4, hasSsn: true, monthsLivedWithYou: 12 },
        { ageAtYearEnd: 9, hasSsn: false, monthsLivedWithYou: 5 },
      ],
      spouseWagesCents: 4_000_000,
      paysOverHalfHome: true,
      student: { yearsOfCollegeBefore: 1, halfTime: true },
    });
    expect(() => familyFrom(form([["spouseWages", "lots"]]))).toThrow(FamilyTaxesError);
  });

  it("saves for the signed-in person and says what's wrong instead", async () => {
    expect(await saveFamilyAction(null, form([["childAge0", "4"]]))).toEqual({
      ok: true,
      message: "Saved. Your family tax choices use it now.",
    });
    expect(saveFamilyDetails).toHaveBeenCalledWith(
      "u1",
      expect.objectContaining({
        children: [{ ageAtYearEnd: 4, hasSsn: false, monthsLivedWithYou: 12 }],
      }),
      { via: "page" },
    );
    vi.mocked(saveFamilyDetails).mockRejectedValueOnce(
      new FamilyTaxesError("Months lived with you must be 0 to 12."),
    );
    expect(await saveFamilyAction(null, form([["childAge0", "4"]]))).toEqual({
      ok: false,
      message: "Months lived with you must be 0 to 12.",
    });
  });
});

describe("points and a home sale (spec step 170)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("reads points and a sale, and clears what's empty", () => {
    expect(
      homeFrom(
        form([
          ["points", "3,000"],
          ["pointsLoanYears", "30"],
          ["pointsPurchase", "on"],
          ["boughtOn", "2018-03-01"],
          ["price", "600,000"],
          ["soldOn", "2026-09-15"],
          ["sale", "950,000"],
          ["costs", "50,000"],
          ["daysLivedIn", "1826"],
        ]),
        2026,
      ),
    ).toEqual({
      points: { cents: 300_000, year: 2026, purchase: true, loanYears: 30 },
      sale: {
        boughtOn: "2018-03-01",
        priceCents: 60_000_000,
        soldOn: "2026-09-15",
        saleCents: 95_000_000,
        costsCents: 5_000_000,
        daysLivedIn: 1826,
      },
    });
    expect(homeFrom(form([]), 2026)).toEqual({ points: null, sale: null });
    expect(() => homeFrom(form([["points", "lots"]]), 2026)).toThrow(HomeTaxesError);
  });

  it("saves for the signed-in person and says what's wrong instead", async () => {
    expect(await saveHomeAction(null, form([]))).toEqual({
      ok: true,
      message: "Saved. Your home's taxes use it now.",
    });
    expect(saveHomeAnswers).toHaveBeenCalledWith(
      "u1",
      { points: null, sale: null },
      expect.objectContaining({ via: "page" }),
    );
    vi.mocked(saveHomeAnswers).mockRejectedValueOnce(
      new HomeTaxesError("The sale is before the purchase."),
    );
    expect(await saveHomeAction(null, form([]))).toEqual({
      ok: false,
      message: "The sale is before the purchase.",
    });
  });
});

describe("a rental and hobby or business (spec step 173)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("reads the property and the kind, and clears an empty one", () => {
    expect(
      sideIncomeFrom(
        form([
          ["rentalPrice", "300,000"],
          ["rentalPlacedOn", "2026-03-01"],
          ["sideIncomeKind", "hobby"],
        ]),
      ),
    ).toEqual({ rental: { priceCents: 30_000_000, placedOn: "2026-03-01" }, kind: "hobby" });
    expect(sideIncomeFrom(form([["sideIncomeKind", "other"]]))).toEqual({
      rental: null,
      kind: null,
    });
    expect(() => sideIncomeFrom(form([["rentalPrice", "lots"]]))).toThrow(SideIncomeError);
  });

  it("saves for the signed-in person and says what's wrong instead", async () => {
    expect(await saveSideIncomeAction(null, form([]))).toEqual({
      ok: true,
      message: "Saved. Your estimate uses it now.",
    });
    expect(saveSideIncomeAnswers).toHaveBeenCalledWith(
      "u1",
      { rental: null, kind: null },
      expect.objectContaining({ via: "page" }),
    );
    vi.mocked(saveSideIncomeAnswers).mockRejectedValueOnce(
      new SideIncomeError("Give the date it was ready to rent."),
    );
    expect(await saveSideIncomeAction(null, form([]))).toEqual({
      ok: false,
      message: "Give the date it was ready to rent.",
    });
  });
});
