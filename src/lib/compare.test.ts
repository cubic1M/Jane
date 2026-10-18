import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ db: {} }));
vi.mock("@/lib/plaid/demo", () => ({ hasDemoBank: vi.fn() }));

import { currentFor } from "./compare";

const DIRECTORY = [{ key: "netflix", name: "Netflix", aliases: ["netflix com"], category: null }];

describe("what the person has now, from a finding", () => {
  it("reads a bill above the typical price", () => {
    expect(
      currentFor(
        {
          type: "bill_negotiation",
          evidence: { merchant: "Verizon Wireless", billKind: "phone", monthlyCents: 14_500 },
        },
        DIRECTORY,
      ),
    ).toEqual({
      kind: "bill",
      monthlyCents: 14_500,
      category: "phone",
      merchantKey: "verizon wireless",
    });
  });

  it("reads a subscription by its directory key, monthly or not", () => {
    expect(
      currentFor(
        {
          type: "price_increase",
          evidence: { merchant: "NETFLIX.COM", frequency: "MONTHLY", lastAmountCents: 1_799 },
        },
        DIRECTORY,
      ),
    ).toEqual({ kind: "bill", monthlyCents: 1_799, category: null, merchantKey: "netflix" });
    expect(
      currentFor(
        {
          type: "subscription_review",
          evidence: {
            merchant: "Duolingo",
            frequency: "QUARTERLY",
            lastAmountCents: 2_999,
            annualCostCents: 11_996,
          },
        },
        DIRECTORY,
      ),
    ).toMatchObject({ monthlyCents: 1_000 });
  });

  it("reads idle cash", () => {
    expect(
      currentFor(
        { type: "idle_cash", evidence: { excessCents: 1_500_000, assumedCurrentRateBps: 50 } },
        DIRECTORY,
      ),
    ).toEqual({ kind: "savings", amountCents: 1_500_000, currentRateBps: 50 });
  });

  it("never compares insurance, card interest or anything without the facts", () => {
    for (const type of [
      "insurance_reshop",
      "card_interest",
      "bank_fees",
      "duplicate_charge",
    ] as const) {
      expect(
        currentFor({ type, evidence: { merchant: "GEICO", monthlyCents: 14_200 } }, DIRECTORY),
      ).toBeNull();
    }
    expect(
      currentFor({ type: "bill_negotiation", evidence: { billKind: "phone" } }, DIRECTORY),
    ).toBeNull();
  });
});
