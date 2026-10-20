import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));

import { CHAT_TOOLS } from "../claude-tools";
import { QUESTIONS } from "../checks/bank";
import { parseIntent } from "../intents";
import { CAPABILITIES, capabilityFor } from "./index";

// Spec step 190: Jane's chat has one registry of capabilities, and it holds to its rules.

const tools = new Set(CHAT_TOOLS.map((t) => t.name));
const sectors = new Set(QUESTIONS.flatMap((q) => [q.sector, q.id.split("-")[0]]));

describe("the capability registry", () => {
  it("has one capability per id, and no two claim the same kind of question", () => {
    expect(new Set(CAPABILITIES.map((c) => c.id)).size).toBe(CAPABILITIES.length);
    const kinds = CAPABILITIES.flatMap((c) => c.kinds);
    expect(kinds.filter((k, i) => kinds.indexOf(k) !== i)).toEqual([]);
  });

  it("gives every capability a tool Claude has, and questions in the bank", () => {
    for (const c of CAPABILITIES) {
      expect(c.tools.length, `${c.id} has no tool`).toBeGreaterThan(0);
      for (const t of c.tools) expect(tools.has(t), `${c.id} -> ${t}`).toBe(true);
      expect(
        c.bank.some((s) => sectors.has(s)),
        `${c.id} has no questions in the bank`,
      ).toBe(true);
    }
  });

  it("claims every kind of question the bank's wording is read as", () => {
    const unclaimed = new Set<string>();
    for (const q of QUESTIONS) {
      const intent = parseIntent(q.text, "2026-10-19");
      if (!capabilityFor(intent) && !["which"].includes(intent.kind)) unclaimed.add(intent.kind);
    }
    expect([...unclaimed]).toEqual([]);
  });
});
