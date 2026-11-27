import { describe, expect, it } from "vitest";
import { awaited, isAwaited } from "./awaited";
import { NoTaxParamsError } from "./errors";
import { US_2027 } from "./us-2027";

// Tax T32b: a group its source has not published is in the file with its source and note, but holds
// no value, so no reader can reach a number (the IRS 2027 business mileage rate, a December notice).
describe("an awaited group", () => {
  const group = awaited<{ rate: number }>(2031, "demo", {
    source: "https://www.irs.gov/x",
    where: "the notice",
    checkedOn: "2026-11-27",
    verify: "AWAITED: the notice",
  });

  it("throws NoTaxParamsError carrying the year and the group on any read of its value", () => {
    let caught: unknown;
    try {
      void group.value;
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(NoTaxParamsError);
    expect(caught).toMatchObject({ year: 2031, jurisdiction: "US", group: "demo" });
    expect(() => group.value.rate).toThrow(NoTaxParamsError);
    expect(() => ({ ...group.value })).toThrow(NoTaxParamsError);
  });

  it("is not a number a copy can carry: spread, JSON and Object.values never reach a value", () => {
    expect({ ...group }).not.toHaveProperty("value");
    expect(JSON.parse(JSON.stringify(group))).not.toHaveProperty("value");
    expect(Object.keys(group)).not.toContain("value");
    expect(isAwaited(group)).toBe(true);
    expect(group.status).toBe("awaited");
  });

  it("stays awaited when frozen (the deep freeze walks values, not the getter)", () => {
    Object.freeze(group);
    expect(() => group.value).toThrow(NoTaxParamsError);
  });

  it("2027's mileage is the awaited group today, with its source and what is awaited", () => {
    expect(isAwaited(US_2027.mileage)).toBe(true);
    expect(() => US_2027.mileage.value).toThrow(
      expect.objectContaining({ year: 2027, group: "mileage" }),
    );
    expect(US_2027.mileage.verify).toMatch(
      /AWAITED: the IRS notice with the 2027 standard mileage/,
    );
    expect(US_2027.mileage.source).toBe(
      "https://www.irs.gov/tax-professionals/standard-mileage-rates",
    );
  });
});
