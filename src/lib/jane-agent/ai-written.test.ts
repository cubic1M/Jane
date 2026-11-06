import { describe, expect, it } from "vitest";
import { AI_WRITTEN_LABEL } from "@/config/advice";
import { AiWrittenLabel } from "@/components/ai-written-label";
import { withAiNote, type ClaudeAnswer } from "./claude";

// From Nov 12, 2026 Anthropic's Usage Policy asks that a person know AI was involved in anything
// about their investments or taxes. Every chat answer Claude writes about either carries
// refs.aiWritten, and the chat shows AI_WRITTEN_LABEL under it.
const answer = (body: string): ClaudeAnswer => ({
  kind: "answer",
  reply: { body, actions: [], refs: {} },
});
const noted = (a: ClaudeAnswer, tools: string[] = []) =>
  withAiNote(a, { tools: tools.map((name) => ({ name, ms: 1 })) }).reply.refs.aiWritten;

describe("an AI-written answer about investing or taxes", () => {
  it("says so when its words are about either", () => {
    expect(noted(answer("Your 401(k) holds two index funds worth $1,973.33."))).toBe(true);
    expect(noted(answer("Your stocks fell 3% this month."))).toBe(true);
    expect(noted(answer("You're on course to owe about $2,930 in federal tax."))).toBe(true);
    expect(noted(answer("The IRS sent that letter about your 2025 return."))).toBe(true);
  });

  it("says so when it looked something up there, whatever its words", () => {
    expect(noted(answer("You've got $1,973.33 there."), ["holdings"])).toBe(true);
    expect(noted(answer("That's $2,930 by Jan 15."), ["tax_estimate (up front)"])).toBe(true);
  });

  it("doesn't on everyday money", () => {
    expect(noted(answer("You spent $310.47 on groceries in October."))).toBeUndefined();
    expect(noted(answer("Netflix is $15.49 a month."), ["subscriptions"])).toBeUndefined();
  });

  it("leaves the stand-in answers alone: those aren't Claude's words", () => {
    const blocked: ClaudeAnswer = {
      kind: "blocked",
      reply: { body: "Your taxes, in short.", actions: [], refs: {} },
      issues: ["tax_or_legal_advice"],
    };
    expect(withAiNote(blocked, { tools: [] })).toBe(blocked);
  });

  it("keeps the demo advice label next to it", () => {
    const demo: ClaudeAnswer = {
      kind: "answer",
      reply: { body: "Your investments returned 4%.", actions: [], refs: { advice: true } },
    };
    expect(withAiNote(demo, { tools: [] }).reply.refs).toEqual({ advice: true, aiWritten: true });
  });

  it("is said in a few words under the answer", () => {
    expect(AI_WRITTEN_LABEL).toBe("Written by AI. It can be wrong.");
    expect(AiWrittenLabel({}).props).toMatchObject({ role: "note", children: AI_WRITTEN_LABEL });
  });
});
