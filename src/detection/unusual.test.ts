import { describe, expect, it } from "vitest";
import { AS_OF, CARD, input, tx } from "./__fixtures__/build";
import { buildStreams } from "./streams";
import type { DetectionTransaction } from "./types";
import { parseKey, unusualAlerts } from "./unusual";
import { addDays } from "./units";

// Spec step 208: charges that don't look right, from the thresholds in
// src/config/detection.ts; "this was me" teaches the merchant.

const charge = (daysAgo: number, cents: number, over: Partial<DetectionTransaction> = {}) =>
  tx({
    accountId: CARD.id,
    date: addDays(AS_OF, -daysAgo),
    amountCents: cents,
    description: "GADGET SHOP 12",
    merchantName: "Gadget Shop",
    pfcPrimary: "GENERAL_MERCHANDISE",
    ...over,
  });
const run = (transactions: DetectionTransaction[], taught = new Map<string, number>()) => {
  const data = input({ transactions });
  return unusualAlerts(data, buildStreams(data), taught);
};
// Three ordinary purchases, then history old enough to know "never seen" from.
const usual = [charge(120, 3_000), charge(90, 3_500), charge(60, 3_000), charge(40, 3_200)];

describe("unusualAlerts", () => {
  it("flags a charge far above usual for its merchant", () => {
    const alerts = run([...usual, charge(1, 40_000)]);
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toMatchObject({
      type: "unusual_activity",
      title: "$400.00 at Gadget Shop, far above usual",
    });
    expect(parseKey(alerts[0].key)).toMatchObject({
      rule: "spike",
      merchantKey: expect.any(String),
    });
  });

  it("flags a large first charge from a merchant never seen, once history is long enough", () => {
    const first = charge(1, 90_000, {
      description: "NEW JEWELLERS",
      merchantName: "New Jewellers",
    });
    expect(run([...usual, first]).map((a) => a.title)).toEqual([
      "$900.00 at New Jewellers, a first charge",
    ]);
    // Too little history to know it's new, or too small to matter.
    expect(run([charge(10, 3_000), first])).toEqual([]);
    expect(run([...usual, { ...first, amountCents: 5_000 }])).toEqual([]);
  });

  it("flags a monthly subscription charged twice in a month", () => {
    const sub = (days: number) =>
      charge(days, 1_599, {
        description: "STREAMCO",
        merchantName: "StreamCo",
        pfcPrimary: "ENTERTAINMENT",
      });
    const alerts = run([sub(95), sub(65), sub(35), sub(5), sub(1)]);
    expect(alerts.map((a) => a.title)).toEqual(["StreamCo charged twice this month"]);
    expect(run([sub(95), sub(65), sub(35), sub(5)])).toEqual([]);
  });

  it("flags a regular bill much higher than usual", () => {
    const power = (days: number, cents: number) =>
      charge(days, cents, {
        description: "CITY POWER",
        merchantName: "City Power",
        pfcPrimary: "RENT_AND_UTILITIES",
      });
    const alerts = run([power(95, 9_000), power(65, 9_200), power(35, 8_800), power(2, 16_000)]);
    expect(alerts.map((a) => a.title)).toEqual(["City Power bill is $70.00 higher than usual"]);
  });

  it("stays quiet about a merchant the person said was them, up to twice the amount", () => {
    const merchantKey = parseKey(run([...usual, charge(1, 40_000)])[0].key)!.merchantKey;
    expect(run([...usual, charge(1, 40_000)], new Map([[merchantKey, 40_000]]))).toEqual([]);
    expect(run([...usual, charge(1, 90_000)], new Map([[merchantKey, 40_000]]))).toHaveLength(1);
  });

  it("leaves money moving and old charges alone", () => {
    expect(run([...usual, charge(1, 40_000, { pfcPrimary: "TRANSFER_OUT" })])).toEqual([]);
    expect(run([...usual, charge(30, 40_000)])).toEqual([]);
  });

  it("doesn't call a business owner's payroll or suppliers unusual (spec step 253)", () => {
    const payroll = (daysAgo: number, cents: number) =>
      charge(daysAgo, cents, {
        description: "GUSTO PAYROLL",
        merchantName: "Gusto",
        pfcDetailed: "GENERAL_SERVICES_ACCOUNTING_AND_FINANCIAL_PLANNING",
      });
    const data = input({
      transactions: [
        payroll(120, 40_000),
        payroll(90, 40_000),
        payroll(60, 40_000),
        payroll(40, 40_000),
        payroll(1, 430_000),
      ],
    });
    const streams = buildStreams(data);
    expect(unusualAlerts(data, streams, new Map())).toHaveLength(1);
    const expected = new Set(["GENERAL_SERVICES_ACCOUNTING_AND_FINANCIAL_PLANNING"]);
    expect(unusualAlerts(data, streams, new Map(), expected)).toEqual([]);
  });
});
