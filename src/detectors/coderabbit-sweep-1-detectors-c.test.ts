import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));

import { buildProfile, type ProfileInput } from "@/profile/build";
import { inputFor } from "@/profile/sample";
import { COVER_GAP_DETECTORS } from "./cover-gaps";
import { runDetectors } from "./index";
import { DEBT_DETECTORS } from "./debt";

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
