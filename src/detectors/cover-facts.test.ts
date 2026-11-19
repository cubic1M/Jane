import { describe, expect, it, vi } from "vitest";
import { tellsThemToAct } from "@/lib/real-account-text";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));

import { HEADLINE_VERBS } from "@/config/detectors";
import {
  AUTO_AVERAGE,
  FED_RATES,
  CHEAPER_PLANS,
  FEE_WAIVERS,
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
    // Real-account text never tells them what to do with money (src/lib/real-account-text.ts).
    expect(tellsThemToAct(text), text).toBe(false);
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
    expect(s.why).toContain("quotes from two or three insurers");
    expect(s.title).toBe(
      "A landlord's policy covers the building, not your things, and I see no renters cover",
    );
    expect(s.headline).not.toMatch(/\$/);
    expect(s.more?.map((m) => m.href)).toEqual([RENTERS_AVERAGE.url]);
    expectClean(s);
  });

  it("a Stanford student with no rent: Stanford's own words on its housing", () => {
    const s = fire(undergrad(), "belongings_cover")!;
    expect(s).not.toBeNull();
    expect(s.title).toBe("Stanford housing doesn't insure your things, and I see no renters cover");
    // No figure in the headline: it would read as what buying cover brings.
    expect(s.headline).toBe("Note no renters cover shows in your accounts");
    expect(s.factOnly).toBe(true);
    expect(s.why).toContain("doesn't carry insurance on residents' belongings");
    expect(s.more?.[0]?.href).toBe(STANFORD_HOUSING.url);
    expectClean(s);
  });

  it("headlines what Jane sees, never that the person has no cover", () => {
    for (const s of [fire(grad(), "belongings_cover")!, fire(undergrad(), "belongings_cover")!]) {
      expect(s.headline).toMatch(/shows in your accounts$/);
      expect(s.headline).not.toMatch(/\byour things have no\b|\byou have no\b/i);
      expect(s.confidence.percent).toBeLessThan(100);
      expectClean(s);
    }
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
    expect(s.headline).toBe("Note car cover $422 a year above US average");
    expect(s.why).toContain("whether any discounts apply that you don't have");
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
    // A different product's rate beside the card's reads as a nudge to borrow (wording check 2).
    expect(s.why).not.toContain("personal loan");
    expect(s.why).toContain("if you've paid on time, say so");
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

describe("ChatGPT's Go plan beside Netflix's", () => {
  it("lists each service's cheaper plan on one card, worth the two differences", () => {
    const base = undergrad();
    const data = {
      ...base,
      transactions: [
        ...base.transactions,
        row(
          "2026-11-12",
          2_000,
          "OPENAI *CHATGPT SUBSCR",
          "GENERAL_SERVICES_OTHER_GENERAL_SERVICES",
          "ug-checking",
        ),
      ],
    };
    const s = fire(data, "cheaper_tier")!;
    // Netflix $17.99 against $8.99, ChatGPT $20 against $8.
    expect(s.worthCents).toBe((1_799 - 899) * 12 + (2_000 - 800) * 12);
    expect(s.title).toBe("Netflix and ChatGPT list cheaper plans than the ones you pay for");
    expect(s.why).toContain("lists Go at $8.00 a month");
    expect(s.more?.map((m) => m.href)).toEqual(CHEAPER_PLANS.map((p) => p.url));
    expectClean(s);
  });

  it("leaves out OpenAI API usage, which isn't the subscription", () => {
    const base = undergrad();
    const data = {
      ...base,
      transactions: [
        ...base.transactions.filter((t) => !/NETFLIX/.test(t.description)),
        row(
          "2026-11-12",
          4_210,
          "OPENAI API USAGE",
          "GENERAL_SERVICES_OTHER_GENERAL_SERVICES",
          "ug-checking",
        ),
      ],
    };
    expect(fire(data, "cheaper_tier")).toBeNull();
  });

  it("is nothing for someone already on Go", () => {
    const base = undergrad();
    const data = {
      ...base,
      transactions: [
        ...base.transactions.filter((t) => !/NETFLIX/.test(t.description)),
        row(
          "2026-11-12",
          920,
          "OPENAI *CHATGPT SUBSCR",
          "GENERAL_SERVICES_OTHER_GENERAL_SERVICES",
          "ug-checking",
        ),
      ],
    };
    expect(fire(data, "cheaper_tier")).toBeNull();
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
    expect(s.worthCents).toBe((1_799 - CHEAPER_PLANS[0].cents) * 12);
    expect(s.why).toContain("$8.99");
    expect(s.why).toContain("Change plan");
    expect(s.title).toBe("Netflix lists a cheaper plan than the one you pay for");
    expect(s.more?.[0]?.href).toBe(CHEAPER_PLANS[0].url);
    expectClean(s);
  });

  it("is nothing for someone already on it (with tax), or whose last charge is over 45 days old", () => {
    expect(fire(netflix(1_034), "cheaper_tier")).toBeNull();
    expect(fire(netflix(1_035), "cheaper_tier")).not.toBeNull();
    // 45 days before the newest line (Nov 17), where the data ends, not before today (gate C,
    // debug 3, 11-19: counted from today, a fixed history lost the card with the calendar).
    expect(fire(netflix(1_799, "2026-10-03"), "cheaper_tier")).not.toBeNull();
    expect(fire(netflix(1_799, "2026-10-02"), "cheaper_tier")).toBeNull();
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

describe("a monthly fee the person's own pay may already waive", () => {
  // Bank of America checking with a $12 fee on Nov 30 and pay deposited in the month before.
  const bofa = (pay: number[], fee = 1_200): ProfileInput => {
    const base = undergrad();
    return {
      ...base,
      accounts: [{ ...base.accounts[0]!, institution: null, name: "Bank of America checking" }],
      transactions: [
        ...base.transactions.filter(
          (t) => t.pfc !== "INCOME_WAGES" && !/SERVICE FEE/.test(t.description),
        ),
        row(
          "2026-11-16",
          fee,
          "MONTHLY MAINTENANCE FEE",
          "BANK_FEES_OTHER_BANK_FEES",
          "ug-checking",
        ),
        ...pay.map((cents, i) =>
          row(`2026-11-0${i + 1}`, -cents, "ACME CORP DES:PAYROLL", "INCOME_WAGES", "ug-checking"),
        ),
      ],
    };
  };

  it("sets the fee beside the bank's own rule and the pay that came in, and says the bank can say", () => {
    const s = fire(bofa([145_000]), "fee_waiver_met")!;
    expect(s).not.toBeNull();
    expect(s.worthCents).toBe(1_200 * 12);
    expect(s.title).toContain("one qualifying direct deposit of $250 or more");
    expect(s.why).toContain("$1,450.00 in pay was deposited there");
    expect(s.why).toContain("Bank of America can say which applies to yours");
    expect(s.action.href).toBe(FEE_WAIVERS[0].url);
    expectClean(s);
  });

  it("is nothing when the pay doesn't meet the rule: under $250 for BofA, under $500 at Chase", () => {
    expect(fire(bofa([24_999]), "fee_waiver_met")).toBeNull();
    expect(fire(bofa([25_000]), "fee_waiver_met")).not.toBeNull();
    // The undergraduate's Chase account: $412.50 of pay in the month before its fee.
    expect(fire(undergrad(), "fee_waiver_met")).toBeNull();
    const chase = (cents: number): ProfileInput => {
      const base = undergrad();
      return {
        ...base,
        transactions: [
          ...base.transactions,
          row(
            "2026-10-25",
            -(cents - 41_250),
            "STANFORD UNIVERSITY PAYROLL",
            "INCOME_WAGES",
            "ug-checking",
          ),
        ],
      };
    };
    expect(fire(chase(49_999), "fee_waiver_met")).toBeNull();
    expect(fire(chase(50_000), "fee_waiver_met")!.title).toContain("Chase Total Checking");
  });

  it("is nothing at a bank without a rule here, or with no monthly fee lately", () => {
    const base = bofa([145_000]);
    expect(
      fire(
        { ...base, accounts: [{ ...base.accounts[0]!, name: "Golden 1 checking" }] },
        "fee_waiver_met",
      ),
    ).toBeNull();
    expect(fire({ ...base, today: "2027-01-18" }, "fee_waiver_met")).toBeNull();
  });
});
