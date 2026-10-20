import { describe, expect, it } from "vitest";
import { PEOPLE } from "@/config/people";
import { buildProfile } from "./build";
import { confidenceOf, sureWords } from "./confidence";
import { FACT_KEYS } from "./facts";
import { inputFor, SAMPLE_TODAY } from "./sample";

// Spec step 253: each of the eight people's profiles matches their written description.

const THROUGH = SAMPLE_TODAY;

describe("the picture of you", () => {
  it.each(PEOPLE)("$id's profile matches their written description", (person) => {
    const profile = buildProfile(inputFor(person.id));
    const f = profile.facts;
    expect(f.income_pattern.value, "income").toBe(person.facts.income);
    expect(f.life_stage.value, "stage").toBe(person.facts.lifeStage);
    expect(f.household.value, "household").toBe(person.facts.household);
    expect(f.housing.value, "housing").toBe(person.facts.owns === "home" ? "own" : "rent");
    expect(f.debt_trouble.value, "trouble").toBe(person.facts.hasDebtTrouble);
  });

  it("gives every fact a source and a percentage worked out from the evidence", () => {
    const { facts } = buildProfile(inputFor("family"));
    expect(Object.keys(facts)).toEqual([...FACT_KEYS]);
    for (const fact of Object.values(facts)) {
      expect(["seen", "told", "guessed"]).toContain(fact.source);
      expect(fact.confidence).toBeGreaterThanOrEqual(0);
      expect(fact.confidence).toBeLessThanOrEqual(100);
      expect(fact.evidence.length).toBeGreaterThan(0);
    }
    // 24 paychecks in 12 months of data.
    expect(facts.income_pattern).toMatchObject({ source: "seen" });
    expect(facts.income_pattern.confidence).toBe(confidenceOf("seen", { months: 12, matches: 48 }));
    expect(facts.has_pmi).toMatchObject({ value: true, source: "seen" });
    expect(facts.has_children).toMatchObject({ value: true, source: "guessed" });
  });

  it("reads the details that detectors will need", () => {
    const family = buildProfile(inputFor("family")).facts;
    expect(family.earners.value).toBe(2);
    expect(family.insurance_home.value).toBe(true);
    expect(family.insurance_life.value).toBe(false);
    expect(family.mortgage_rate_bps.value).toBe(325);
    expect(buildProfile(inputFor("equity")).facts.has_stock_plan.value).toBe(true);
    expect(buildProfile(inputFor("retiree")).facts.insurance_medigap.value).toBe(true);
    expect(buildProfile(inputFor("freelancer")).facts.insurance_health.value).toBe(true);
    expect(buildProfile(inputFor("debt")).facts.has_payday_loan.value).toBe(true);
    expect(buildProfile(inputFor("renter")).facts.has_401k.value).toBe(true);
  });

  it("puts what the person told Jane first, at 100%", () => {
    const base = buildProfile(inputFor("family")).facts;
    const told = buildProfile(inputFor("family", { has_children: false, age: 41 })).facts;
    expect(base.has_children.value).toBe(true);
    expect(told.has_children).toMatchObject({ value: false, source: "told", confidence: 100 });
    expect(told.household.value).toBe("couple");
    expect(told.age).toMatchObject({ value: 41, source: "told" });
    // A person's age changes where Jane thinks they are in life.
    expect(buildProfile(inputFor("renter", { age: 62 })).facts.life_stage.value).toBe(
      "approaching",
    );
  });

  it("is the same every time, and says so when it doesn't know", () => {
    expect(buildProfile(inputFor("owner"))).toEqual(buildProfile(inputFor("owner")));
    const empty = buildProfile({
      today: THROUGH,
      transactions: [],
      accounts: [],
      liabilities: [],
      told: {},
    });
    expect(empty.facts.income_pattern).toMatchObject({ value: null, confidence: 0 });
    expect(empty.facts.life_stage.value).toBe("peak");
  });
});

describe("confidence", () => {
  it("grows with data and matches, is capped, and is 100 when told", () => {
    const few = confidenceOf("seen", { months: 1, matches: 1 });
    const many = confidenceOf("seen", { months: 12, matches: 50 });
    expect(many).toBeGreaterThan(few);
    expect(many).toBeLessThanOrEqual(97);
    expect(confidenceOf("guessed", { months: 12, matches: 50 })).toBeLessThan(many);
    expect(confidenceOf("told", { months: 0, matches: 0 })).toBe(100);
    expect(confidenceOf("seen", { months: 5, matches: 3 })).toBe(
      confidenceOf("seen", { months: 5, matches: 3 }),
    );
  });
});

describe("how the percentage spreads with the evidence", () => {
  it("is high for a fact clearly counted over many months, middling for little, and unsure for a guess", () => {
    expect(confidenceOf("seen", { months: 12, matches: 12 })).toBeGreaterThanOrEqual(90);
    expect(confidenceOf("seen", { months: 12, matches: 12 })).toBeLessThanOrEqual(95);
    const little = confidenceOf("seen", { months: 1, matches: 1 });
    expect(little).toBeGreaterThanOrEqual(50);
    expect(little).toBeLessThanOrEqual(65);
    expect(confidenceOf("guessed", { months: 12, matches: 50 })).toBeLessThan(50);
    expect(sureWords(85)).toBe("I'm 85% sure");
    expect(sureWords(45)).toBe("I'm not sure (45%)");
  });

  it("spreads across the sample people's facts", () => {
    const all = Object.values(buildProfile(inputFor("debt")).facts)
      .filter((f) => f.value !== null && f.source !== "told")
      .map((f) => f.confidence);
    expect(Math.max(...all) - Math.min(...all)).toBeGreaterThanOrEqual(25);
    // Guesses are below 50%.
    for (const f of Object.values(buildProfile(inputFor("family")).facts)) {
      if (f.source === "guessed" && f.value !== null) expect(f.confidence, f.key).toBeLessThan(50);
    }
  });

  it("counts debt trouble's evidence once: Chris has 11 fees, not all his signals added up", () => {
    const fact = buildProfile(inputFor("debt")).facts.debt_trouble;
    expect(fact.value).toBe(true);
    expect(fact.evidence).toMatch(/^11 overdraft, insufficient-funds or late fees in 12 months/);
  });
});
