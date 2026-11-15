import { describe, expect, it } from "vitest";
import { buildStreams } from "@/detection/streams";
import type { DetectionInput, DetectionTransaction } from "@/detection/types";
import { newSubscriptions } from "./changes";

// Debugger 11-15: a student's Bank of America statement ran Aug 19 to Nov 13. Netflix bills on the
// 3rd, so its first charge in the file was Sep 3 and Jane said "Netflix is a new regular charge":
// the Aug 3 charge was before the statement began. A charge is new only when the data reaches a
// cycle before its first one.

const row = (id: string, date: string, amountCents: number, description: string) =>
  ({
    id,
    accountId: "chk",
    plaidTransactionId: null,
    date,
    amountCents,
    description,
    merchantName: null,
    pfcPrimary: description === "NETFLIX.COM" ? "ENTERTAINMENT" : "FOOD_AND_DRINK",
    pfcDetailed:
      description === "NETFLIX.COM" ? "ENTERTAINMENT_TV_AND_MOVIES" : "FOOD_AND_DRINK_FAST_FOOD",
    categorySource: "rule",
  }) satisfies DetectionTransaction;

const netflix = ["2026-09-03", "2026-10-03", "2026-11-03"].map((d, i) =>
  row(`n${i}`, d, 1549, "NETFLIX.COM"),
);

const changes = (dataStarts: string) => {
  const input: DetectionInput = {
    asOf: "2026-11-14",
    accounts: [
      {
        id: "chk",
        name: "Checking",
        type: "depository",
        subtype: "checking",
        currentBalanceCents: 0,
      },
    ],
    transactions: [row("first", dataStarts, 1120, "CHIPOTLE 1234"), ...netflix],
    recurringStreams: [],
  };
  return newSubscriptions(input, buildStreams(input));
};

describe("a new regular charge", () => {
  it("isn't called new when the data starts less than a cycle before its first charge", () => {
    expect(changes("2026-08-19")).toEqual([]);
  });

  it("is when the data reaches back far enough to show there was no charge before", () => {
    expect(changes("2026-07-20").map((c) => c.title)).toEqual([
      "Netflix is a new regular charge: $15.49, since Sep 3.",
    ]);
  });
});
