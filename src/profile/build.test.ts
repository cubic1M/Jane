import { describe, expect, it } from "vitest";
import { PEOPLE } from "@/config/people";
import { buildProfile, monthsCovered, monthsForRate, monthsOfData } from "./build";
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
    expect(facts.has_children).toMatchObject({ value: true, source: "seen" });
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

  // Debugger 11-01: a driver paying "STATE FARM RO 27 SFPP" $212.40 a month was told "Check
  // your car is insured" (urgent) beside "Your State Farm insurance could cost less".
  it("counts a known insurer's payments as its cover, without the word AUTO", () => {
    const base = inputFor("renter");
    const premium = (date: string, description: string) => ({
      date,
      amountCents: 21_240,
      description,
      pfc: "GENERAL_SERVICES_INSURANCE",
      accountId: base.accounts[0].id,
    });
    const others = base.transactions.filter((t) => t.pfc !== "GENERAL_SERVICES_INSURANCE");
    const facts = (description: string) =>
      buildProfile({
        ...base,
        transactions: [
          ...others,
          ...["2026-08-06", "2026-09-06", "2026-10-06"].map((d) => premium(d, description)),
        ],
      }).facts;
    expect(facts("STATE FARM RO 27 SFPP").insurance_auto).toMatchObject({ value: true });
    expect(facts("ALLSTATE INS CO PAYMENT").insurance_auto).toMatchObject({ value: true });
    expect(facts("LEMONADE INC").insurance_home).toMatchObject({ value: true });
    expect(facts("ACME MUTUAL PREMIUM").insurance_auto).toMatchObject({ value: false });
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

  it("counts debt trouble's evidence once: Chris's payday loans, not all his signals added up", () => {
    const fact = buildProfile(inputFor("debt")).facts.debt_trouble;
    expect(fact.value).toBe(true);
    expect(fact.evidence).toMatch(/^12 cash-advance repayments in 12 months/);
  });

  // Loans QA: debt trouble rests on the debts (balances, rates, payments against income), not
  // on overdraft and late fees, which are spending findings of their own.
  it("isn't debt trouble from fees alone", () => {
    const maya = inputFor("renter");
    const checking = maya.accounts.find((a) => a.type === "depository")!.id;
    const fees = Array.from({ length: 6 }, (_, i) => ({
      date: `2026-0${i + 3}-15`,
      amountCents: 3_400,
      description: "OVERDRAFT FEE",
      pfc: "BANK_FEES_OVERDRAFT_FEES",
      accountId: checking,
    }));
    const p = buildProfile({ ...maya, transactions: [...maya.transactions, ...fees] });
    expect(p.facts.debt_trouble.value).toBe(false);
  });

  it("is debt trouble when payments pass 40% of income without the cash to carry them", () => {
    const priya = inputFor("equity");
    // Her mortgage alone is over 40% of take-home, and her cash carries it: not trouble.
    expect(buildProfile(priya).facts.debt_trouble.value).toBe(false);
    const broke = {
      ...priya,
      accounts: priya.accounts.map((a) =>
        a.type === "depository" ? { ...a, balanceCents: 0 } : a,
      ),
    };
    const fact = buildProfile(broke).facts.debt_trouble;
    expect(fact.value).toBe(true);
    expect(fact.evidence).toMatch(/debt payments over 40% of income, without the cash/);
  });
});

describe("monthly income on a short history", () => {
  const today = "2026-10-19";
  const day = (back: number) =>
    new Date(Date.parse(`${today}T00:00:00Z`) - back * 86_400_000).toISOString().slice(0, 10);

  it("spreads the pay over the days the history covers, not over the calendar months it touches", () => {
    const base = inputFor("renter");
    // Six $4,000 paychecks from 75 days ago to 5 days ago: the history starts in August, so the
    // calendar count says 2 months ($12,000 a month), but it is 2.5 months of data.
    const pays = [5, 19, 33, 47, 61, 75].map((b) => ({
      date: day(b),
      amountCents: -400_000,
      description: "ACME CORP PAYROLL",
      pfc: "INCOME_SALARY",
      accountId: base.accounts[0].id,
    }));
    const profile = buildProfile({ ...base, today, transactions: pays });
    const monthly = profile.facts.monthly_income.value as number;
    expect(monthly).toBeGreaterThan(9_500_00);
    expect(monthly).toBeLessThan(10_000_00);
  });

  it("leaves a full year as the calendar count (the sample people do not move)", () => {
    expect(buildProfile(inputFor("renter")).months).toBe(12);
  });
});

describe("credit card debt", () => {
  it("is not known yet when no card is linked, rather than $0 (QA)", () => {
    const input = inputFor("family");
    const noCards = { ...input, accounts: input.accounts.filter((a) => a.type !== "credit") };
    const fact = buildProfile(noCards).facts.card_debt_cents;
    expect(fact).toMatchObject({ value: null, confidence: 0, evidence: "not known yet" });
  });

  it("is seen from the linked cards' balances", () => {
    const input = inputFor("family");
    expect(input.accounts.some((a) => a.type === "credit")).toBe(true);
    expect(buildProfile(input).facts.card_debt_cents).toMatchObject({ source: "seen" });
  });
});

// Debugger 10-30: one report page said "11 months of data" (this count, by calendar months, Nov
// to Oct) and "12 months of data" (the report's own count, by days) for the same year of
// statements. One counter now: the days covered, in average months, up to a year.
describe("months of data, one count", () => {
  const tx = (date: string) => ({ date }) as Parameters<typeof monthsOfData>[0][number];
  it("calls a year of statements 12 months, not 11", () => {
    expect(monthsCovered("2025-11-02", "2026-10-28")).toBe(12);
    expect(monthsOfData([tx("2025-11-02"), tx("2026-10-20")], "2026-10-28")).toBe(12);
  });
  it("keeps three months three and a month one", () => {
    expect(monthsCovered("2026-07-29", "2026-10-28")).toBe(3);
    expect(monthsCovered("2026-10-04", "2026-10-28")).toBe(1);
    expect(monthsCovered("2020-01-01", "2026-10-28")).toBe(12);
    // A part month never rounds up: three and a half months is three (thin data stays modest).
    expect(monthsCovered("2026-06-12", "2026-10-28")).toBe(4);
    expect(monthsCovered("2026-07-12", "2026-10-28")).toBe(3);
  });
});

// Review 10-30: months counted to today, so statements from Jan to Mar seen in October read as
// "10 months of data", and monthly rates were spread over ten months. They count to the last day
// the statements reach (never past today).
describe("months of data, for statements that stopped a while ago", () => {
  const tx = (date: string) => ({ date }) as Parameters<typeof monthsOfData>[0][number];
  it("counts to the last statement day, not to today", () => {
    const stale = [tx("2026-01-05"), tx("2026-02-14"), tx("2026-03-30")];
    expect(monthsOfData(stale, "2026-10-26")).toBe(3);
    expect(monthsForRate(stale, "2026-10-26")).toBeGreaterThan(2.7);
    expect(monthsForRate(stale, "2026-10-26")).toBeLessThan(3.1);
  });
});
