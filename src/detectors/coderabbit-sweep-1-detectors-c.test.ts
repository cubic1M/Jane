import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));

import { buildProfile, type ProfileInput } from "@/profile/build";
import { inputFor } from "@/profile/sample";
import { COVER_GAP_DETECTORS } from "./cover-gaps";
import { runDetectors } from "./index";
import { DEBT_DETECTORS } from "./debt";
import { LIFE_DETECTORS } from "./life";
import { cushionOf } from "./money";
import { emergencyTarget } from "@/planning/emergency-fund";
import { cardPaymentCents, fitPersonFrom } from "@/planning/fit-person";

// CodeRabbit sweep, part 1 (money figures), src/detectors chunk 1: each case is a finding
// reproduced against the code first (failing), then fixed.

const topic = (data: ProfileInput, detectors: Parameters<typeof runDetectors>[1], name: string) =>
  runDetectors({ profile: buildProfile(data), data }, detectors).find((s) => s.topic === name) ??
  null;

describe("disability cover that pays something", () => {
  it("says what the policy pays, not that there is none", () => {
    const d = inputFor("freelancer");
    const data = {
      ...d,
      extras: {
        ...d.extras!,
        coverPolicies: [
          {
            id: "dis",
            kind: "disability",
            status: "active",
            deductibleCents: null,
            coverage: { monthlyBenefit: 100_000 },
          },
        ],
      },
    } as ProfileInput;
    const s = topic(data, COVER_GAP_DETECTORS, "disability_insurance")!;
    expect(s).not.toBeNull();
    expect(s.short).toMatch(/only \$1,000\.00 a month of disability cover on file/);
    expect(s.why).not.toMatch(/I see no disability policy/);
  });
  it("still says none when none is on file", () => {
    const s = topic(inputFor("freelancer"), COVER_GAP_DETECTORS, "disability_insurance")!;
    expect(s.short).toMatch(/no disability cover on file/);
  });
});

describe("a deductible above what cash comfortably carries", () => {
  it("doesn't say the cash can't pay it when the cash covers it", () => {
    const d = inputFor("family");
    let first = true;
    const data = {
      ...d,
      // $20,000 in cash, a $10,000 deductible: more than the cash comfortably carries, but payable.
      accounts: d.accounts.map((a) => {
        if (a.type !== "depository") return a;
        const balanceCents = first ? 2_000_000 : 0;
        first = false;
        return { ...a, balanceCents };
      }),
      extras: {
        ...d.extras!,
        coverPolicies: [
          {
            id: "auto",
            kind: "auto",
            status: "active",
            deductibleCents: 1_000_000,
            coverage: {
              bodilyInjuryPerPerson: 5_000_000,
              bodilyInjuryPerAccident: 10_000_000,
              collision: true,
            },
          },
        ],
      },
    } as ProfileInput;
    const s = topic(data, COVER_GAP_DETECTORS, "deductible_fit")!;
    expect(s.short).toMatch(/more than your cash comfortably carries/);
    expect(s.short).not.toMatch(/could pay from cash/);
    expect(s.why).not.toMatch(/short of what the deductible needs/);
  });
});

describe("a balance transfer's interest is a card's", () => {
  it("leaves out an interest-charge debit on a bank account", () => {
    const d = inputFor("renter");
    const checking = d.accounts.find((a) => a.type === "depository")!;
    const stray = {
      date: "2026-09-10",
      amountCents: 40_000,
      description: "INTEREST CHARGE ON LINE",
      pfc: "BANK_FEES_INTEREST_CHARGE",
      accountId: checking.id,
    };
    const base = topic(d, DEBT_DETECTORS, "balance_transfer")!;
    const more = topic(
      { ...d, transactions: [...d.transactions, stray] },
      DEBT_DETECTORS,
      "balance_transfer",
    )!;
    expect(more.worthCents).toBe(base.worthCents);
  });
});

describe("a pension reserve needs the income it is a gap against", () => {
  const base = { spendingCents: 300_000, pattern: "pension", debtTrouble: false };
  it("is sized like anyone's when income is unknown, not as a $0-income gap", () => {
    expect(emergencyTarget({ ...base, incomeCents: null })?.kind).toBe("months");
    expect(emergencyTarget({ ...base, incomeCents: 200_000 })?.kind).toBe("gap");
    // A measured zero is a measurement.
    expect(emergencyTarget({ ...base, incomeCents: 0 })?.kind).toBe("gap");
  });
});

describe("the cushion's cash total", () => {
  it("is not claimed when a bank account's balance isn't on file", () => {
    const d = inputFor("debt");
    const profile = buildProfile(d);
    const before = cushionOf({ profile, data: d });
    const checking = d.accounts.find((a) => a.type === "depository")!;
    const unknown = {
      ...d,
      accounts: [
        ...d.accounts,
        { ...checking, id: "x-unknown", balanceCents: 0, balanceKnown: false },
      ],
    };
    expect(before).not.toBeNull();
    expect(cushionOf({ profile: buildProfile(unknown), data: unknown })).toBeNull();
  });
});

describe("a paycheck that stopped, with income not known", () => {
  it("says it stopped without calling what comes in now $0", () => {
    const sample = inputFor("renter");
    const accountId = sample.accounts.find((a) => a.type === "depository")!.id;
    const days: string[] = [];
    for (
      let t = Date.parse("2026-02-06T00:00:00Z");
      t <= Date.parse("2026-08-07T00:00:00Z");
      t += 14 * 86_400_000
    )
      days.push(new Date(t).toISOString().slice(0, 10));
    const data = {
      ...sample,
      today: "2026-11-02",
      transactions: [
        ...days.map((date, i) => ({
          id: `p${i}`,
          date,
          amountCents: -264_018,
          description: "ACME LOGISTICS INC PAYROLL",
          pfc: "INCOME_SALARY",
          accountId,
        })),
        // Spending through to the end of October: the account is seen well past the last paycheck.
        ...Array.from({ length: 38 }, (_, i) => ({
          id: `s${i}`,
          date: new Date(Date.parse("2026-02-01T00:00:00Z") + i * 7 * 86_400_000)
            .toISOString()
            .slice(0, 10),
          amountCents: 5_000,
          description: "SAFEWAY",
          pfc: "FOOD_AND_DRINK_GROCERIES",
          accountId,
        })),
      ],
    };
    const profile = buildProfile(data);
    const unknownIncome = {
      ...profile,
      facts: {
        ...profile.facts,
        monthly_income: { ...profile.facts.monthly_income, value: null },
      },
    };
    const s = LIFE_DETECTORS.find((d) => d.topic === "pay_stopped")!.detect({
      profile: unknownIncome,
      data,
    })!;
    expect(s.why).not.toMatch(/\$0\.00 a month is coming in/);
    expect(s.short).not.toMatch(/\$0\.00/);
    expect(s.worthCents).toBe(0);
  });
});

describe("consolidation counts a card's payment once, from one source", () => {
  it("a reported $0 minimum is no figure: the keep cost is a real payment", () => {
    expect(cardPaymentCents(500_000, 0)).toBe(Math.round(500_000 * 0.03));
    expect(cardPaymentCents(500_000, 40_000)).toBe(40_000);
    expect(cardPaymentCents(500_000, null)).toBe(Math.round(500_000 * 0.03));
  });
  it("the person's debt payments count the same card amount the baseline takes off", () => {
    const d = inputFor("debt");
    const card = d.accounts.find((a) => a.type === "credit" && a.balanceCents > 0)!;
    const withMin = {
      ...d,
      liabilities: [
        ...d.liabilities.filter((l) => l.accountId !== card.id),
        {
          accountId: card.id,
          kind: "credit",
          aprBps: 2_400,
          hasPmi: null,
          payoffDate: null,
          minimumCents: 40_000,
        },
      ],
    };
    const noMin = {
      ...withMin,
      liabilities: withMin.liabilities.map((l) =>
        l.accountId === card.id ? { ...l, minimumCents: null } : l,
      ),
    };
    // The reported $400 replaces the 3% estimate of this card in the person's debt payments.
    const diff = fitPersonFrom(withMin).debtPaymentsCents - fitPersonFrom(noMin).debtPaymentsCents;
    expect(diff).toBe(40_000 - cardPaymentCents(card.balanceCents, null));
  });
});
