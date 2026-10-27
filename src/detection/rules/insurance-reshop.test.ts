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

  it("finds nothing without insurance payments", () => {
    expect(run(input({ transactions: monthly(4, 1549, NETFLIX) }))).toEqual([]);
  });
});
