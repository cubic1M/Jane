import { describe, expect, it } from "vitest";
import { parseIntent } from "./intents";

// Spec step 141: one autopilot, every sector, typed in the chat.

const parse = (text: string) => parseIntent(text, "2026-10-19");

describe("sector autopilot intents", () => {
  it.each([
    ["let Jane handle insurance up to $50 a month", "insurance", "all", null, 5_000],
    ["you can pay my bills by yourself, up to $200 each time", "bills", "all", 20_000, null],
    ["let jane move money to my goals", "goals", "all", null, null],
    ["only the safe stuff for debt", "debt", "safe", null, null],
    ["always ask me about taxes", "taxes", "ask", null, null],
    ["stop handling my investments", "investing", "ask", null, null],
    // CodeRabbit part 2: a "don't" is a stop, and two caps are two periods.
    ["don't let jane handle insurance", "insurance", "ask", null, null],
    ["I do not want you to pay my bills by yourself", "bills", "ask", null, null],
    [
      "let jane pay my bills up to $200 per payment and $500 a month",
      "bills",
      "all",
      20_000,
      50_000,
    ],
    ["let jane pay my bills up to $1,200 per payment", "bills", "all", 120_000, null],
    ["let jane pay my bills up to $1,200 a month, $300 each time", "bills", "all", 30_000, 120_000],
    ["let jane pay my monthly bills up to $200 per payment", "bills", "all", 20_000, null],
  ])("reads %j", (text, sector, level, actionCapCents, monthlyCapCents) => {
    expect(parse(text)).toEqual({
      kind: "autopilot_sector",
      sector,
      level,
      actionCapCents,
      monthlyCapCents,
    });
  });

  it.each([
    "what can you do by yourself?",
    "how much do you do on your own",
    "what's my autopilot",
  ])("reads %j as the overview", (text) => {
    expect(parse(text)).toEqual({ kind: "autopilot_overview" });
  });

  // Spec step 142.
  it.each(["what did you check last night?", "show me the nightly log", "what did you check"])(
    "reads %j as last night's checks",
    (text) => {
      expect(parse(text)).toEqual({ kind: "checked" });
    },
  );

  it("leaves other questions about those areas alone", () => {
    expect(parse("what does my car insurance cover?").kind).not.toBe("autopilot_sector");
    expect(parse("cancel my netflix subscription").kind).toBe("act");
    expect(parse("pause autopilot").kind).toBe("pause_autopilot");
    expect(parse("help").kind).toBe("help");
  });
});
