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

  // Debugger 11-06: Capital One writes its annual fee "CAPITAL ONE MEMBER FEE". Beside one late
  // fee it was paced, "$135.00 in fees … could save about $270.00 a year".
  it("counts Capital One's member fee once, as an annual fee", () => {
    const [finding] = detect(
      input([
        fee("1", "2026-08-03", 9500, "CAPITAL ONE MEMBER FEE"),
        fee("2", "2026-09-28", 4000, "PAST DUE FEE"),
      ]),
    ).filter((c) => c.type === "bank_fees");
    expect(finding?.amountCents).toBe(13500);
    expect(finding?.annualSavingsCents).toBe(13500);
  });

  it("still paces a monthly member fee", () => {
    const [finding] = detect(
      input([
        fee("1", "2026-08-03", 500, "MONTHLY MEMBER FEE"),
        fee("2", "2026-09-03", 500, "MONTHLY MEMBER FEE"),
        fee("3", "2026-10-03", 500, "MONTHLY MEMBER FEE"),
      ]),
    ).filter((c) => c.type === "bank_fees");
    expect(finding?.annualSavingsCents).toBeGreaterThan(1500);
  });
});
