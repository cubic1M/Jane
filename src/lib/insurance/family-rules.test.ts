import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));

import { parseIntent } from "@/lib/jane-agent/intents";
import {
  compareFamilyHealth,
  familyHealthGap,
  readPeople,
  spouseHealthGaps,
  teenDriverGaps,
  whoIsCovered,
  type FamilyPolicy,
  type Person,
} from "./family-rules";

// The whole household's cover (spec step 198): who is covered by what, the gaps for each
// person, and a family health plan comparison that counts both employers' plans. Pure.

const sam: Person = { name: "Sam", relation: "child", driver: true, age: 16 };
const robin: Person = { name: "Robin", relation: "spouse", driver: false, age: 41 };
const policy = (over: Partial<FamilyPolicy>): FamilyPolicy => ({
  id: "p",
  kind: "auto",
  carrier: "GEICO",
  owner: "You",
  shared: false,
  employer: false,
  premiumCents: 14_200,
  premiumFrequency: "monthly",
  deductibleCents: 100_000,
  coverage: {},
  covered: [],
  ...over,
});

describe("reading the people", () => {
  it("keeps the well-formed ones", () => {
    expect(
      readPeople([
        { name: " Sam ", relation: "child", driver: true, age: 16 },
        { name: "", relation: "child" },
        { name: "Pat", relation: "cousin" },
        "nope",
        { name: "Robin", relation: "spouse", age: -3 },
      ]),
    ).toEqual([
      { name: "Sam", relation: "child", driver: true, age: 16 },
      { name: "Robin", relation: "spouse", driver: false, age: null },
    ]);
    expect(readPeople(null)).toEqual([]);
  });
});

describe("who is covered by what", () => {
  it("matches each person to the policies that list them, and the partner to theirs", () => {
    const car = policy({ id: "car", covered: [sam] });
    const health = policy({ id: "h", kind: "health", carrier: "Bluepeak", covered: [robin] });
    const theirs = policy({
      id: "w",
      kind: "health",
      carrier: "Acme Corp",
      owner: "Alex",
      shared: true,
      employer: true,
    });
    const { rows } = whoIsCovered([sam, robin], [car, health, theirs], ["Alex"]);
    expect(rows.map((r) => [r.name, r.policies.map((p) => p.id)])).toEqual([
      ["You", ["car", "h"]],
      ["Alex", ["w"]],
      ["Sam", ["car"]],
      ["Robin", ["h"]],
    ]);
  });

  it("shows a shared policy once, even when both of you have it", () => {
    const mine = policy({ id: "a", shared: true });
    const theirs = policy({ id: "b", owner: "Alex", shared: true });
    expect(whoIsCovered([], [mine, theirs], ["Alex"]).policies.map((p) => p.id)).toEqual(["a"]);
    // Unshared ones are each their own.
    expect(
      whoIsCovered([], [policy({ id: "a" }), policy({ id: "b", owner: "Alex" })], ["Alex"])
        .policies,
    ).toHaveLength(2);
  });
});

describe("a teen driver", () => {
  it("needs to be on a car policy", () => {
    expect(teenDriverGaps([sam], [policy({ covered: [] })])).toMatchObject([
      { key: "teen_driver", kind: "auto", title: "Sam isn't on a car policy" },
    ]);
    expect(teenDriverGaps([sam], [policy({ covered: [sam] })])).toEqual([]);
    expect(teenDriverGaps([sam], [])).toHaveLength(1);
  });
  it("only counts a young driver", () => {
    expect(teenDriverGaps([{ ...sam, age: 22 }], [])).toEqual([]);
    expect(teenDriverGaps([{ ...sam, driver: false }], [])).toEqual([]);
    expect(teenDriverGaps([{ ...sam, age: null }], [])).toEqual([]);
  });
});

describe("a spouse with no health plan", () => {
  const health = (over: Partial<FamilyPolicy>) => policy({ kind: "health", ...over });
  it("is a gap unless they're on yours or have a plan of their own", () => {
    expect(spouseHealthGaps([robin], [health({})], ["Alex"])).toMatchObject([
      { key: "spouse_health", title: "Robin isn't on a health plan" },
    ]);
    expect(spouseHealthGaps([robin], [health({ covered: [robin] })], [])).toEqual([]);
    expect(spouseHealthGaps([robin], [health({ owner: "Alex", shared: true })], ["Alex"])).toEqual(
      [],
    );
  });
});

describe("the family health plan comparison", () => {
  // Plans with a $1,500 deductible and 20% coinsurance up to $6,000.
  const plan = (over: Partial<FamilyPolicy>) =>
    policy({
      kind: "health",
      deductibleCents: 150_000,
      coverage: { coinsurance: 20, outOfPocketMax: 600_000 },
      ...over,
    });
  const mine = plan({
    id: "mine",
    carrier: "Bluepeak",
    premiumCents: 70_000,
    covered: [robin, sam],
  });
  const theirs = plan({
    id: "theirs",
    carrier: "Acme Corp",
    owner: "Alex",
    shared: true,
    employer: true,
    premiumCents: 20_000,
    covered: [],
  });

  it("prices every plan for everyone in the household, counting both employers' plans", () => {
    const rows = compareFamilyHealth([mine, theirs], 4, 150_000);
    expect(rows.map((r) => r.policyId)).toEqual(["theirs", "mine"]);
    // Alex's $200 a month covers one person; four people cost 1 + 3 × 0.8 = 3.4 times as much.
    expect(rows[0]).toMatchObject({
      label: "Alex's Acme Corp plan",
      employer: true,
      premiumYearlyCents: 816_000,
    });
    expect(rows[1].label).toBe("Your Bluepeak plan");
    expect(rows[0].familyYearlyCents).toBeLessThan(rows[1].familyYearlyCents);
  });

  it("says to look at the other plan only when it saves enough", () => {
    const rows = compareFamilyHealth([mine, theirs], 4, 150_000);
    expect(familyHealthGap(rows, "mine")).toMatchObject({
      key: "family_health_plan",
      title: "Alex's Acme Corp plan may cost your family less",
    });
    expect(familyHealthGap(rows, "theirs")).toBeNull();
    expect(familyHealthGap(rows.slice(0, 1), "theirs")).toBeNull();
    const close = compareFamilyHealth([mine, { ...theirs, premiumCents: 28_000 }], 4, 150_000);
    expect(familyHealthGap(close, "mine")).toBeNull();
  });

  it("leaves out a plan whose terms aren't known", () => {
    expect(
      compareFamilyHealth([mine, plan({ id: "x", deductibleCents: null })], 4, 100_000),
    ).toHaveLength(1);
  });
});

describe("questions", () => {
  it("reads questions about who is covered", () => {
    for (const text of [
      "who is covered on my car insurance",
      "who's on my health plan",
      "is my family covered",
      "are my kids covered by my insurance",
      "is my wife's work health plan cheaper for the family",
    ]) {
      expect(parseIntent(text, "2026-10-19"), text).toMatchObject({
        kind: "insurance",
        ask: "household",
      });
    }
  });
});
