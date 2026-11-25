import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));

import { DETECTOR_RATES } from "@/config/detectors";
import { buildProfile, type ProfileInput } from "@/profile/build";
import { inputFor } from "@/profile/sample";
import { runDetectors } from "./index";

// CodeRabbit sweep 1c (det-05, 13 and 18): installments and payments are compared within one tax
// year, and a payment that came after its date is not the same as one that came on time.
const base = (today: string) => {
  const d = inputFor("freelancer");
  return {
    ...d,
    today,
    transactions: d.transactions.filter(
      (t) => t.pfc !== "GOVERNMENT_AND_NON_PROFIT_TAX_PAYMENT" && t.date <= today,
    ),
  };
};
// A quarter of the year's tax, as the detector works it out.
const quarter = (today: string) =>
  Math.round(
    (Number(buildProfile(base(today)).facts.monthly_income.value) *
      12 *
      DETECTOR_RATES.selfEmployedTaxRate) /
      4,
  );
const run = (
  today: string,
  pays: readonly { date: string; cents: number }[],
  firstSeen?: string,
) => {
  const d = base(today);
  const data: ProfileInput = {
    ...d,
    transactions: [
      ...d.transactions,
      ...(firstSeen
        ? [{ ...d.transactions[0], date: firstSeen, amountCents: 1_000, description: "COFFEE" }]
        : []),
      ...pays.map((p) => ({
        ...d.transactions[0],
        date: p.date,
        amountCents: p.cents,
        description: "IRS USATAXPYMT",
        pfc: "GOVERNMENT_AND_NON_PROFIT_TAX_PAYMENT",
      })),
    ],
  };
  return runDetectors({ profile: buildProfile(data), data }).find(
    (s) => s.topic === "estimated_taxes",
  );
};

describe("estimated payments within one tax year", () => {
  it("does not price last year's installments at this year's amount", () => {
    const q = quarter("2026-04-20");
    // Statements start in January 2025; last year's payments were small; April 2026 is paid in full.
    const s = run(
      "2026-04-20",
      [
        { date: "2025-04-15", cents: 1_000 },
        { date: "2025-06-16", cents: 1_000 },
        { date: "2026-04-15", cents: q },
      ],
      "2025-01-10",
    );
    expect(s).toBeUndefined();
  });

  it("still speaks up when this year's April installment is missing", () => {
    const s = run(
      "2026-04-20",
      [{ date: "2025-09-15", cents: quarter("2026-04-20") }],
      "2025-01-10",
    );
    expect(s).toBeDefined();
    expect(s?.short).toMatch(/Nobody withholds|about \$.* was due by now/);
    expect(s?.why).not.toMatch(/I see \$[\d,.]+ of tax payments this tax year/);
  });
});

describe("estimated payments that came after their dates", () => {
  const today = "2026-10-15";
  it("stays quiet when every installment was paid on its date", () => {
    const q = quarter(today);
    expect(
      run(today, [
        { date: "2026-04-15", cents: q },
        { date: "2026-06-15", cents: q },
        { date: "2026-09-15", cents: q },
      ]),
    ).toBeUndefined();
  });

  it("says the penalty for the days late when April and June were both paid on June 16", () => {
    const q = quarter(today);
    const s = run(today, [
      { date: "2026-06-16", cents: 2 * q },
      { date: "2026-09-15", cents: q },
    ]);
    expect(s).toBeDefined();
    expect(s?.short).toContain("caught up");
    expect(s?.why).toContain("after a due date");
    expect(s?.worthCents).toBeGreaterThanOrEqual(DETECTOR_RATES.tax.estimatedLateMinPenaltyCents);
    // The penalty is on the shortfall for its days, not the whole of it for a year.
    expect(s!.worthCents).toBeLessThan(
      Math.round(q * 0.9 * DETECTOR_RATES.underpaymentPenaltyRate),
    );
  });

  it("says nothing for a payment a day or two late, whose penalty is small", () => {
    const q = quarter(today);
    expect(
      run(today, [
        { date: "2026-04-16", cents: q },
        { date: "2026-06-15", cents: q },
        { date: "2026-09-15", cents: q },
      ]),
    ).toBeUndefined();
  });
});
