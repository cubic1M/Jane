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
    const by = Object.fromEntries(PEOPLE.map((p) => [p.id, topics(p.id).sort()]));
    // Card interest on a $1,940 balance (a 0% transfer would save more than its fee), 65% of her
    // card limit in use, and six Klarna installments.
    expect(by.renter).toEqual(["balance_transfer", "bnpl", "credit_building"]);
    // A GAP add-on bought with the car loan, and a teacher's $62,000 student loan.
    expect(by.family).toEqual(["car_addons", "student_forgiveness"]);
    // A $450 student loan payment against $4,538 a month of income.
    expect(by.freelancer).toEqual(["student_repayment"]);
    // 6.9% on $910,000 with $106,000 of cash: pay down or compare.
    expect(by.equity).toEqual(["mortgage_extra"]);
    // $2,400 sent to their son by Zelle and not sent back.
    expect(by.preretire).toEqual(["family_loans"]);
    // A $1,240 hospital bill.
    expect(by.retiree).toEqual(["medical_bills"]);
    // A cash advance, three cards at 96% of their limits, a collector, a car payment 16% of
    // income, and a transfer (approval isn't certain).
    expect(by.debt).toEqual([
      "auto_refinance",
      "balance_transfer",
      "cash_advance",
      "credit_building",
      "credit_report_errors",
    ]);
    // A card carried month to month at about 24% (the loans lane's signal for Jo).
    expect(by.owner).toEqual(["balance_transfer", "credit_building"]);
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

// The sample people carry the signal for every detector; these try the edges on made-up people.
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

// Spec step 260, the rest of the debt tools.
describe("card use, pay-later plans, medical bills, collections, forgiveness and money lent", () => {
  it("works out the pay-down that brings Chris's cards under 30% of their limits", () => {
    const s = fire("debt").find((x) => x.topic === "credit_building")!;
    // What getting under the line is usually worth: 1.5 points off the rate on $10,090 owed.
    expect(s.worthCents).toBe(Math.round(1_009_000 * 0.015));
    expect(s.worthKind).toBe("saves");
    expect(s.why).toContain("96%");
    // $3,150 would get him under 30%; he has $38.20, so it says to pay what he can.
    expect(s.why).toContain("would take $6,940.00, more than the $38.20 you have in cash");
    expect(s.action.href).toBe("/loans/credit");
  });

  it("is quiet about card use for those below 30%", () => {
    for (const id of ["family", "freelancer", "equity", "preretire", "retiree"]) {
      expect(topics(id), id).not.toContain("credit_building");
    }
  });

  it("counts Maya's Klarna installments, and needs at least three", () => {
    const s = fire("renter").find((x) => x.topic === "bnpl")!;
    expect(s.worthCents).toBe(6 * 3_750);
    const few = (d: ProfileInput): ProfileInput => ({
      ...d,
      transactions: d.transactions
        .filter((t) => t.pfc !== "LOAN_PAYMENTS_BNPL")
        .concat(
          tx("2026-09-01", 3_750, "KLARNA PAYMENT", "LOAN_PAYMENTS_BNPL", "x"),
          tx("2026-09-15", 3_750, "KLARNA PAYMENT", "LOAN_PAYMENTS_BNPL", "x"),
        ),
    });
    expect(topics("renter", few)).not.toContain("bnpl");
  });

  it("asks Ruth to question her hospital bill for about a fifth of it, and leaves pharmacies out", () => {
    const s = fire("retiree").find((x) => x.topic === "medical_bills")!;
    // Her care over the year, the $1,240 hospital bill among it.
    const care = inputFor("retiree")
      .transactions.filter(
        (t) =>
          (t.pfc ?? "").startsWith("MEDICAL_") &&
          t.pfc !== "MEDICAL_PHARMACIES_AND_SUPPLEMENTS" &&
          t.amountCents > 0,
      )
      .reduce((n, t) => n + t.amountCents, 0);
    expect(care).toBeGreaterThanOrEqual(124_000);
    expect(s.worthCents).toBe(Math.round(care * 0.2));
    const drugsOnly = (d: ProfileInput): ProfileInput => ({
      ...d,
      transactions: d.transactions
        .filter((t) => !(t.pfc ?? "").startsWith("MEDICAL_"))
        .concat(
          tx("2026-08-01", 90_000, "CVS PHARMACY", "MEDICAL_PHARMACIES_AND_SUPPLEMENTS", "x"),
        ),
    });
    expect(topics("retiree", drugsOnly)).not.toContain("medical_bills");
  });

  it("raises the collection for Chris, now, and for no one who pays none", () => {
    const s = fire("debt").find((x) => x.topic === "credit_report_errors")!;
    expect(s.urgency).toBe("now");
    expect(s.worthCents).toBe(12 * 8_500);
    for (const id of ["renter", "family", "retiree", "owner"]) {
      expect(topics(id), id).not.toContain("credit_report_errors");
    }
  });

  it("finds Public Service Loan Forgiveness for the Reyes: a school employer and a student loan", () => {
    const s = fire("family").find((x) => x.topic === "student_forgiveness")!;
    // $62,000 less 120 payments of $450.
    expect(s.worthCents).toBe(6_200_000 - 120 * 45_000);
    expect(s.confidence.percent).toBeLessThanOrEqual(75);
    expect(s.why).toContain("You work for Springfield Schools");
    // Not for a private employer, even with the same loan.
    expect(
      topics("family", (d) => ({ ...d, told: { ...d.told, employer: "ACME CORP" } })),
    ).not.toContain("student_forgiveness");
  });

  it("notes the money Dan and Lena sent their son, and goes quiet once some comes back", () => {
    const s = fire("preretire").find((x) => x.topic === "family_loans")!;
    expect(s.worthCents).toBe(60_000);
    expect(s.confidence.percent).toBeLessThanOrEqual(75);
    expect(
      topics("preretire", (d) => ({
        ...d,
        transactions: [
          ...d.transactions,
          tx("2026-09-20", -20_000, "ZELLE FROM DANIEL", "TRANSFER_IN_ACCOUNT_TRANSFER", "x"),
        ],
      })),
    ).not.toContain("family_loans");
  });
});
