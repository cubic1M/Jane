import { describe, expect, it } from "vitest";
import { keptCoveredNote, reviewActions, reviewBody, reviewCents } from "./review-words";

// Spec step 202: the yearly review's one message: its buttons, and what "Keep me covered" says
// it did. Typed questions about it are Claude's, from the insurance_review tool.

describe("keptCoveredNote and reviewActions", () => {
  it("says what was done and that the cover stays", () => {
    expect(keptCoveredNote({ savings: 2, calls: 1, yearlySavingCents: 14_000 })).toBe(
      "Done. I made 2 changes to pay less for the same cover, about $140.00 a year, and I called your insurer about a renewal. Your cover stays as it was.",
    );
  });

  it("ends the review's buttons with Got it", () => {
    const actions = reviewActions({
      level: "ask",
      did: [],
      savedYearlyCents: 0,
      savings: [],
      calls: 0,
      risks: 1,
      coverChanges: 0,
      gaps: 0,
      recommendations: [],
      claimDrafts: 0,
      health: null,
    });
    expect(actions.map((a) => a.id)).toEqual(["open", "insurance.checkup_seen"]);
  });

  // Spec step 280: a gap a life event opened is in the review, with the reason and its options.
  it("names a gap a life event opened, with See options for it", () => {
    const review = {
      level: "ask",
      did: [],
      savedYearlyCents: 0,
      savings: [],
      calls: 0,
      risks: 0,
      coverChanges: 0,
      gaps: 0,
      recommendations: [],
      claimDrafts: 0,
      health: null,
      opened: [
        {
          kind: "auto_liability",
          policyId: "p1",
          because: "the new car",
          summary:
            "Injury liability of $100,000.00 per person and $300,000.00 per accident; yours is $50,000.00 and $100,000.00.",
          cents: [30_000_000, 10_000_000, 20_000_000],
        },
      ],
    };
    expect(reviewBody(review)).toContain(
      "- because of the new car: Injury liability of $100,000.00 per person",
    );
    expect(reviewActions(review)).toContainEqual({
      id: "open",
      label: "See options",
      kind: "link",
      href: "/insurance?need=auto_liability&policy=p1#options",
    });
    expect(reviewCents(review)).toEqual(expect.arrayContaining([30_000_000, 20_000_000]));
    // Two gaps from one event are one line and one button; two events name theirs.
    const deductible = {
      kind: "deductible",
      policyId: "p1",
      because: "the new car",
      summary: "Your cash carries a $2,000.00 deductible.",
      cents: [200_000],
    };
    const job = { ...review.opened[0], kind: "disability", because: "the new job" };
    const both = { ...review, opened: [...review.opened, deductible, job] };
    const labels = reviewActions(both).map((a) => a.label);
    expect(labels.filter((l) => l.startsWith("See options"))).toEqual([
      "See options: the new car",
      "See options: the new job",
    ]);
    expect(reviewBody(both)).toMatch(
      /because of the new car: Injury liability[^\n]*; Your cash carries/,
    );
  });
});
