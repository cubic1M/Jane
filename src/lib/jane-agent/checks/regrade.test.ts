import { describe, expect, it } from "vitest";
import { recordedAnswers, regradeAll, regradeAnswer, type RecordedAnswer } from "./regrade";

// Plan item 13: the guardrails and code graders over the answers Claude really wrote on 10-21, for
// free, on every pull request. A guardrail that starts blocking a good recorded answer, or a
// grader that stops seeing a bad one, fails here before anyone pays for a fresh run.

const answer = (text: string): RecordedAnswer => ({
  id: "x",
  text: "q",
  answer: text,
  claudeScore: 90,
});

describe("the recorded answers", () => {
  it("are all here, and hold no one's contact details", () => {
    const all = recordedAnswers();
    expect(all).toHaveLength(124);
    for (const { answer: text } of all) {
      expect(text).not.toMatch(/[\w.]+@[\w.]+\.\w+|\b\d{3}-\d{3}-\d{4}\b|\b\d{3}-\d{2}-\d{4}\b/);
    }
  });

  const { results, counts, passed, codeFailedJudgeHigh } = regradeAll();

  it("what code finds in them, exactly: a change here is a change in what the rules see", () => {
    expect(counts).toEqual({ avoid: 2, canned: 4 });
    expect(passed).toBe(118);
  });

  it("no guardrail blocks an answer that was shown, under the profile it was shown in", () => {
    expect(results.filter((r) => r.failed.some((f) => f.startsWith("guardrail:")))).toEqual([]);
  });

  it("no recorded answer has a link or asks for a secret, so those rules cost nothing", () => {
    expect(counts.link ?? 0).toBe(0);
    expect(counts.credentials ?? 0).toBe(0);
  });

  it("code never fails an answer the judge rated high", () => {
    expect(codeFailedJudgeHigh).toEqual([]);
  });
});

describe("regradeAnswer sees what it should", () => {
  it.each([
    ["Sure! You have $10.00.", "opener"],
    ["Netflix is $15.49/mo.", "money_style"],
    ["Look at open_findings for this.", "internal_name"],
    ["Jane says she can do that.", "jane_as_she"],
    ["Verify at https://chase-verify.example/login please.", "link"],
    ["Reply with your password to confirm.", "credentials"],
    ["Sorry, I couldn't finish an answer to that. Please ask again.", "canned"],
    ["I'd say you could sue them.", "guardrail:tax_or_legal_advice"],
    ["This return is guaranteed.", "guardrail:guaranteed_outcome"],
  ])("%s fails %s", (text, name) => {
    expect(regradeAnswer(answer(text)).failed).toContain(name);
  });

  it("a plain answer passes", () => {
    expect(regradeAnswer(answer("Netflix is $15.49 a month.")).failed).toEqual([]);
  });

  it("a scenario's avoid and mentions count, and mentions only on a whole answer", () => {
    const scenario = {
      id: "x",
      category: "c",
      messages: [],
      avoid: "tap yes",
      mentions: "\\$[0-9]",
    };
    expect(regradeAnswer(answer("Just tap yes."), scenario).failed).toEqual(["avoid", "mentions"]);
    expect(regradeAnswer(answer("a".repeat(300)), scenario).failed).toEqual([]);
  });
});
