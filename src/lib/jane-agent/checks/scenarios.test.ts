import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));

import { conversations } from "./run";
import {
  evalSection,
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
    expect(section).toContain("| debt | 2 | 1 | 0 | 70 |");
    expect(section).toContain('- a.2 (40): "q a.2" — why a.2');
    const once = withEvalSection("# Chat quality\n", section);
    expect(once).toContain("## Scenario run");
    const twice = withEvalSection(once, "NEW");
    expect(twice.split(EVAL_START)).toHaveLength(2);
    expect(twice).toContain(`${EVAL_START}\nNEW\n${EVAL_END}`);
    expect(twice).not.toContain("why a.2");
  });
});
