import { describe, expect, it } from "vitest";
import { SAMPLE_RELIEF, type Relief } from "@/config/disasters";
import {
  casualtyLoss,
  computedMoves,
  countyFromPayments,
  countyOf,
  covers,
  damageSince,
  deadlineMoves,
  reliefFor,
} from "./disasters";

// Spec step 270: disaster postponements for the person's county moving every affected tax
// deadline, and the casualty loss after insurance and the floors.

const harris = SAMPLE_RELIEF.find((r) => r.id === "SAMPLE-TX-2026-09")!;
const relief = (over: Partial<Relief> = {}): Relief => ({ ...harris, ...over });

describe("the county", () => {
  it("is read from a property tax payee that names it", () => {
    expect(countyOf("HARRIS COUNTY TAX ASSESSOR")).toBe("Harris");
    expect(countyOf("FORT BEND COUNTY TAX OFFICE")).toBe("Fort Bend");
    expect(countyOf("COUNTY TAX COLLECTOR PROPERTY TAX")).toBeNull();
    expect(
      countyFromPayments([
        { description: "HARRIS COUNTY WATER", amountCents: 4_000 },
        { description: "HARRIS COUNTY TAX ASSESSOR", amountCents: 290_000 },
      ]),
    ).toBe("Harris");
  });
});

describe("which relief covers a person", () => {
  it("matches the county by name, the state when known, while the new date is ahead", () => {
    const where = { county: "harris county", state: null };
    expect(reliefFor(SAMPLE_RELIEF, where, "2026-10-17").map((r) => r.id)).toEqual([harris.id]);
    expect(reliefFor(SAMPLE_RELIEF, { county: "Harris", state: "CA" }, "2026-10-17")).toEqual([]);
    expect(reliefFor(SAMPLE_RELIEF, { county: "Travis", state: "TX" }, "2026-10-17")).toEqual([]);
    expect(reliefFor(SAMPLE_RELIEF, where, "2027-05-04")).toEqual([]);
    expect(reliefFor(SAMPLE_RELIEF, { county: null, state: "TX" }, "2026-10-17")).toEqual([]);
  });
});

describe("a postponement moves every affected deadline", () => {
  const list = [
    { id: "a", title: "Pay estimated tax for Q4", dueOn: "2027-01-15", done: false },
    { id: "b", title: "Make your 2026 IRA contribution", dueOn: "2027-04-15", done: false },
    { id: "c", title: "File Form 709 for the gift to Emily", dueOn: "2027-04-15", done: false },
    { id: "d", title: "Get your IRS Identity Protection PIN", dueOn: "2027-01-31", done: false },
    // Done already, not a tax deadline, before the incident, on the new date or after it.
    { id: "e", title: "Pay estimated tax for Q3", dueOn: "2026-09-15", done: true },
    { id: "f", title: "Use the $200 travel credit", dueOn: "2026-12-31", done: false },
    { id: "g", title: "Pay estimated tax for Q2", dueOn: "2026-06-15", done: false },
    { id: "h", title: "Property tax appeal", dueOn: "2027-05-03", done: false },
  ];

  it("moves each tax deadline from the incident up to the new date, and nothing else", () => {
    const moves = deadlineMoves(harris, list);
    expect(moves.map((m) => m.id)).toEqual(["a", "b", "c", "d"]);
    expect(moves.every((m) => m.to === "2027-05-03")).toBe(true);
    expect(moves.find((m) => m.id === "a")!.from).toBe("2027-01-15");
  });

  it("covers the day of the incident and not the new date itself", () => {
    expect(covers(harris, "2026-09-08")).toBe(true);
    expect(covers(harris, "2026-09-07")).toBe(false);
    expect(covers(harris, "2027-05-03")).toBe(false);
  });

  it("moves the dates Jane works out herself: estimated payments and filing day", () => {
    const moves = computedMoves(harris, [2025, 2026, 2027]);
    expect(moves.map((m) => [m.from, m.title])).toEqual([
      ["2026-09-15", "the estimated tax payment for 2026"],
      ["2027-01-15", "the estimated tax payment for 2026"],
      ["2027-04-15", "your 2026 return, any tax due, and 2026 IRA and HSA contributions"],
      ["2027-04-15", "the estimated tax payment for 2027"],
    ]);
  });
});

describe("the casualty loss", () => {
  it("is what insurance didn't pay, less $100 and 10% of income, only in a declared disaster", () => {
    const r = casualtyLoss({
      repairsCents: 3_000_000,
      reimbursedCents: 500_000,
      agiCents: 8_000_000,
      relief: harris,
    });
    expect(r).toMatchObject({
      lossCents: 2_500_000,
      floorCents: 10_000,
      incomeFloorCents: 800_000,
      deductibleCents: 1_690_000,
    });
    expect(
      casualtyLoss({
        repairsCents: 3_000_000,
        reimbursedCents: 500_000,
        agiCents: 8_000_000,
        relief: relief({ federallyDeclared: false }),
      }).deductibleCents,
    ).toBe(0);
  });

  it("uses the $500 floor and no 10% cut for a qualified disaster loss", () => {
    const r = casualtyLoss({
      repairsCents: 1_520_000,
      reimbursedCents: 500_000,
      agiCents: 16_000_000,
      relief: relief({ qualified: true }),
    });
    expect(r).toMatchObject({ floorCents: 50_000, incomeFloorCents: 0, deductibleCents: 970_000 });
  });

  it("is nothing when insurance paid it all", () => {
    expect(
      casualtyLoss({
        repairsCents: 1_000_000,
        reimbursedCents: 1_200_000,
        agiCents: 0,
        relief: harris,
      }).lossCents,
    ).toBe(0);
  });

  it("reads repairs and money back since the incident", () => {
    const d = damageSince(
      [
        { date: "2026-08-01", amountCents: 50_000, description: "ROOF PATCH", pfc: null },
        {
          date: "2026-09-12",
          amountCents: 1_180_000,
          description: "GULF COAST ROOFING",
          pfc: "HOME_IMPROVEMENT_REPAIR_AND_MAINTENANCE",
        },
        { date: "2026-09-20", amountCents: 340_000, description: "SERVPRO", pfc: null },
        {
          date: "2026-10-06",
          amountCents: -500_000,
          description: "FEMA IHP TREAS 310 DISASTER ASSIST",
          pfc: "TRANSFER_IN_DEPOSIT",
        },
        { date: "2026-10-07", amountCents: -400_000, description: "PAYROLL", pfc: "INCOME_SALARY" },
      ],
      "2026-09-08",
    );
    expect(d).toEqual({ repairsCents: 1_180_000 + 340_000, reimbursedCents: 500_000, repairs: 2 });
  });
});
