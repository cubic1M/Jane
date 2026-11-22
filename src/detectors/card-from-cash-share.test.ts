import { describe, expect, it } from "vitest";
import { buildProfile, type ProfileInput } from "@/profile/build";
import { formatCents } from "@/lib/money";
import { runDetectors } from "./index";
import { cashClearsCard, STUDENT_MONEY_DETECTORS } from "./student-money";
import { grad } from "./__fixtures__/students";

// The manager on #2224 (11-22): "Pay off your card from cash, save $554/yr" opened a report that
// counted the card's interest another way. The card says the report's yearly figure when there is
// one, rate or not; when cash clears only part of the card, the cleared share of it, and its why
// says which share of which figure.

const fire = (data: ProfileInput) =>
  runDetectors({ profile: buildProfile(data), data }, STUDENT_MONEY_DETECTORS).find(
    (s) => s.topic === "card_from_cash",
  ) ?? null;
const REPORT = 33_924;
const withReport = (data: ProfileInput): ProfileInput => ({
  ...data,
  findings: [{ type: "card_interest", annualSavingsCents: REPORT, confidence: "medium" }],
});
// Cash in checking set to what's kept back plus `clear`: what cash can then put to the card.
const cashFor = (data: ProfileInput, clear: number): ProfileInput => {
  const { keepCents } = cashClearsCard(data)!;
  const depository = data.accounts.filter((a) => a.type === "depository");
  return {
    ...data,
    accounts: data.accounts.map((a) =>
      a.type !== "depository"
        ? a
        : { ...a, balanceCents: a.id === depository[0].id ? keepCents + clear : 0 },
    ),
  };
};

describe("card interest paid off from cash, by the report's figure", () => {
  it("is the report's figure when cash clears the card, though the bank gives a rate", () => {
    const data = withReport(grad());
    expect(cashClearsCard(data)?.aprBps).not.toBeNull();
    const s = fire(data)!;
    expect(s.headline).toMatch(/^Pay off your card from cash/);
    expect(s.worthCents).toBe(REPORT);
    expect(s.why).toContain(`stops about ${formatCents(REPORT)} a year of interest;`);
  });

  it("is the cleared share of it when cash clears part, and says so", () => {
    const base = withReport(grad());
    const owed = cashClearsCard(base)!.owedCents;
    const data = cashFor(base, Math.round(owed / 2));
    const c = cashClearsCard(data)!;
    expect(c.clearCents).toBe(Math.round(owed / 2));
    // By hand: half the card, half the report's year: $339.24 / 2 = $169.62.
    const share = Math.round((REPORT * c.clearCents) / owed);
    expect(share).toBe(16_962);
    const s = fire(data)!;
    expect(s.headline).toMatch(/^Pay down your card from cash/);
    expect(s.worthCents).toBe(share);
    expect(s.why).toContain(
      `stops about ${formatCents(share)} a year of interest: that share of the ${formatCents(REPORT)} a year all ${formatCents(owed)} costs;`,
    );
  });
});
