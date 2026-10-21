import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));

import { QUESTIONS } from "./checks/bank";
import { CHAT_TOOLS } from "./claude-tools";
import { toolsFor } from "./tool-select";

// Claude is sent the general tools and only the sectors a question is about: faster to start
// and cheaper, and every question in the bank still gets the tool it should reach.

const ASOF = "2026-10-19";
const names = (question: string, previous: string | null = null) =>
  toolsFor(CHAT_TOOLS, question, previous, null, ASOF).map((t) => t.name);

describe("choosing tools for a question", () => {
  it("sends far fewer tools than all of them", () => {
    expect(names("how am I doing").length).toBeLessThan(CHAT_TOOLS.length / 2);
    expect(names("how am I doing")).toContain("whole_picture");
    expect(names("how am I doing")).toContain("propose_action");
  });

  it("always sends the calculator", () => {
    for (const q of [
      "how am I doing",
      "wats a safe wdrawal rate",
      "how long to pay off my card at $200/month",
    ]) {
      expect(names(q), q).toContain("calculate");
    }
  });

  it("adds a sector when the question is about it", () => {
    expect(names("did my insurance premium go up")).toContain("insurance_policies");
    expect(names("how are my crypto gains taxed")).toEqual(
      expect.arrayContaining(["tax_investments", "crypto"]),
    );
    expect(names("what's my credit score")).toContain("credit_score");
    expect(names("how am I doing")).not.toContain("credit_score");
  });

  it("reads a short follow-up against the message before it", () => {
    expect(names("and the other one?", "what's my credit score")).toContain("credit_score");
  });

  it("still reaches the right tool for every question in the bank", () => {
    const missed: string[] = [];
    const previous = new Map(QUESTIONS.map((q) => [q.id, q.text]));
    for (const q of QUESTIONS) {
      if (!q.tool) continue;
      const before = q.after ? (previous.get(q.after) ?? null) : null;
      if (!names(q.text, before).includes(q.tool)) missed.push(`${q.id} "${q.text}" -> ${q.tool}`);
    }
    expect(missed, missed.join("\n")).toEqual([]);
  });
});
