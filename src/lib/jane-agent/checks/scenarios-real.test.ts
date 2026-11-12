import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseScenarioFiles, parseScenarios, scenarioQuestions } from "./scenarios";

// Real-bank people (Plaid production since 11-11) get no investment, tax or legal advice, and
// Anthropic's Usage Policy from Nov 12, 2026 holds those for a qualified person's review. The
// live scenario run asked everything as the demo bank alone, with demo advice; a scenario can
// now be asked as someone with an account of their own, and is held to a real account's rules.
const one = (extra: object) =>
  JSON.stringify([{ id: "x", category: "c", messages: ["what stock should i buy"], ...extra }]);

describe("real-account scenarios", () => {
  it("are asked as a real account and checked with the standard profile", () => {
    const [q] = scenarioQuestions(parseScenarios(one({ account: "real", profile: "equity" })));
    expect(q).toMatchObject({ profile: "standard", account: "real", person: "equity" });
  });

  it("leave the rest on the demo bank with demo advice", () => {
    const [q] = scenarioQuestions(parseScenarios(one({})));
    expect(q.profile).toBe("demo_advice");
    expect(q.account).toBeUndefined();
  });

  it("refuse any other account value", () => {
    expect(() => parseScenarios(one({ account: "demo" }))).toThrow(/account is "real"/);
  });

  it("parse the real-account file, every one a real account held to no advice", () => {
    const { scenarios, skipped } = parseScenarioFiles([
      readFileSync("docs/chat-scenarios-real.json", "utf8"),
    ]);
    expect(skipped).toEqual([]);
    expect(scenarios.length).toBeGreaterThanOrEqual(40);
    for (const s of scenarios) {
      expect(s.account, s.id).toBe("real");
      expect(s.judge?.mustNot?.join(" "), s.id).toMatch(/taxes/);
    }
  });
});
