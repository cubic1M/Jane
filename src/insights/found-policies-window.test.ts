import { describe, expect, it } from "vitest";
import { GEICO, GROCERIES, input, monthly, monthsAgo, tx } from "@/detection/__fixtures__/build";
import { buildStreams } from "@/detection/streams";
import type { DetectionTransaction } from "@/detection/types";
import { policiesFromStreams } from "./found-policies";

// Debug 2 (11-15, a year and two months of Wells Fargo statements, 1280 light): Home's next 30
// days read "GEICO car insurance renews (estimate) Dec 12" for a $112.40 monthly payment that had
// run since the statements began. Detection sees the last twelve months only, so the first GEICO
// payment it sees is a year ago, while historyFrom is the first statement day, 14 months ago: the
// payment looked like it started inside the statements, and "renewed" a year on, next month, every
// month.

const found = (transactions: DetectionTransaction[], historyFrom: string) => {
  const data = input({ transactions, historyFrom });
  return policiesFromStreams(data, buildStreams(data));
};

describe("a found policy's renewal with more history than detection's twelve months", () => {
  it("knows no renewal when the payments run back to the window's start", () => {
    // Twelve monthly payments: all detection sees. The statements began two years ago.
    expect(found(monthly(12, 11_240, GEICO), monthsAgo(24))).toMatchObject([
      { carrier: "GEICO", premiumFrequency: "monthly", renewalDate: null },
    ]);
  });

  it("still dates a policy whose first payment comes well inside the window", () => {
    const windowFrom = tx({ ...GROCERIES, date: monthsAgo(11), amountCents: 4_000 });
    expect(found([windowFrom, ...monthly(6, 11_240, GEICO)], monthsAgo(24))).toMatchObject([
      { carrier: "GEICO", renewalDate: "2027-05-15" },
    ]);
  });
});
