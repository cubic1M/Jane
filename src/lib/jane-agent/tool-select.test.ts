import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));

import { QUESTIONS } from "./checks/bank";
import { CHAT_TOOLS } from "./claude-tools";
import { OPEN_AREA_TOOL, areaTools, lookupsFor, sectorsFor, toolsFor } from "./tool-select";

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

  it("orders the tools to share a cached start: general first, a breakpoint, then buttons, then the sector", () => {
    const withTax = toolsFor(CHAT_TOOLS, "how are my crypto gains taxed", null, null, ASOF);
    const plain = toolsFor(CHAT_TOOLS, "how am I doing", null, null, ASOF);
    const breakpoints = (tools: ReturnType<typeof toolsFor>) =>
      tools.flatMap((t, i) => ("cache_control" in t && t.cache_control ? [i] : []));
    expect(breakpoints(withTax)).toHaveLength(1);
    expect(breakpoints(plain)).toHaveLength(1);
    // The part before the breakpoint is the same list for both, so one cached copy serves all.
    const head = (tools: ReturnType<typeof toolsFor>) =>
      tools.slice(0, breakpoints(tools)[0] + 1).map((t) => t.name);
    expect(head(withTax)).toEqual(head(plain));
    // The button tool follows the breakpoint, so having it or not doesn't change the cached part.
    const names = withTax.map((t) => t.name);
    expect(names.indexOf("propose_action")).toBe(breakpoints(withTax)[0] + 1);
    const noButtons = toolsFor(CHAT_TOOLS, "how are my crypto gains taxed", null, null, ASOF, {
      buttons: false,
    });
    expect(noButtons.map((t) => t.name)).not.toContain("propose_action");
    expect(head(noButtons)).toEqual(head(withTax));
  });

  it("picks the specific lookup a question needs, else the sector's overview", () => {
    const lookups = (q: string) => lookupsFor(q, sectorsFor(q, null, null, ASOF));
    expect(lookups("how do i handle taxes on rsu vesting")).toEqual(["tax_equity"]);
    expect(lookups("how do i build credit")).toEqual(["credit_building", "credit_score"]);
    expect(lookups("do i get a 401k match")).toEqual(["retirement_accounts"]);
    expect(lookups("am i diversified")).toEqual(["portfolio_review"]);
    // No sector, no lookup; a sector without a named need gets the overview.
    expect(lookups("how am i doing")).toEqual([]);
    expect(lookups("what do i owe on my cards")).toEqual(["debts", "credit_score"]);
    // Every one is a tool Claude has, with nothing it must be told.
    for (const name of [
      "tax_equity",
      "credit_building",
      "credit_score",
      "retirement_accounts",
      "portfolio_review",
      "debts",
      "tax_estimate",
      "holdings",
      "investor_profile",
      "insurance_policies",
    ]) {
      const tool = CHAT_TOOLS.find((t) => t.name === name);
      expect(tool, name).toBeDefined();
      expect((tool!.input_schema as { required?: string[] }).required ?? [], name).toEqual([]);
    }
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

// Casual questions often name no area ("my car got rear ended"): Claude then opens the area itself.
describe("open_area", () => {
  const breakpoint = (tools: ReturnType<typeof toolsFor>) =>
    tools.findIndex((t) => "cache_control" in t && t.cache_control);

  it("is in every request, in the cached general part, with one fixed definition", () => {
    for (const question of [
      "how am I doing",
      "how are my crypto gains taxed",
      "my car got rear ended",
    ]) {
      const tools = toolsFor(CHAT_TOOLS, question, null, null, ASOF);
      const at = tools.findIndex((t) => t.name === "open_area");
      expect(at).toBeGreaterThanOrEqual(0);
      expect(at).toBeLessThanOrEqual(breakpoint(tools));
      expect(tools[at].input_schema).toEqual(OPEN_AREA_TOOL.input_schema);
    }
  });

  it("is how a question in no area's words reaches that area's tools", () => {
    for (const [question, area, tool] of [
      ["my car got rear ended what do i do", "insurance", "insurance_policies"],
      ["how much will uncle sam take this year", "tax", "tax_estimate"],
      ["should i lease or buy a car", "debt", "car_purchase"],
      ["when can i stop working", "investing", "retirement_plan"],
    ] as const) {
      expect(names(question)).not.toContain(tool);
      expect(areaTools(CHAT_TOOLS, area).map((t) => t.name)).toContain(tool);
    }
  });
});
