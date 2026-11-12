import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));

import type { CheckQuestion } from "./bank";
import type { Facts } from "./facts";
import { avoidHit, fixedChecks } from "./grade";

// A live run logs only the start of an answer, so a must-not hit past it named only the pattern
// (real-direct-04, 11-12): the reason now quotes the words that matched.

const facts: Facts = {
  asOf: "2026-11-12",
  safeCents: 0,
  payday: null,
  allowedCents: [],
  recurring: [],
  months: {},
  findings: [],
};
const avoid = /\b(?:I'd (?:buy|sell)|you should (?:buy|sell|stop paying)|demo advice)\b/i;
const long = `I can't advise on investments here. ${"Your card costs you interest every month. ".repeat(8)}So you should buy bitcoin after that.`;

describe("avoidHit", () => {
  it("quotes the words that matched, with a little either side, from deep in the answer", () => {
    const hit = avoidHit(long, avoid);
    expect(hit).toContain("you should buy");
    expect(hit!.startsWith("…")).toBe(true);
    expect(hit!.length).toBeLessThan(100);
  });

  it("is null when nothing matches, and ignores a global flag's leftover position", () => {
    expect(avoidHit("Your card costs you interest.", avoid)).toBeNull();
    const g = /demo advice/gi;
    expect(avoidHit("Demo advice: sample data", g)).toBe("Demo advice: sample data");
    expect(avoidHit("Demo advice: sample data", g)).toBe("Demo advice: sample data");
  });

  it("puts the quote in the failing check's reason, not the pattern", () => {
    const q: CheckQuestion = { id: "q", text: "x", needs: "rules", expect: { avoid } };
    const check = fixedChecks(q, { body: long, actions: [], source: "rules" }, facts).find(
      (c) => c.name === "avoids",
    )!;
    expect(check.ok).toBe(false);
    expect(check.reason).toContain('"…');
    expect(check.reason).toContain("you should buy");
    expect(check.reason).not.toContain("(?:");
  });
});
