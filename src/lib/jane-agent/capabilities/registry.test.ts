import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));

import { CHAT_TOOLS } from "../claude-tools";
import { MORE_ROWS } from "../checks/bank-more";
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

  // Spec step 230: every debt and credit capability has questions in the bank.
  it("has bank questions for every tool and every kind of question the debt capability has", () => {
    const debt = CAPABILITIES.find((c) => c.id === "debt")!;
    const asked = new Set(MORE_ROWS.map((r) => r[2]));
    expect(debt.tools.filter((t) => !asked.has(t))).toEqual([]);
    const understood = new Set(QUESTIONS.map((q) => parseIntent(q.text, "2026-10-19").kind));
    expect(debt.kinds.filter((k) => !understood.has(k as never))).toEqual([]);
  });
});
