import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));

import { formatProof, inputFor, type PersonProof } from "./proof";

// Spec step 266: the proof's write-up, one table for everyone and a section each.

const proof = (over: Partial<PersonProof>): PersonProof => ({
  person: { id: "renter", name: "Maya", label: "Young renter, first job" },
  topThree: ["employer_match", "card_interest", "balance_transfer"],
  offered: [
    {
      key: "investing:employer_match",
      headline: "Get your employer's full 401(k) match, earn $993 a year",
      confidence: "83% (1 retirement account in 12 months of data)",
      onList: true,
      mustNot: false,
      tools: [{ name: "retirement_plan", ok: true, ms: 3 }],
    },
  ],
  sameAsHarness: true,
  opening: ["Good morning!", "Here's what I'd do first, from looking at your money:"],
  leadsWithSuggestions: true,
  missed: [],
  wrong: [],
  questions: [
    { text: "am i saving enough", understood: true, answer: "By 67…" },
    { text: "wher shuld i start", understood: false, answer: "(for Claude)" },
    {
      text: "how many pslf payments",
      understood: true,
      answer: "I don't see a student loan",
      about: "debt:student_forgiveness",
      contradicts: true,
    },
  ],
  pass: true,
  problems: [],
  ...over,
});

describe("the proof on every person", () => {
  it("writes a summary row each and a section with what Jane brought and the chat", () => {
    const doc = formatProof(
      [proof({}), proof({ pass: false, problems: ["off-list suggestion x"] })],
      "2026-10-22",
    );
    expect(doc).toMatch(/^# Proof on every person \(spec step 266\)/);
    expect(doc).toContain(
      "| Maya | employer_match, card_interest, balance_transfer | 1 | yes | 2/3 | pass |",
    );
    expect(doc).toContain(
      "| Maya | employer_match, card_interest, balance_transfer | 1 | yes | 2/3 | FAIL |",
    );
    expect(doc).toContain("| retirement_plan 3 |");
    expect(doc).toContain("> Good morning!");
    expect(doc).toContain("| how many pslf payments | CONTRADICTS | I don't see a student loan |");
    expect(doc).toContain("| wher shuld i start | Claude | (for Claude) |");
    expect(doc).toContain("Problems: off-list suggestion x.");
  });

  it("keeps table cells whole", () => {
    const doc = formatProof(
      [
        proof({
          opening: ["a | b"],
          questions: [{ text: "x\ny", understood: true, answer: "1 | 2" }],
        }),
      ],
      "2026-10-22",
    );
    expect(doc).toContain("> a \\| b");
    expect(doc).toContain("| x y | yes | 1 \\| 2 |");
  });
});

// A card's tool that needs an input is asked about the card's own topic (the consolidation card
// asks loan_fit about "consolidation"); a tool with no required input is asked nothing.
describe("inputFor", () => {
  it("passes the card's topic to a required choice it is one of, and nothing else", () => {
    expect(inputFor("loan_fit", "consolidation")).toEqual({ need: "consolidation" });
    expect(inputFor("loan_fit", "employer_match")).toEqual({});
    expect(inputFor("subscriptions", "subscriptions")).toEqual({});
  });
});
