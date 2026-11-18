import { describe, expect, it } from "vitest";
import {
  addToState,
  emptyState,
  parseScenarios,
  reportByCategory,
  scenarioQuestions,
} from "./scenarios";

// The walks have no Claude key, so their chat questions only ever met the backup (manager 11-18):
// a scenario can name a walked cell, and is asked as that cell's own person, built from its
// uploaded files, on a real account. Its answer is kept whole so a figure can be checked.
const CELL = "src/lib/jane-agent/checks/__fixtures__/cells/one-checking";
const one = (extra: object) =>
  JSON.stringify([
    { id: "x", category: "walk", messages: ["what bank fees have I paid?"], ...extra },
  ]);

describe("a scenario asked as a walked cell", () => {
  it("is a real account, checked with the standard profile, and carries the cell", () => {
    const [q] = scenarioQuestions(parseScenarios(one({ cell: CELL })));
    expect(q).toMatchObject({ profile: "standard", cell: CELL });
    expect(q.person).toBeUndefined();
  });

  it("takes no sample life or account beside it", () => {
    expect(() => parseScenarios(one({ cell: CELL, profile: "renter" }))).toThrow(/its own person/);
    expect(() => parseScenarios(one({ cell: CELL, account: "real" }))).toThrow(/its own person/);
    expect(() => parseScenarios(one({ cell: "" }))).toThrow(/folder of a walked cell/);
  });

  it("keeps the whole answer, and shows only its start among the worst answers", () => {
    const answer = `You paid one $12.00 monthly service fee on Oct 27. ${"More. ".repeat(100)}`;
    const scenarios = parseScenarios(one({ cell: CELL }));
    const state = addToState(
      emptyState(),
      scenarios,
      [
        {
          id: "x",
          text: "what bank fees have I paid?",
          status: "graded",
          score: 10,
          reason: "wrong",
          answer,
        },
      ] as never,
      2,
    );
    expect(state.done.x[0].answer).toBe(answer);
    expect(state.done.x[0].answer!.length).toBeGreaterThan(300);
    const [report] = reportByCategory({ results: state.done.x }, scenarios);
    expect(report.failures[0].answer).toHaveLength(300);
  });
});
