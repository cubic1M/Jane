import { describe, expect, it } from "vitest";
import { BILL_BENCHMARKS, BILL_NEGOTIATION_MIN_GAP_CENTS } from "@/config/detection";
import { input, monthly } from "../__fixtures__/build";
import { buildStreams } from "../streams";
import type { DetectionInput } from "../types";
import { billNegotiation } from "./bill-negotiation";

const run = (data: DetectionInput) => billNegotiation(data, buildStreams(data));
const bill = (category: string, monthlyCents: number) =>
  input({
    transactions: monthly(6, monthlyCents, {
      description: "HOMETOWN PROVIDER",
      merchantName: "Hometown Provider",
      pfcPrimary: "RENT_AND_UTILITIES",
      pfcDetailed: category,
    }),
  });

describe.each(BILL_BENCHMARKS.map((b) => [b.id, b] as const))("bill_negotiation: %s", (_id, b) => {
  const [category] = b.categories;

  it("finds nothing below or at the top of the typical range", () => {
    expect(run(bill(category, b.typicalLowCents))).toEqual([]);
    expect(run(bill(category, b.typicalHighCents))).toEqual([]);
    // Over by less than the minimum gap (taxes and rounding).
    expect(run(bill(category, b.typicalHighCents + BILL_NEGOTIATION_MIN_GAP_CENTS - 1))).toEqual(
      [],
    );
  });

  it("finds a bill above the range, estimating the gap to the top for a year", () => {
    const monthlyCents = b.typicalHighCents + 4_000;
    const [finding] = run(bill(category, monthlyCents));

    expect(finding).toMatchObject({
      type: "bill_negotiation",
      key: "merchant:hometown provider",
      title: `Your Hometown Provider ${b.label} bill is above the typical price`,
      annualSavingsCents: 4_000 * 12,
      amountCents: monthlyCents,
    });
    expect(finding.evidence).toMatchObject({
      typicalLowCents: b.typicalLowCents,
      typicalHighCents: b.typicalHighCents,
      benchmarkSource: b.source,
    });
  });
});

describe("bill_negotiation", () => {
  it("knows big providers by name when the category is missing", () => {
    const data = input({
      transactions: monthly(6, 20_000, { description: "COMCAST CABLE", merchantName: "Comcast" }),
    });
    expect(run(data)).toHaveLength(1);
  });

  it("ignores other recurring bills, however expensive", () => {
    expect(run(bill("RENT_AND_UTILITIES_GAS_AND_ELECTRICITY", 50_000))).toEqual([]);
  });

  it("notes a source for every benchmark", () => {
    for (const b of BILL_BENCHMARKS) expect(b.source.length).toBeGreaterThan(20);
  });
});
