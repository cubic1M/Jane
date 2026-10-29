import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));

import {
  ANSWER_FLOOR,
  CONFIRM_STEP,
  CONTRADICT_STEP,
  MAX_CONFIDENCE,
  START_CONFIDENCE,
  USE_FROM_CONFIDENCE,
} from "@/config/memory";
import { memoryForChat, toldFromFacts, weigh, type KnownFact } from "./facts";

// How each new piece of evidence moves what Jane knows (src/lib/memory/facts.ts).

const held = (over: Partial<Parameters<typeof weigh>[0] & object> = {}) => ({
  value: "rent" as string | number | boolean,
  source: "chat" as const,
  sourceRef: "jane_message:1",
  confidence: 80,
  ...over,
});

describe("weighing new evidence", () => {
  it("starts a new fact as sure as its source, or as the evidence says", () => {
    const draft = { key: "housing", value: "rent", label: "You rent", source: "chat" as const };
    expect(weigh(null, draft)).toEqual({ kind: "create", confidence: START_CONFIDENCE.chat });
    expect(weigh(null, { ...draft, source: "detector", confidence: 72 })).toEqual({
      kind: "create",
      confidence: 72,
    });
  });

  it("raises a fact when new evidence agrees, up to the cap", () => {
    const draft = {
      key: "housing",
      value: "Rent",
      label: "You rent",
      source: "detector" as const,
      sourceRef: "scan",
      confidence: 60,
    };
    expect(weigh(held(), draft)).toEqual({
      kind: "confirm",
      confidence: 80 + CONFIRM_STEP,
      newEvidence: true,
    });
    expect(weigh(held({ confidence: 95 }), draft)).toMatchObject({ confidence: MAX_CONFIDENCE });
  });

  it("doesn't count the same evidence twice (the nightly scan on the same data)", () => {
    const current = held({ source: "detector", sourceRef: "scan", confidence: 70 });
    const draft = {
      key: "housing",
      value: "rent",
      label: "You rent",
      source: "detector" as const,
      sourceRef: "scan",
      confidence: 65,
    };
    expect(weigh(current, draft)).toEqual({ kind: "confirm", confidence: 70, newEvidence: false });
  });

  it("replaces a fact when the person says otherwise, or newer data of the same kind does", () => {
    const own = { key: "housing", value: "own", label: "You own" };
    expect(weigh(held(), { ...own, source: "answer" })).toEqual({
      kind: "supersede",
      confidence: START_CONFIDENCE.answer,
    });
    expect(weigh(held(), { ...own, source: "chat" })).toMatchObject({ kind: "supersede" });
    expect(
      weigh(held({ source: "detector", sourceRef: "scan" }), { ...own, source: "detector" }),
    ).toMatchObject({ kind: "supersede" });
  });

  it("only lowers what the person said when the data disagrees", () => {
    const draft = { key: "housing", value: "own", label: "You own", source: "detector" as const };
    expect(weigh(held(), draft)).toEqual({ kind: "weaken", confidence: 80 - CONTRADICT_STEP });
    // Said in the chat and contradicted again and again: in the end the data wins.
    expect(weigh(held({ confidence: 55 }), draft)).toMatchObject({ kind: "supersede" });
    // An answer never falls below the floor from data alone.
    expect(weigh(held({ source: "answer", confidence: 60 }), draft)).toEqual({
      kind: "weaken",
      confidence: ANSWER_FLOOR,
    });
  });

  it("flips a habit only after enough answers the other way", () => {
    const habit = held({ value: "acts", source: "action", confidence: 70 });
    const draft = { key: "habit:x", value: "passes", label: "Passes", source: "action" as const };
    const first = weigh(habit, draft);
    expect(first).toEqual({ kind: "weaken", confidence: 70 - CONTRADICT_STEP });
    expect(weigh({ ...habit, confidence: first.confidence }, draft)).toMatchObject({
      kind: "supersede",
    });
  });
});

const fact = (over: Partial<KnownFact>): KnownFact => ({
  id: "f",
  key: "housing",
  value: "rent",
  label: "You rent your home",
  source: "chat",
  sourceRef: null,
  confidence: 80,
  evidenceCount: 1,
  firstSeen: new Date(0),
  lastConfirmed: new Date(0),
  ...over,
});

describe("reading what Jane knows", () => {
  it("gives the profile what the person said, sure enough and in the fact's own kind", () => {
    expect(
      toldFromFacts([
        fact({}),
        fact({ key: "has_car", value: true, source: "answer" }),
        fact({ key: "is_student", value: true, confidence: USE_FROM_CONFIDENCE - 1 }),
        // Read from the data: the profile reads the data itself.
        fact({ key: "employer", value: "Acme", source: "detector" }),
        // Not one of the choices.
        fact({ key: "household", value: "big" }),
        // Not a profile fact.
        fact({ key: "goal:car", value: "a car" }),
      ]),
    ).toEqual({ housing: "rent", has_car: true });
  });

  it("puts the surest facts in the chat's context, with where each came from", () => {
    expect(memoryForChat([])).toBe("");
    const text = memoryForChat([
      fact({}),
      fact({ key: "main_bank", label: "Your main bank is Chase", source: "detector" }),
      fact({ key: "x", label: "A weak guess", confidence: USE_FROM_CONFIDENCE - 1 }),
    ]);
    expect(text).toContain("- You rent your home (they said it in the chat; 80% sure)");
    expect(text).toContain("- Your main bank is Chase (from their bank data; 80% sure)");
    expect(text).not.toContain("A weak guess");
    expect(text).toMatch(/never quote an old conversation/);
  });
});
