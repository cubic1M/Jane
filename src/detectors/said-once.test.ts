import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));

import { buildProfile, type ProfileInput } from "@/profile/build";
import { inputFor } from "@/profile/sample";
import { disabilityNeedFor, type NeedInput } from "@/lib/insurance/need";
import { runDetectors } from "./index";
import { SPENDING_DETECTORS } from "./spending";

// Debug 3, 11-19 (class 7, debug3-invariants.md): a card's why said a figure twice in one
// sentence. A trial that became one charge: "now costs $120.00 (…): $120.00." Disability cover
// with none on file: "A benefit of $3,050.10 a month, … until 65: $3,050.10 a month short."

const trial = (data: ProfileInput): ProfileInput => ({
  ...data,
  transactions: [
    ...data.transactions,
    {
      date: "2026-07-01",
      amountCents: 100,
      description: "SKILLHOUSE",
      pfc: "GENERAL_SERVICES_EDUCATION",
      accountId: "x",
    },
    {
      date: "2026-07-08",
      amountCents: 12_000,
      description: "SKILLHOUSE",
      pfc: "GENERAL_SERVICES_EDUCATION",
      accountId: "x",
    },
    // Billed again each month since: a trial turned billing needs a cadence (founder 11-28).
    ...["2026-08-08", "2026-09-08", "2026-10-08"].map((date) => ({
      date,
      amountCents: 12_000,
      description: "SKILLHOUSE",
      pfc: "GENERAL_SERVICES_EDUCATION",
      accountId: "x",
    })),
  ],
});

const need = (over: Partial<NeedInput> = {}): NeedInput => ({
  yearlyPayCents: 9_600_000,
  dependants: 2,
  mortgageCents: 30_000_000,
  otherDebtCents: 1_500_000,
  mortgageYearsLeft: 22,
  savingsCents: 3_000_000,
  cashCents: 1_000_000,
  netWorthCents: 20_000_000,
  workLifeCoverCents: 0,
  policies: [],
  ...over,
});

describe("a figure, said once", () => {
  it("in a trial that became one charge", () => {
    const data = trial(inputFor("freelancer"));
    const s = runDetectors({ profile: buildProfile(data), data }, SPENDING_DETECTORS).find(
      (x) => x.topic === "trial_conversion",
    )!;
    expect(s.why.match(/\$120\.00/g)).toHaveLength(1);
  });

  it("in disability cover with none on file", () => {
    const summary = disabilityNeedFor(need()).summary;
    expect(summary).toBe(
      "A benefit of $4,800.00 a month, after a 90-day wait, until 65, and none is on file.",
    );
  });
});
