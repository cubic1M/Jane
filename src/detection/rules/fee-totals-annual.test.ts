import { describe, expect, it } from "vitest";
import { detect } from "../detect";
import type { DetectionInput, DetectionTransaction } from "../types";

// A card's annual fee counts once, and only what's left is paced. A refund bigger than the rest
// used to leave that negative: $95 + $5 + $5 less $60 back read as about -$105 a year.
const fee = (id: string, date: string, amountCents: number, description: string) =>
  ({
    id,
    accountId: "card",
    plaidTransactionId: null,
    date,
    amountCents,
    description,
    merchantName: null,
    pfcPrimary: "BANK_FEES",
    pfcDetailed: "BANK_FEES_OTHER_BANK_FEES",
    categorySource: "rule",
  }) satisfies DetectionTransaction;

const input = (transactions: DetectionTransaction[]): DetectionInput => ({
  asOf: "2026-10-30",
  historyFrom: "2026-08-01",
  accounts: [
    { id: "card", name: "Card", type: "credit", subtype: "credit card", currentBalanceCents: 0 },
  ],
  transactions,
  recurringStreams: [],
});

describe("a fee finding with an annual fee and a refund", () => {
  it("is never a negative saving", () => {
    const [finding] = detect(
      input([
        fee("1", "2026-09-01", 9500, "ANNUAL MEMBERSHIP FEE"),
        fee("2", "2026-09-05", 500, "LATE FEE"),
        fee("3", "2026-09-10", 500, "LATE FEE"),
        fee("4", "2026-09-20", -6000, "FEE REFUND"),
      ]),
    ).filter((c) => c.type === "bank_fees");
    expect(finding?.amountCents).toBe(4500);
    expect(finding?.annualSavingsCents).toBe(4500);
  });

  it("still paces the fees beyond the annual fee", () => {
    const [finding] = detect(
      input([
        fee("1", "2026-09-01", 9500, "ANNUAL MEMBERSHIP FEE"),
        fee("2", "2026-09-05", 500, "LATE FEE"),
        fee("3", "2026-10-05", 500, "LATE FEE"),
      ]),
    ).filter((c) => c.type === "bank_fees");
    expect(finding?.amountCents).toBe(10500);
    expect(finding?.annualSavingsCents).toBe(9500 + 1000 * 4);
  });
});
