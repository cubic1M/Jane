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
    ["don't pay my bills by yourself", "bills", "ask", null, null],
    ["never switch my insurance on your own", "insurance", "ask", null, null],
    ["stop paying my bills automatically", "bills", "ask", null, null],
    ["do not move money to my goals by yourself", "goals", "ask", null, null],
    ["pay my bills by yourself", "bills", "all", null, null],
    ["let jane pay my bills up to $200 with each payment", "bills", "all", 20_000, null],
    ["let jane pay my bills up to $1,200 per payment", "bills", "all", 120_000, null],
    ["let jane pay my bills up to $1,200 a month, $300 each time", "bills", "all", 30_000, 120_000],
    ["let jane pay my monthly bills up to $200 per payment", "bills", "all", 20_000, null],
    // CodeRabbit #2283: "not more than" is a limit, not a refusal.
    ["let jane pay my bills, not more than $200 automatically", "bills", "all", null, 20_000],
    ["let jane pay my bills automatically, not more than $200", "bills", "all", null, 20_000],
    // "Stop asking me" is a grant, not a refusal.
    ["stop asking me and let jane pay my bills automatically", "bills", "all", null, null],
    ["don't let jane pay my bills automatically", "bills", "ask", null, null],
    // CodeRabbit #2290: asking to stop being asked to let Jane, then saying no, is a refusal.
    [
      "stop asking me to let jane pay my bills automatically. I don't want that",
      "bills",
      "ask",
      null,
      null,
    ],
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
