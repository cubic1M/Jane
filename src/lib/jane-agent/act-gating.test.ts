import { describe, expect, it } from "vitest";
import { directs, flaggedStrings, type Gate } from "./act-gating";

// Manager 11-23: every string the backup chat or a card can say that tells the person to act
// (tellsThemToAct, and a sentence starting with one of the rule's verbs: directs) must be shown not to reach a person with a real account, from the code around it
// (./act-gating.ts): an advice-only card topic, a card's text that forRealAccount drops, the advice
// side of an advice-mode check, a reply labelled demo advice, or a helper only those use. A new
// directive string with none of these fails here.
//
// ALLOWED are flagged by the reader but tell the person nothing to do, each with why.
// AWAITING are the ones the code doesn't gate, each kept until the manager decides its wording
// (the PR lists where each shows and the wording proposed). One that leaves this list, by a reword
// or a gate, is taken off it here too: the test fails while it's still listed.
const ALLOWED: readonly [string, string, string][] = [
  ["src/lib/jane-agent/tax-states-message.ts", "Do you live in ", "a question about a fact"],
  ["src/lib/jane-agent/decision.ts", "Buy what?", "a question back about what the person asked"],
];
const AWAITING: readonly [string, string][] = [];

describe("strings that tell the person to act", () => {
  const flagged = flaggedStrings();
  const listed = (f: { file: string; text: string }) =>
    [...AWAITING, ...ALLOWED].some(([file, start]) => f.file === file && f.text.startsWith(start));

  it("are found across the backup's replies and the cards", () => {
    expect(flagged.length).toBeGreaterThan(40);
  });

  it("can't reach a real account, by a gate in the code, unless allowed or awaiting the manager's wording", () => {
    const ungated = flagged
      .filter((f) => f.gate === null && !listed(f))
      .map((f) => `${f.file}:${f.line} ${f.text.slice(0, 80)}`);
    expect(ungated).toEqual([]);
  });

  it("lists only what is still ungated", () => {
    const still = [...AWAITING, ...ALLOWED].filter(([file, start]) =>
      flagged.some((f) => f.gate === null && f.file === file && f.text.startsWith(start)),
    );
    expect(still).toEqual([...AWAITING, ...ALLOWED]);
  });

  it("reads the rule's own verbs as telling the person to act, and an app link as not", () => {
    expect(directs("Cancel your Netflix plan")).toBe(true);
    expect(directs("You pay $15. Roll over the old 401(k) to cut fees.")).toBe(true);
    expect(directs("Open an account at Ally")).toBe(true);
    expect(directs("Something went wrong. Open the plan instead.")).toBe(false);
    expect(directs("Your car and Geico policies together with Geico")).toBe(false);
  });

  it("counts each gate", () => {
    const counts: Partial<Record<Gate | "awaiting", number>> = {};
    for (const f of flagged) {
      const key = f.gate ?? "awaiting";
      counts[key] = (counts[key] ?? 0) + 1;
    }
    expect(counts.awaiting).toBe(AWAITING.length + ALLOWED.length);
    expect((counts.advice_topic ?? 0) + (counts.real_account_filter ?? 0)).toBeGreaterThan(0);
  });
});
