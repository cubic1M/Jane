import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));

import { PEOPLE } from "@/config/people";
import { buildProfile, type ProfileInput } from "@/profile/build";
import { inputFor } from "@/profile/sample";
import { DEBT_DETECTORS } from "./debt";
import { runDetectors } from "./index";

// Spec step 260: debt and credit detectors, on the eight sample people and on made-up people
// where the sample people have none of the signal. Each says who it applies to, the dollars a
// year, a confidence percentage with its reason, the urgency, why this person and the action.

const fire = (id: string, change: (d: ProfileInput) => ProfileInput = (d) => d) => {
  const data = change(inputFor(id));
  return runDetectors({ profile: buildProfile(data), data }, DEBT_DETECTORS);
};
const topics = (id: string, change?: (d: ProfileInput) => ProfileInput) =>
  fire(id, change).map((s) => s.topic);

const tx = (
  date: string,
  amountCents: number,
  description: string,
  pfc: string,
  accountId: string,
) => ({
  date,
  amountCents,
  description,
  pfc,
  accountId,
});

describe("on the eight sample people", () => {
  it("fires only for the people the signal is in", () => {
    const by = Object.fromEntries(PEOPLE.map((p) => [p.id, topics(p.id)]));
    // Card interest on a $1,940 balance: a 0% transfer would save more than its fee.
    expect(by.renter).toEqual(["balance_transfer"]);
    // 6.9% on $910,000 with $106,000 of cash: pay down or compare.
    expect(by.equity).toEqual(["mortgage_extra"]);
    // Three cards at 74%: approval isn't certain. And a car payment 16% of income.
    expect(by.debt.sort()).toEqual(["auto_refinance", "balance_transfer"]);
    // Everyone else has no card interest, a cheap mortgage or no loan to speak of.
    for (const id of ["family", "freelancer", "preretire", "retiree", "owner"]) {
      expect(by[id], id).toEqual([]);
    }
  });

  it("gives each its dollars, a percentage with the reason, an urgency, why and the button", () => {
    for (const p of PEOPLE) {
      for (const s of fire(p.id)) {
        expect(s.worthCents, s.id).toBeGreaterThan(0);
        expect(s.confidence.percent, s.id).toBeGreaterThan(0);
        expect(s.confidence.reason.length, s.id).toBeGreaterThan(3);
        expect(["now", "soon", "later"]).toContain(s.urgency);
        expect(s.why, s.id).toMatch(/\$/);
        expect(s.action.href, s.id).toMatch(/^\/loans/);
      }
    }
  });

  it("is less sure about a transfer for someone in debt trouble, where approval isn't certain", () => {
    const chris = fire("debt").find((s) => s.topic === "balance_transfer")!;
    const maya = fire("renter").find((s) => s.topic === "balance_transfer")!;
    expect(chris.confidence.percent).toBeLessThan(maya.confidence.percent);
    expect(chris.confidence.percent).toBeLessThanOrEqual(75);
    expect(chris.confidence.reason).toContain("approval");
  });

  it("figures the transfer's saving as interest less the fee, from the person's own numbers", () => {
    const maya = fire("renter").find((s) => s.topic === "balance_transfer")!;
    // $556.80 of interest less 3% of a $1,940.20 balance.
    expect(maya.worthCents).toBe(55_680 - Math.round(194_020 * 0.03));
    expect(maya.why).toContain("$1,940.20");
    expect(maya.why).toContain("$556.80");
  });
});

describe("a student loan", () => {
  const withStudent =
    (monthly: number, income: number) =>
    (d: ProfileInput): ProfileInput => ({
      ...d,
      transactions: [
        ...d.transactions.filter((t) => t.pfc !== "LOAN_PAYMENTS_STUDENT_LOAN_PAYMENT"),
        ...Array.from({ length: 12 }, (_, i) =>
          tx(
            `2026-${String((i % 9) + 1).padStart(2, "0")}-05`,
            monthly,
            "STUDENT LOAN",
            "LOAN_PAYMENTS_STUDENT_LOAN_PAYMENT",
            "x",
          ),
        ),
      ],
      told: { ...d.told, monthly_income: income },
    });
  it("is worth comparing when the payment is well above an income-driven plan's", () => {
    const s = fire("renter", withStudent(60_000, 328_000)).find(
      (x) => x.topic === "student_repayment",
    )!;
    expect(s).toBeDefined();
    // 7% of $3,280 is about $230 a month against $600.
    expect(s.worthCents).toBe((60_000 - Math.round(328_000 * 0.07)) * 12);
    expect(s.confidence.reason).toContain("student loan payments");
    expect(s.action.href).toBe("/loans/student");
  });
  it("is not raised for Maya, whose $160 payment is already under the estimate", () => {
    expect(topics("renter")).not.toContain("student_repayment");
  });
  it("is not raised without a student loan", () => {
    expect(topics("retiree", withStudent(60_000, 452_000))).not.toContain("student_repayment");
  });
});

describe("dealer add-ons and cash advances", () => {
  it("find a GAP payment on a car loan and estimate the refund by the car loan page's rules", () => {
    const s = fire("debt", (d) => ({
      ...d,
      transactions: [
        ...d.transactions,
        tx(
          "2025-12-18",
          69_500,
          "DEALER GAP INSURANCE",
          "GENERAL_MERCHANDISE_OTHER_GENERAL_MERCHANDISE",
          "x",
        ),
      ],
    })).find((x) => x.topic === "car_addons")!;
    expect(s).toBeDefined();
    // A 72-month term, 9 whole months used, 63 left of $695.00, less $50.
    expect(s.worthCents).toBe(Math.round((69_500 * 63) / 72) - 5_000);
    expect(s.worthKind).toBe("earns");
    expect(s.confidence.percent).toBeLessThanOrEqual(75);
    expect(s.action.href).toBe("/loans/auto");
  });
  it("don't fire without a car loan", () => {
    expect(
      topics("renter", (d) => ({
        ...d,
        transactions: [
          ...d.transactions,
          tx("2025-12-18", 69_500, "DEALER GAP INSURANCE", "X", "x"),
        ],
      })),
    ).not.toContain("car_addons");
  });
  it("find a cash advance on a card, with the fee and interest from day one", () => {
    const card = inputFor("renter").accounts.find((a) => a.subtype === "credit card")!.id;
    const s = fire("renter", (d) => ({
      ...d,
      transactions: [
        ...d.transactions,
        tx("2026-09-05", 20_000, "ATM CASH ADVANCE", "TRANSFER_OUT_WITHDRAWAL", card),
        tx("2026-09-05", 1_000, "CASH ADVANCE FEE", "BANK_FEES_CASH_ADVANCE", card),
      ],
    })).find((x) => x.topic === "cash_advance")!;
    expect(s).toBeDefined();
    // $10 fee plus 29.99% for 30 days on $200.
    expect(s.worthCents).toBe(1_493);
    expect(s.urgency).toBe("soon");
  });
});
