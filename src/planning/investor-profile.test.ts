import { describe, expect, it } from "vitest";
import { DROP_REACTIONS, HORIZONS, PROFILE_QUESTIONS } from "@/config/investing";
import {
  EMPTY_ANSWERS,
  ProfileError,
  currentAge,
  isComplete,
  nextQuestion,
  parseAnswer,
  parseProfileForm,
  profileSummary,
  questionAfter,
  riskLevelOf,
  type ProfileAnswers,
} from "./investor-profile";

// Spec step 129: what the investments are for, from four answers.

const FULL: ProfileAnswers = {
  age: 45,
  ageOn: "2026-10-19",
  horizon: "10_to_20",
  dropReaction: "worry",
  goals: ["retirement"],
  answeredAt: new Date("2026-10-19T12:00:00Z"),
  updatedAt: new Date("2026-10-19T12:00:00Z"),
};

describe("the questions", () => {
  it("asks the unanswered ones in order, and none once all four are in", () => {
    expect(nextQuestion(EMPTY_ANSWERS)?.key).toBe("age");
    expect(nextQuestion({ ...EMPTY_ANSWERS, age: 30 })?.key).toBe("horizon");
    expect(nextQuestion({ ...FULL, goals: [] })?.key).toBe("goal");
    expect(nextQuestion({ ...FULL, horizon: "someday" })?.key).toBe("horizon");
    expect(nextQuestion(FULL)).toBeNull();
    expect(isComplete(FULL)).toBe(true);
  });

  it("goes through all four again in order for the yearly check", () => {
    expect(PROFILE_QUESTIONS.map((q) => questionAfter(q.key)?.key ?? null)).toEqual([
      "horizon",
      "drop",
      "goal",
      null,
    ]);
    expect(questionAfter("nope")).toBeNull();
  });

  it("offers at most five answers each, the chat's buttons", () => {
    for (const q of PROFILE_QUESTIONS) expect(q.choices.length).toBeLessThanOrEqual(5);
  });
});

describe("riskLevelOf", () => {
  it("is the lower of what the timeline allows and what they're comfortable with", () => {
    for (const [horizon, h] of Object.entries(HORIZONS)) {
      for (const [drop, d] of Object.entries(DROP_REACTIONS)) {
        expect(riskLevelOf({ ...FULL, horizon, dropReaction: drop }), `${horizon} ${drop}`).toBe(
          Math.min(h.capacity, d.willingness),
        );
      }
    }
  });

  it("is nothing until both are answered", () => {
    expect(riskLevelOf(EMPTY_ANSWERS)).toBeNull();
    expect(riskLevelOf({ ...FULL, dropReaction: null })).toBeNull();
  });
});

describe("profileSummary", () => {
  it("says the level and why", () => {
    expect(profileSummary(FULL, "2026-10-19")).toMatchObject({
      complete: true,
      riskLevel: 3,
      label: "Moderate",
      age: 45,
      goals: ["retirement"],
      why: "Moderate: you'd worry, but wait it out after a drop, so less risk than your timeline allows.",
      stale: false,
    });
    expect(
      profileSummary({ ...FULL, horizon: "under_3", dropReaction: "buy" }, "2026-10-19"),
    ).toMatchObject({
      why: "Conservative: you need the money within 3 years, so less risk than you'd be comfortable with.",
    });
    expect(
      profileSummary({ ...FULL, horizon: "10_to_20", dropReaction: "fine" }, "2026-10-19"),
    ).toMatchObject({
      why: "Moderately aggressive: you need the money in 10 to 20 years, and you'd be fine; it comes back after a drop.",
    });
  });

  it("isn't complete with an answer missing, and says which comes next", () => {
    expect(profileSummary({ ...FULL, goals: [] }, "2026-10-19")).toMatchObject({
      complete: false,
      answered: 3,
      next: { key: "goal" },
    });
  });

  it("is stale a year after the last change, and ages the person", () => {
    const later = profileSummary(FULL, "2027-10-20");
    expect(later).toMatchObject({ stale: true, age: 46 });
    expect(currentAge({ age: 45, ageOn: "2026-10-19" }, "2027-10-18")).toBe(45);
    expect(currentAge({ age: null, ageOn: null }, "2027-10-18")).toBeNull();
  });
});

describe("parsing answers", () => {
  it("takes ages in range and keys from the config", () => {
    expect(parseAnswer("age", "35", "2026-10-19")).toEqual({ age: 35, ageOn: "2026-10-19" });
    expect(parseAnswer("horizon", "over_20", "2026-10-19")).toEqual({ horizon: "over_20" });
    expect(parseAnswer("drop", "sell", "2026-10-19")).toEqual({ dropReaction: "sell" });
    expect(parseAnswer("goal", "home", "2026-10-19")).toEqual({ goals: ["home"] });
    for (const [key, value] of [
      ["age", "12"],
      ["age", "101"],
      ["age", "4.5"],
      ["horizon", "soon"],
      ["drop", ""],
      ["goal", "yacht"],
    ] as const) {
      expect(() => parseAnswer(key, value, "2026-10-19"), `${key} ${value}`).toThrow(ProfileError);
    }
  });

  it("takes the whole form, with any number of goals", () => {
    expect(
      parseProfileForm(
        { age: "52", horizon: "3_to_10", dropReaction: "fine", goals: ["home", "growth", "home"] },
        "2026-10-19",
      ),
    ).toEqual({
      age: 52,
      ageOn: "2026-10-19",
      horizon: "3_to_10",
      dropReaction: "fine",
      goals: ["home", "growth"],
    });
    expect(() =>
      parseProfileForm({ age: "52", horizon: "3_to_10", dropReaction: "fine", goals: [] }, "x"),
    ).toThrow("Pick at least one");
  });
});
