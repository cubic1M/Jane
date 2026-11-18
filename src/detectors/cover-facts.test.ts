import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));

import { HEADLINE_VERBS } from "@/config/detectors";
import {
  AUTO_AVERAGE,
  FED_RATES,
  NETFLIX_PLANS,
  RENTERS_AVERAGE,
  TMOBILE_PLANS,
  STANFORD_HOUSING,
} from "@/config/student-money";
import { ADVICE_TOPICS } from "@/config/suggestions";
import { checkGuardrails, dollarFigures, recommendsAChoice } from "@/lib/guardrails";
import { buildProfile, type ProfileInput, type ProfileTx } from "@/profile/build";
import { HEADLINE_MAX, SHORT_MAX, type Suggestion } from "./contract";
import { BILL_FACT_DETECTORS, COVER_FACT_DETECTORS, LOAN_FACT_DETECTORS } from "./cover-facts";
import { runDetectors } from "./index";
import { grad, undergrad } from "./__fixtures__/students";

// Suggest-money lane, phase 2 (11-18): facts for real accounts where the advice card is demo
// only — belongings with no cover, car cover above the US average, a card rate above the Fed's.

const DETECTORS = [...COVER_FACT_DETECTORS, ...LOAN_FACT_DETECTORS, ...BILL_FACT_DETECTORS];
const fire = (data: ProfileInput, topic: string) =>
  runDetectors({ profile: buildProfile(data), data }, DETECTORS).find((s) => s.topic === topic) ??
  null;

function expectClean(s: Suggestion) {
  // Real accounts see these: never an advice topic, and every sentence passes.
  expect(ADVICE_TOPICS as readonly string[]).not.toContain(s.topic);
  for (const text of [s.title, s.headline, s.short, s.why]) {
    expect(
      checkGuardrails(
        text,
        dollarFigures(text).map((f) => f.cents),
      ),
      text,
    ).toEqual({
      ok: true,
    });
    expect(recommendsAChoice(text), text).toBe(false);
    // Says what Jane sees and what the source says; never drop, cancel, switch or move
    // (chat-tests wording rule, 11-18).
    expect(text, text).not.toMatch(/\b(?:switch|cancel|drop|move)\b/i);
  }
  expect(s.headline.length).toBeLessThanOrEqual(HEADLINE_MAX);
  expect(HEADLINE_VERBS, s.headline).toContain(s.headline.split(" ")[0]);
  expect(s.short.length).toBeLessThanOrEqual(SHORT_MAX);
}

const row = (
  date: string,
  amountCents: number,
  description: string,
  pfc: string,
  accountId: string,
): ProfileTx => ({
  date,
  amountCents,
  description,
  pfc,
  accountId,
});

describe("cover for belongings", () => {
  it("a renter with no renters charge: the landlord's policy, the published average, the steps", () => {
    const s = fire(grad(), "belongings_cover")!;
    expect(s).not.toBeNull();
    expect(s.why).toContain("$169");
    expect(s.why).toContain("2022");
    expect(s.why).toContain("ask two or three insurers");
    expect(s.more?.map((m) => m.href)).toEqual([RENTERS_AVERAGE.url]);
    expectClean(s);
  });

  it("a Stanford student with no rent: Stanford's own words on its housing", () => {
    const s = fire(undergrad(), "belongings_cover")!;
    expect(s).not.toBeNull();
    expect(s.title).toContain("Stanford housing");
    expect(s.why).toContain("doesn't carry insurance on residents' belongings");
    expect(s.more?.[0]?.href).toBe(STANFORD_HOUSING.url);
    expectClean(s);
  });

  it("says the US average outside California", () => {
    expect(fire({ ...grad(), state: "NY" }, "belongings_cover")!.why).toContain("$171");
  });

  it("is nothing with a renters charge, for an owner, or for someone in debt trouble", () => {
    const base = grad();
    const covered = {
      ...base,
      transactions: [
        ...base.transactions,
        ...["2026-09-03", "2026-10-03", "2026-11-03"].map((d) =>
          row(d, 1_400, "LEMONADE RENTERS INS", "GENERAL_SERVICES_INSURANCE", "grad-checking"),
        ),
      ],
    };
    expect(buildProfile(covered).facts.insurance_home.value).toBe(true);
    expect(fire(covered, "belongings_cover")).toBeNull();
    expect(fire({ ...base, told: { housing: "own" } }, "belongings_cover")).toBeNull();
    expect(fire({ ...base, told: { debt_trouble: true } }, "belongings_cover")).toBeNull();
    // Not Stanford, not renting: nothing to say.
    const elsewhere = {
      ...undergrad(),
      transactions: undergrad().transactions.filter((t) => !/STANFORD/.test(t.description)),
    };
    expect(fire(elsewhere, "belongings_cover")).toBeNull();
  });
});

describe("car cover above the US average", () => {
  const paying = (monthly: number): ProfileInput => {
    const base = grad();
    return {
      ...base,
      transactions: [
        ...base.transactions,
        ...["2026-09-05", "2026-10-05", "2026-11-05"].map((d) =>
          row(d, monthly, "GEICO *AUTO", "GENERAL_SERVICES_INSURANCE", "grad-checking"),
        ),
      ],
    };
  };

  it("sets a year of it beside the NAIC average, with the steps to get quotes", () => {
    const s = fire(paying(14_200), "car_cover_cost")!;
    expect(s).not.toBeNull();
    expect(s.why).toContain("$1,282");
    expect(s.why).toContain(String(AUTO_AVERAGE.year));
    expect(s.why).toContain("declarations page");
    expect(s.worthCents).toBe(170_400 - AUTO_AVERAGE.usCents);
    expect(s.confidence.percent).toBeLessThanOrEqual(45);
    expectClean(s);
  });

  it("is nothing at or under 10% above the average, or with one charge", () => {
    // Monthly charges: $117.50 is $1,410 a year, under $1,410.20 (10% above $1,282); $118 is over.
    expect(fire(paying(11_750), "car_cover_cost")).toBeNull();
    expect(fire(paying(11_800), "car_cover_cost")).not.toBeNull();
    const once = {
      ...grad(),
      transactions: [
        ...grad().transactions,
        row("2026-11-05", 90_000, "GEICO *AUTO", "GENERAL_SERVICES_INSURANCE", "grad-checking"),
      ],
    };
    expect(fire(once, "car_cover_cost")).toBeNull();
  });
});

describe("a card rate above the Fed's average", () => {
  it("prices the gap on the balance and gives the call to make", () => {
    const s = fire(grad(), "card_rate_check")!;
    expect(s).not.toBeNull();
    // 27.99% against 22.36% on $2,350.
    expect(s.worthCents).toBe(Math.round((235_000 * (2_799 - FED_RATES.cardBps)) / 10_000));
    expect(s.why).toContain("22.36%");
    expect(s.why).toContain("11.90%");
    expect(s.why).toContain("call the number on your card");
    expectClean(s);
  });

  it("is nothing within two points of the average, under $500 owed, or with no rate", () => {
    const at = (aprBps: number | null, owed = 235_000): ProfileInput => {
      const base = grad();
      return {
        ...base,
        accounts: base.accounts.map((a) =>
          a.type === "credit" ? { ...a, balanceCents: owed } : a,
        ),
        liabilities: base.liabilities.map((l) => ({ ...l, aprBps })),
      };
    };
    expect(fire(at(FED_RATES.cardBps + FED_RATES.aboveBps - 1), "card_rate_check")).toBeNull();
    expect(fire(at(FED_RATES.cardBps + FED_RATES.aboveBps), "card_rate_check")).not.toBeNull();
    expect(fire(at(2_799, FED_RATES.minBalanceCents - 1), "card_rate_check")).toBeNull();
    expect(fire(at(null), "card_rate_check")).toBeNull();
  });
});

describe("Netflix's plan with ads", () => {
  const netflix = (cents: number, date = "2026-11-16"): ProfileInput => {
    const base = undergrad();
    return {
      ...base,
      transactions: [
        ...base.transactions.filter((t) => !/NETFLIX/.test(t.description)),
        row(date, cents, "NETFLIX.COM", "ENTERTAINMENT_TV_AND_MOVIES", "ug-checking"),
      ],
    };
  };

  it("says what its own page lists, a year of the difference, and where to change it", () => {
    const s = fire(netflix(1_799), "cheaper_tier")!;
    expect(s.worthCents).toBe((1_799 - NETFLIX_PLANS.withAdsCents) * 12);
    expect(s.why).toContain("$8.99");
    expect(s.why).toContain("Change plan");
    expect(s.more?.[0]?.href).toBe(NETFLIX_PLANS.url);
    expectClean(s);
  });

  it("is nothing for someone already on it (with tax), or whose last charge is over 45 days old", () => {
    expect(fire(netflix(1_034), "cheaper_tier")).toBeNull();
    expect(fire(netflix(1_035), "cheaper_tier")).not.toBeNull();
    expect(fire(netflix(1_799, "2026-10-04"), "cheaper_tier")).not.toBeNull();
    expect(fire(netflix(1_799, "2026-10-03"), "cheaper_tier")).toBeNull();
  });
});

describe("T-Mobile's cheaper plan", () => {
  const bill = (cents: number, description = "T-MOBILE", date = "2026-11-10"): ProfileInput => {
    const base = undergrad();
    return {
      ...base,
      transactions: [
        ...base.transactions.filter((t) => !/T-MOBILE/.test(t.description)),
        row(date, cents, description, "RENT_AND_UTILITIES_TELEPHONE", "ug-checking"),
      ],
    };
  };

  it("says the carrier's own one-line price and a year under the bill, with taxes allowed for", () => {
    const s = fire(bill(7_500), "phone_plan_cheaper")!;
    // $55 with 15% for taxes is $63.25: $11.75 a month under $75.
    expect(s.worthCents).toBe((7_500 - 6_325) * 12);
    expect(s.why).toContain("T-Mix Standard at $55.00");
    expect(s.why).toContain("$65.00 without");
    expect(s.more?.[0]?.href).toBe(TMOBILE_PLANS.url);
    expectClean(s);
  });

  it("is nothing at or under $63.25, over $110 (more than one line), for protection, or when stale", () => {
    expect(fire(bill(6_325), "phone_plan_cheaper")).toBeNull();
    expect(fire(bill(6_326), "phone_plan_cheaper")).not.toBeNull();
    expect(fire(bill(11_000), "phone_plan_cheaper")).not.toBeNull();
    expect(fire(bill(11_001), "phone_plan_cheaper")).toBeNull();
    expect(fire(bill(7_500, "T-MOBILE PROTECTION 360"), "phone_plan_cheaper")).toBeNull();
    expect(fire(bill(7_500, "T-MOBILE", "2026-10-03"), "phone_plan_cheaper")).toBeNull();
  });
});
