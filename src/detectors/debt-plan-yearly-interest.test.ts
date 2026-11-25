import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));

import { buildProfile, type ProfileInput } from "@/profile/build";
import { inputFor } from "@/profile/sample";
import { runDetectors } from "./index";

// CodeRabbit sweep 1c, det-02 finding 3: the debt plan quoted every interest charge in the data as
// "a year": two years of charges read as one year's cost, and a few months' as a full year.
const sample = inputFor("debt");
const card = sample.accounts.find((a) => a.type === "credit")!;
const withInterest = (dates: string[]): ProfileInput => ({
  ...sample,
  extras: undefined,
  transactions: [
    ...sample.transactions.filter((t) => t.pfc !== "BANK_FEES_INTEREST_CHARGE"),
    ...dates.map((date, i) => ({
      id: `int${i}`,
      date,
      amountCents: 5_000,
      description: "INTEREST CHARGE",
      pfc: "BANK_FEES_INTEREST_CHARGE",
      accountId: card.id,
    })),
  ],
});
const plan = (data: ProfileInput) =>
  runDetectors({ profile: buildProfile(data), data }).find((s) => s.topic === "debt_plan");
const monthsBack = (n: number) => {
  const d = new Date(`${sample.today}T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() - n);
  return d.toISOString().slice(0, 10);
};

describe("the debt plan's yearly interest", () => {
  it("is a year of charges when the data holds two years of them", () => {
    const data = withInterest(Array.from({ length: 24 }, (_, i) => monthsBack(i)));
    const p = plan(data);
    expect(p).toBeDefined();
    // By hand: $50 a month is $600 a year, not the $1,200 all 24 charges add up to.
    expect(p!.worthCents).toBeLessThanOrEqual(65_000);
    expect(p!.worthCents).toBeGreaterThanOrEqual(55_000);
  });
});
