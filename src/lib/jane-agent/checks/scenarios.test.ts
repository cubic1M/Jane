import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));

import { conversations } from "./run";
import {
  addToState,
  batchOf,
  emptyState,
  evalSection,
  filesOf,
  parseScenarioFiles,
  quotaOrder,
  parseScenarios,
  reportByCategory,
  scenarioQuestions,
  withEvalSection,
  EVAL_END,
  EVAL_START,
} from "./scenarios";

const scenarios = parseScenarios(
  JSON.stringify([
    {
      id: "a",
      category: "debt",
      messages: ["do i have debts", "which is worst?"],
      noButtons: true,
    },
    { id: "b", category: "everyday", messages: ["hi"], mentions: "hello|hi" },
  ]),
);

describe("scenario files", () => {
  it("reads the repo's sample file", async () => {
    const { readFileSync } = await import("node:fs");
    expect(parseScenarios(readFileSync("docs/chat-scenarios.json", "utf8")).length).toBeGreaterThan(
      0,
    );
  });

  it("turns each into a conversation: the first message leads, the rest follow it", () => {
    const questions = scenarioQuestions(scenarios);
    expect(questions.map((q) => [q.id, q.after])).toEqual([
      ["a", undefined],
      ["a.2", "a"],
      ["b", undefined],
    ]);
    expect(conversations(questions).map((c) => c.map((q) => q.id))).toEqual([["a", "a.2"], ["b"]]);
    expect(questions[0].expect.noButtons).toBe(true);
    expect(questions[2].expect.mentions?.test("Hello")).toBe(true);
    expect(questions.every((q) => q.needs === "claude")).toBe(true);
  });

  it("refuses a bad file, saying which scenario", () => {
    expect(() => parseScenarios("{}")).toThrow(/array/);
    expect(() => parseScenarios('[{"category":"x","messages":["hi"]}]')).toThrow(/needs an id/);
    expect(() => parseScenarios('[{"id":"a","messages":["hi"]}]')).toThrow(/needs a category/);
    expect(() => parseScenarios('[{"id":"a","category":"x","messages":[]}]')).toThrow(/message/);
    expect(() =>
      parseScenarios('[{"id":"a","category":"x","messages":["hi"],"mentions":"("}]'),
    ).toThrow();
    const twice = { id: "a", category: "x", messages: ["hi"] };
    expect(() => parseScenarios(JSON.stringify([twice, twice]))).toThrow(/twice/);
  });
});

describe("batches that resume", () => {
  const many = parseScenarios(
    JSON.stringify(
      ["a", "b", "c", "d"].map((id) => ({ id, category: "x", messages: [`${id} 1`, `${id} 2`] })),
    ),
  );
  const graded = (id: string) =>
    ({ id, text: id, status: "graded", score: 90, reason: "ok" }) as never;

  it("takes positions from..to, and skips what an earlier batch finished", () => {
    expect(batchOf(many, { from: 2, to: 3 }).map((s) => s.id)).toEqual(["b", "c"]);
    expect(batchOf(many, {}).map((s) => s.id)).toEqual(["a", "b", "c", "d"]);
    const state = addToState(emptyState(), many.slice(0, 2), [graded("a"), graded("a.2")], 12.5);
    expect(Object.keys(state.done)).toEqual(["a"]);
    expect(state.costCents).toBe(12.5);
    expect(batchOf(many, { state }).map((s) => s.id)).toEqual(["b", "c", "d"]);
    expect(batchOf(many, { from: 1, to: 2, state }).map((s) => s.id)).toEqual(["b"]);
  });

  it("asks a scenario again when the cap cut it short, and adds up the cost", () => {
    const skipped = { id: "b.2", text: "b", status: "skipped", reason: "cap" } as never;
    const state = addToState(emptyState(), many.slice(1, 2), [graded("b"), skipped], 3);
    expect(state.done).toEqual({});
    const next = addToState(state, many.slice(0, 1), [graded("a"), graded("a.2")], 4.25);
    expect(next.costCents).toBe(7.25);
  });

  it("lists the 20 worst answers across categories, worst first", () => {
    const results = Array.from({ length: 25 }, (_, i) => ({
      id: `s${i}`,
      text: `q${i}`,
      status: "graded" as const,
      score: i,
      reason: `r${i}`,
      answer: `a${i}`,
    }));
    const sc = parseScenarios(
      JSON.stringify(results.map((r) => ({ id: r.id, category: "x", messages: ["m"] }))),
    );
    const section = evalSection(reportByCategory({ results }, sc), {
      date: "d",
      scenarios: 25,
      costCents: 0,
      capCents: 400,
      stoppedAtCap: false,
    });
    const lines = section.split("\n").filter((l) => l.startsWith("- s"));
    expect(lines).toHaveLength(20);
    expect(lines[0]).toContain("s0 (0,");
    expect(lines[0]).toContain('Answer began: "a0"');
  });
});

describe("the per-category report", () => {
  const result = (id: string, score: number, status: "graded" | "skipped" = "graded") =>
    ({ id, text: `q ${id}`, status, score, reason: `why ${id}` }) as never;
  const run = {
    results: [result("a", 100), result("a.2", 40), result("b", 90), result("c", 0, "skipped")],
  };

  it("counts failures per category, worst category first, and skipped ones", () => {
    const reports = reportByCategory(run, scenarios);
    expect(reports.map((r) => [r.category, r.asked, r.failed, r.skipped])).toEqual([
      ["debt", 2, 1, 0],
      ["everyday", 1, 0, 0],
      ["other", 0, 0, 1],
    ]);
    expect(reports[0].failures).toEqual([
      { id: "a.2", text: "q a.2", score: 40, reason: "why a.2" },
    ]);
  });

  it("writes a section and replaces it in the doc on the next run", () => {
    const section = evalSection(reportByCategory(run, scenarios), {
      date: "2026-10-21",
      scenarios: 2,
      costCents: 123,
      capCents: 400,
      stoppedAtCap: false,
    });
    expect(section).toContain("| debt | 2 | 1 | 50% | 0 | 70 |");
    expect(section).toContain('- a.2 (40, debt): "q a.2" — why a.2');
    const once = withEvalSection("# Chat quality\n", section);
    expect(once).toContain("## Scenario run");
    const twice = withEvalSection(once, "NEW");
    expect(twice.split(EVAL_START)).toHaveLength(2);
    expect(twice).toContain(`${EVAL_START}\nNEW\n${EVAL_END}`);
    expect(twice).not.toContain("why a.2");
  });
});
