import { describe, expect, it } from "vitest";
import { GEICO, NETFLIX, input, monthly, plaidStream } from "../__fixtures__/build";
import { buildStreams } from "../streams";
import type { DetectionInput } from "../types";
import { insuranceReshop } from "./insurance-reshop";

const run = (data: DetectionInput) => insuranceReshop(data, buildStreams(data));

describe("insurance_reshop", () => {
  it("finds a recurring insurance payment without a dollar estimate", () => {
    const [finding] = run(input({ transactions: monthly(4, 9800, GEICO) }));

    expect(finding).toMatchObject({
      type: "insurance_reshop",
      key: "merchant:geico",
      title: "Your GEICO insurance could cost less",
      annualSavingsCents: null,
      amountCents: 9800 * 12,
    });
  });

  it("uses Plaid's insurance streams", () => {
    const recurringStreams = [
      plaidStream({
        merchantName: "Example Mutual",
        pfcPrimary: "GENERAL_SERVICES",
        pfcDetailed: "GENERAL_SERVICES_INSURANCE",
      }),
    ];

    expect(run(input({ recurringStreams })).map((f) => f.key)).toEqual(["merchant:example mutual"]);
  });

  it("names a known insurer, not the bank's line for it", () => {
    const stateFarm = {
      description: "STATE FARM RO 27 DES:CPC-CLIENT",
      merchantName: null,
      pfcPrimary: "GENERAL_SERVICES",
      pfcDetailed: "GENERAL_SERVICES_INSURANCE",
    };
    const [finding] = run(input({ transactions: monthly(4, 11840, stateFarm) }));

    expect(finding?.title).toBe("Your State Farm insurance could cost less");
  });

  // Debugger 11-02: a food truck's "NEXT INSURANCE DES:INS PREM" read "Your Next Insurance
  // insurance could cost less": the company's name already says insurance.
  it("says insurance once when the company's name does", () => {
    const next = {
      description: "NEXT INSURANCE DES:INS PREM ID:NX88 INDN:SAM DOE",
      merchantName: null,
      pfcPrimary: "GENERAL_SERVICES",
      pfcDetailed: "GENERAL_SERVICES_INSURANCE",
    };
    const [finding] = run(input({ transactions: monthly(4, 21240, next) }));
    expect(finding?.title).toBe("Your Next Insurance policy could cost less");
  });

  // Debugger 11-01: a soldier's USAA car and renters policies, both "USAA Insurance" on the
  // statement, made two cards both titled "Your USAA insurance could cost less".
  it("tells two policies from one insurer apart by their price", () => {
    const usaa = {
      description: "USAA Insurance",
      merchantName: null,
      pfcPrimary: "GENERAL_SERVICES",
      pfcDetailed: "GENERAL_SERVICES_INSURANCE",
    };
    const transactions = [
      ...monthly(4, 13_822, { ...usaa, id: "car" }),
      ...monthly(4, 1_450, { ...usaa, id: "renters" }),
    ].map((t, i) => ({ ...t, id: `usaa-${i}` }));
    const titles = run(input({ transactions }))
      .map((f) => f.title)
      .sort();
    expect(titles).toEqual([
      "Your USAA insurance at $138.22 could cost less",
      "Your USAA insurance at $14.50 could cost less",
    ]);
    expect(run(input({ transactions: monthly(4, 9800, GEICO) }))[0].title).toBe(
      "Your GEICO insurance could cost less",
    );
  });

  it("finds nothing without insurance payments", () => {
    expect(run(input({ transactions: monthly(4, 1549, NETFLIX) }))).toEqual([]);
  });
});
