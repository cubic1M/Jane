import { describe, expect, it } from "vitest";
import { premiumsOnFile } from "./invariants";

// Class 10 (debug 2, sweep 12): Bills listed "Progressive Insurance $154.99" a month while
// Insurance said car cover was "Not on file": a premium in the payments with no policy row.

describe("an insurer paid as a bill has a policy row", () => {
  it("names a premium with no row", () => {
    expect(
      premiumsOnFile({
        "insurance.premiums.0": "progressive ins prem",
        "insurance.onFile.0": "geico",
      }),
    ).toEqual([
      'insurance.premiums: "progressive ins prem" is paid as insurance with no policy row',
    ]);
  });

  it("passes a premium with a row, found, the person's own or removed", () => {
    expect(
      premiumsOnFile({
        "insurance.premiums.0": "progressive ins prem",
        "insurance.onFile.0": "progressive ins prem",
      }),
    ).toEqual([]);
    expect(premiumsOnFile({})).toEqual([]);
  });
});
