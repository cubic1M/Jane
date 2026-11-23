import { describe, expect, it } from "vitest";
import { flaggedStrings, type Gate } from "./act-gating";

// Manager 11-23: every string the backup chat or a card can say that tells the person to act
// (tellsThemToAct) must be shown not to reach a person with a real account, from the code around it
// (./act-gating.ts): an advice-only card topic, a card's text that forRealAccount drops, the advice
// side of an advice-mode check, a reply labelled demo advice, or a helper only those use. A new
// directive string with none of these fails here.
//
// AWAITING are the ones the code doesn't gate, each kept until the manager decides its wording
// (the PR lists where each shows and the wording proposed). One that leaves this list, by a reword
// or a gate, is taken off it here too: the test fails while it's still listed.
const AWAITING: readonly [string, string][] = [
  ["src/detectors/insurance.ts", "Add or compare car cover"],
  ["src/lib/jane-agent/actions/found-policies.ts", "Confirmed. Your "],
  ["src/lib/jane-agent/insurance/saving-words.ts", "Put your car and your "],
  // Only reviewReply shows these, and it returns early outside advice mode (investments/replies.ts),
  // through a loaded object the rule doesn't follow.
  ["src/lib/jane-agent/investments/review-copy.ts", "Put the room in my IRA"],
  ["src/lib/jane-agent/investments/review-copy.ts", "Roll over the old 401(k)"],
  ["src/lib/jane-agent/priorities.ts", "Refinance "],
  ["src/lib/jane-agent/refinance-replies.ts", "You don't have a loan application."],
  ["src/lib/jane-agent/refinance-replies.ts", "Refinance offers come from a lending partner"],
  ["src/lib/jane-agent/replies-savemore.ts", "Put towards your "],
  ["src/lib/jane-agent/tax-replies.ts", "You can put "],
  ["src/lib/jane-agent/tax-states-message.ts", "Do you live in "],
];

describe("strings that tell the person to act", () => {
  const flagged = flaggedStrings();
  const awaiting = (f: { file: string; text: string }) =>
    AWAITING.some(([file, start]) => f.file === file && f.text.startsWith(start));

  it("are found across the backup's replies and the cards", () => {
    expect(flagged.length).toBeGreaterThan(40);
  });

  it("can't reach a real account, by a gate in the code, unless awaiting the manager's wording", () => {
    const ungated = flagged
      .filter((f) => f.gate === null && !awaiting(f))
      .map((f) => `${f.file}:${f.line} ${f.text.slice(0, 80)}`);
    expect(ungated).toEqual([]);
  });

  it("lists only what is still ungated", () => {
    const still = AWAITING.filter(([file, start]) =>
      flagged.some((f) => f.gate === null && f.file === file && f.text.startsWith(start)),
    );
    expect(still).toEqual(AWAITING);
  });

  it("counts each gate", () => {
    const counts: Partial<Record<Gate | "awaiting", number>> = {};
    for (const f of flagged) {
      const key = f.gate ?? "awaiting";
      counts[key] = (counts[key] ?? 0) + 1;
    }
    expect(counts.awaiting).toBe(AWAITING.length);
    expect((counts.advice_topic ?? 0) + (counts.real_account_filter ?? 0)).toBeGreaterThan(0);
  });
});
