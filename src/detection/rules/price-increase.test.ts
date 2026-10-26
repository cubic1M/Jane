import { describe, expect, it } from "vitest";
import { GROCERIES, NETFLIX, input, monthly } from "../__fixtures__/build";
import { buildStreams } from "../streams";
import type { DetectionInput } from "../types";
import { priceIncrease } from "./price-increase";

const run = (data: DetectionInput) => priceIncrease(data, buildStreams(data));

describe("price_increase", () => {
  it("finds a latest charge 5% or more above the earlier average", () => {
    const transactions = monthly(6, [1549, 1549, 1549, 1549, 1549, 1799], NETFLIX);

    const [finding] = run(input({ transactions }));

    expect(finding).toMatchObject({
      type: "price_increase",
      key: "merchant:netflix",
      title: "Netflix went up from $15.49 to $17.99",
      annualSavingsCents: (1799 - 1549) * 12,
      confidence: "high",
    });
    expect(finding.evidence).toMatchObject({ priorAverageCents: 1549, lastAmountCents: 1799 });
  });

  // Messy-bank QA: the rise stays a finding after the second charge at the new price.
  it("still finds the rise once a charge or two more come at the new price", () => {
    const [finding] = run(input({ transactions: monthly(4, [1549, 1549, 1799, 1799], NETFLIX) }));

    expect(finding).toMatchObject({
      title: "Netflix went up from $15.49 to $17.99",
      annualSavingsCents: (1799 - 1549) * 12,
      confidence: "medium",
    });
    expect(finding.evidence).toMatchObject({ priorAverageCents: 1549 });
  });

  it("stops calling it a rise after PRICE_INCREASE_MAX_CHARGES_SINCE charges at the new price", () => {
    const transactions = monthly(7, [1549, 1549, 1549, 1799, 1799, 1799, 1799], NETFLIX);

    expect(run(input({ transactions }))).toEqual([]);
  });

  it("rates a short history medium confidence", () => {
    const [finding] = run(input({ transactions: monthly(3, [1000, 1000, 1100], NETFLIX) }));

    expect(finding.confidence).toBe("medium");
  });

  it("finds nothing below the threshold", () => {
    const transactions = monthly(5, [1549, 1549, 1549, 1549, 1600], NETFLIX);

    expect(run(input({ transactions }))).toEqual([]);
  });

  it("finds nothing when the price went down", () => {
    const transactions = monthly(5, [1799, 1799, 1799, 1799, 1549], NETFLIX);

    expect(run(input({ transactions }))).toEqual([]);
  });

  it("ignores a stream whose earlier charges weren't a fixed price", () => {
    const transactions = monthly(5, [1450, 1580, 1460, 1570, 1750], {
      ...NETFLIX,
      pfcPrimary: "GENERAL_SERVICES",
      pfcDetailed: "GENERAL_SERVICES_OTHER_GENERAL_SERVICES",
    });

    expect(run(input({ transactions }))).toEqual([]);
  });

  it("ignores regular shopping, even at a steady amount", () => {
    const transactions = monthly(5, [20000, 20000, 20000, 20000, 23000], GROCERIES);

    expect(run(input({ transactions }))).toEqual([]);
  });

  it("ignores rent and usage-based bills", () => {
    const transactions = [
      ...monthly(4, [200000, 200000, 200000, 215000], {
        description: "OAK STREET APARTMENTS",
        pfcPrimary: "RENT_AND_UTILITIES",
        pfcDetailed: "RENT_AND_UTILITIES_RENT",
      }),
      ...monthly(4, [8000, 8000, 8000, 8600], {
        description: "CITY POWER AND LIGHT",
        pfcPrimary: "RENT_AND_UTILITIES",
        pfcDetailed: "RENT_AND_UTILITIES_GAS_AND_ELECTRICITY",
      }),
    ];

    expect(run(input({ transactions }))).toEqual([]);
  });
});
