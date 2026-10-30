import { describe, expect, it } from "vitest";
import { CHECKUP_MIN_HISTORY_DAYS, CHECKUP_MIN_RECURRING_DAYS } from "@/config/detection";
import {
  AS_OF,
  CARD,
  CHECKING,
  GROCERIES,
  SAVINGS,
  input,
  sampleYear,
  tx,
} from "./__fixtures__/build";
import { CHECKS, checkup, spanOf, type CheckLine } from "./checkup";
import { detect } from "./detect";
import { addDays } from "./units";

// A person who manages well: groceries on the card every week for six months, some at the
// pharmacy, nothing recurring, no fees, cash a little under three months of spending.
function doingWell(days = 182) {
  const transactions = [];
  for (let back = days - 1; back >= 0; back -= 7) {
    const date = addDays(AS_OF, -back);
    transactions.push(
      tx({ ...GROCERIES, accountId: CARD.id, date, amountCents: 30_000 + (back % 5) * 1_137 }),
    );
  }
  return input({
    accounts: [
      { ...CHECKING, currentBalanceCents: 300_000 },
      { ...SAVINGS, currentBalanceCents: 200_000 },
      CARD,
    ],
    transactions,
  });
}

const byType = (lines: CheckLine[]) => new Map(lines.map((l) => [l.type, l]));

describe("checkup", () => {
  it("says what each check found on a year with fees, interest and subscriptions", () => {
    const lines = checkup(sampleYear());
    const found = lines.filter((l) => l.status === "found").map((l) => l.type);

    expect(found).toEqual(
      expect.arrayContaining(["bank_fees", "card_interest", "subscription_review"]),
    );
    const fees = byType(lines).get("bank_fees")!;
    expect(fees.line).toBe("1 found");
    expect(fees.detail).toContain("$34.00 in fees on Everyday Checking");
    // Found first, then passed, then short of data.
    const order = lines.map((l) => ["found", "passed", "not_enough_data"].indexOf(l.status));
    expect(order).toEqual([...order].sort((a, b) => a - b));
  });

  it("lists a found line for every rule that finds something, never a passed one", () => {
    const input = sampleYear();
    const lines = byType(checkup(input));
    for (const c of detect(input)) expect(lines.get(c.type)?.status).toBe("found");
  });

  it("passes the checks with evidence, with the numbers, for someone doing well", () => {
    const lines = byType(checkup(doingWell()));

    expect(lines.get("bank_fees")).toMatchObject({ status: "passed", line: "None in 6 months" });
    expect(lines.get("card_interest")).toMatchObject({
      status: "passed",
      line: "None in 6 months",
      detail: "Jane checked 1 card for interest charges.",
    });
    expect(lines.get("subscription_review")).toMatchObject({ status: "passed" });
    expect(lines.get("duplicate_charge")).toMatchObject({ status: "passed" });
    expect(lines.get("trial_conversion")).toMatchObject({ line: "None in 60 days" });
    expect(lines.get("idle_cash")).toMatchObject({ status: "passed" });
    expect(lines.get("idle_cash")!.line).toBe("$5,000 cash, under 3 months of spending");
    expect(lines.get("low_balance_risk")).toMatchObject({
      status: "passed",
      line: "Lowest $3,000 in 31 days",
    });
  });

  it("says not enough data, not passed, where there's nothing to judge by", () => {
    const lines = byType(checkup(doingWell()));

    expect(lines.get("insurance_reshop")).toMatchObject({
      status: "not_enough_data",
      line: "Not enough data yet",
      detail: "No insurance bill in your statements yet.",
    });
    expect(lines.get("bill_negotiation")?.status).toBe("not_enough_data");
    expect(lines.get("price_increase")?.status).toBe("not_enough_data");
  });

  it("claims nothing passed on a few weeks of statements", () => {
    const lines = checkup(doingWell(CHECKUP_MIN_HISTORY_DAYS - 10));

    expect(lines.filter((l) => l.status === "passed")).toEqual([]);
    expect(byType(lines).get("bank_fees")?.detail).toBe(
      `Jane has 19 days of statements; this check needs ${CHECKUP_MIN_HISTORY_DAYS}.`,
    );
  });

  it("holds the recurring checks to two months of statements", () => {
    const lines = byType(checkup(doingWell(CHECKUP_MIN_RECURRING_DAYS - 15)));

    expect(lines.get("bank_fees")?.status).toBe("passed");
    expect(lines.get("subscription_review")?.status).toBe("not_enough_data");
    expect(lines.get("low_balance_risk")?.status).toBe("not_enough_data");
  });

  it("says found when an open finding is listed above, even if the rule finds none today", () => {
    const line = byType(checkup(doingWell(), { bank_fees: 1 })).get("bank_fees");

    expect(line).toMatchObject({ status: "found", line: "1 found", detail: "Listed above." });
  });

  it("leaves off checks with nothing to look at, and shows them once there is", () => {
    expect(byType(checkup(doingWell())).has("charge_after_cancel")).toBe(false);

    const withCancel = doingWell();
    withCancel.cancelledMerchants = [{ merchantKey: "streamco", cancelledOn: "2026-08-01" }];
    expect(byType(checkup(withCancel)).get("charge_after_cancel")).toMatchObject({
      status: "passed",
      line: "None after 1 cancellation",
    });
  });

  it("names a refunded fee as refunded, not as none", () => {
    const person = doingWell();
    person.transactions.push(
      tx({
        date: "2026-09-02",
        amountCents: 3400,
        description: "OVERDRAFT FEE",
        pfcPrimary: "BANK_FEES",
        pfcDetailed: "BANK_FEES_OVERDRAFT_FEES",
      }),
      tx({
        date: "2026-09-05",
        amountCents: -3400,
        description: "OVERDRAFT FEE REVERSAL",
        pfcPrimary: "BANK_FEES",
        pfcDetailed: "BANK_FEES_OVERDRAFT_FEES",
      }),
    );
    expect(byType(checkup(person)).get("bank_fees")?.line).toBe("Refunded in full in 6 months");
  });

  it("has a line for every finding type", () => {
    expect(Object.keys(CHECKS).sort()).toEqual(
      [
        "bank_fees",
        "bill_negotiation",
        "card_interest",
        "charge_after_cancel",
        "covered_by_card",
        "duplicate_charge",
        "duplicate_subscription",
        "idle_cash",
        "insurance_reshop",
        "low_balance_risk",
        "price_increase",
        "subscription_review",
        "trial_conversion",
      ].sort(),
    );
  });
});

describe("spanOf", () => {
  it("says days under two months, months after", () => {
    expect(spanOf(1)).toBe("1 day");
    expect(spanOf(45)).toBe("45 days");
    expect(spanOf(91)).toBe("3 months");
    expect(spanOf(365)).toBe("12 months");
  });
});
