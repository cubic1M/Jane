import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));

import { normalize } from "../intents";
import { parseInsurance } from "./intents";
import { keepCoveredReply, keptCoveredNote, reviewActions } from "./review-words";

// Spec step 202: asking for the review or "keep me covered", and the one message's buttons.

describe("review questions", () => {
  it.each(["keep me covered", "handle my insurance renewals"])("reads %s as keep_covered", (t) => {
    expect(parseInsurance(normalize(t))?.ask).toBe("keep_covered");
  });
  it.each(["show me my yearly insurance review", "my annual insurance review"])(
    "reads %s as the review",
    (t) => {
      expect(parseInsurance(normalize(t))?.ask).toBe("review");
    },
  );
});

describe("keepCoveredReply", () => {
  it("offers the one tap, and never acts by itself", () => {
    const reply = keepCoveredReply(
      {
        review: null,
        checkup: null,
        savings: [
          {
            id: "s1",
            policyId: "p1",
            kind: "autopay",
            status: "offered",
            yearlySavingCents: 4_000,
            currentYearlyCents: 100_000,
            newYearlyCents: 96_000,
            detail: {},
            confirmation: null,
          },
        ],
        negotiations: [],
      } as never,
      false,
    );
    expect(reply.body).toMatch(/Nothing happens until you tap/);
    expect(reply.actions[0]).toMatchObject({ id: "insurance.keep_covered", kind: "primary" });
  });

  it("says when there is nothing to do", () => {
    const reply = keepCoveredReply(
      { review: null, checkup: null, savings: [], negotiations: [] },
      false,
    );
    expect(reply.body).toMatch(/nothing to do right now/);
    expect(reply.actions.map((a) => a.id)).not.toContain("insurance.keep_covered");
  });
});

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
});
