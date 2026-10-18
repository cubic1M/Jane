import { describe, expect, it } from "vitest";
import { SECRET_STRINGS, findingOfType, sampleFindings } from "./__fixtures__/findings";
import { inputHash, prepareExplainInput } from "./explain-input";

describe("prepareExplainInput", () => {
  it("covers every finding type", () => {
    expect(new Set(sampleFindings().map((f) => f.type))).toEqual(
      new Set([
        "subscription_review",
        "duplicate_subscription",
        "price_increase",
        "bank_fees",
        "idle_cash",
        "insurance_reshop",
        "card_interest",
        "low_balance_risk",
      ]),
    );
  });

  it.each(sampleFindings().map((f) => [f.type, f] as const))(
    "sends no personal identifiers for %s",
    (_type, finding) => {
      const payload = JSON.stringify(prepareExplainInput(finding).input);

      for (const secret of SECRET_STRINGS) expect(payload).not.toContain(secret);
      expect(payload).not.toMatch(/@/);
      expect(payload).not.toMatch(/description|accountId|accountName|"id"/);
    },
  );

  it("sends merchant, amounts, dates and the savings estimate", () => {
    const { input, allowedCents } = prepareExplainInput(findingOfType("price_increase"));

    expect(input).toMatchObject({
      findingType: "price_increase",
      savingsPerYear: "$30.00",
      facts: {
        merchant: "Netflix",
        billed: "monthly",
        latestCharge: "$17.99",
        previousPrice: "$15.49",
        increasePerCharge: "$2.50",
      },
    });
    expect(input.charges.at(-1)).toEqual({ date: "2026-10-15", amount: "$17.99" });
    expect(allowedCents).toEqual(expect.arrayContaining([3000, 1799, 1549, 250]));
  });

  it("names fee kinds without the bank's description", () => {
    const { input } = prepareExplainInput(findingOfType("bank_fees"));

    expect(input.facts).toEqual({ account: "bank account", totalLast12Months: "$69.00" });
    expect(input.charges.map((c) => c.kind)).toEqual(["overdraft fee", "overdraft fee"]);
  });

  it("gives the same hash for the same input and a new one when evidence changes", () => {
    const finding = findingOfType("subscription_review");
    const hash = inputHash(prepareExplainInput(finding).input, "v1");

    expect(inputHash(prepareExplainInput(finding).input, "v1")).toBe(hash);
    expect(inputHash(prepareExplainInput(finding).input, "v2")).not.toBe(hash);
    const changed = { ...finding, annualSavingsCents: (finding.annualSavingsCents ?? 0) + 1 };
    expect(inputHash(prepareExplainInput(changed).input, "v1")).not.toBe(hash);
  });
});
