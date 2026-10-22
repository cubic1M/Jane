import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));

import { PEOPLE } from "@/config/people";
import { buildProfile, type ProfileInput } from "@/profile/build";
import { inputFor } from "@/profile/sample";
import { pickForToday, rankSuggestions } from "@/planning/suggestion-rank";
import { INSURANCE_DETECTORS } from "./insurance";
import { reportFor } from "./harness";
import { detectorsFor } from "./index";

// Insurance, proactive (spec step 259): each detector on the eight sample people.

const topics: string[] = INSURANCE_DETECTORS.map((d) => d.topic);
const firedFor = (id: string, topic: string, told: ProfileInput["told"] = {}) => {
  const data = inputFor(id, told);
  const profile = buildProfile(data);
  return INSURANCE_DETECTORS.filter((d) => d.topic === topic).flatMap((d) => {
    const s = d.detect({ profile, data });
    return s ? [s] : [];
  });
};

describe("the insurance detectors", () => {
  it("belong to the insurance capability, each topic once", () => {
    expect(detectorsFor("insurance").map((d) => d.topic)).toEqual(expect.arrayContaining(topics));
    expect(new Set(topics).size).toBe(topics.length);
  });

  it.each([
    ["renter", "renters_insurance"],
    ["freelancer", "health_insurance"],
    ["preretire", "long_term_care"],
    ["retiree", "medigap"],
    ["family", "insurance_shopping"],
    ["preretire", "umbrella"],
    ["renter", "insurance_negotiation"],
    ["family", "insurance_claim"],
    ["renter", "cover_change"],
    ["equity", "card_cover"],
    ["preretire", "employer_benefits"],
    ["retiree", "policy_documents"],
    ["freelancer", "auto_insurance"],
  ] as const)("reaches %s with %s", (person, topic) => {
    const [s] = firedFor(person, topic);
    expect(s, `${person} ${topic}`).toBeDefined();
    expect(s.worthCents).toBeGreaterThan(0);
    expect(s.confidence.percent).toBeGreaterThan(0);
    expect(s.confidence.reason.length).toBeGreaterThan(5);
    expect(s.why).toMatch(/\$|\d/);
  });

  it.each([
    ["family", "renters_insurance"],
    ["retiree", "renters_insurance"],
    ["renter", "umbrella"],
    ["renter", "long_term_care"],
    ["retiree", "long_term_care"],
    ["family", "medigap"],
    ["debt", "insurance_shopping"],
    ["debt", "auto_insurance"],
    ["owner", "auto_insurance"],
    ["family", "health_insurance"],
    ["family", "insurance_negotiation"],
    ["retiree", "insurance_claim"],
    ["renter", "insurance_claim"],
    ["family", "cover_change"],
    ["retiree", "card_cover"],
    ["debt", "card_cover"],
    ["retiree", "employer_benefits"],
    ["freelancer", "employer_benefits"],
    ["family", "policy_documents"],
  ] as const)("does not reach %s with %s", (person, topic) => {
    expect(firedFor(person, topic)).toEqual([]);
  });

  it("gives the same percentage for the same evidence", () => {
    for (const p of PEOPLE) {
      const a = reportFor(p).fired.filter((s) => topics.includes(s.topic));
      const b = reportFor(p).fired.filter((s) => topics.includes(s.topic));
      expect(a).toEqual(b);
    }
  });

  it("never tells a person something their list forbids", () => {
    for (const p of PEOPLE) {
      const wrong = reportFor(p).wrong.filter((s) => s.capability === "insurance");
      expect(
        wrong.map((s) => s.topic),
        p.id,
      ).toEqual([]);
    }
  });

  it("makes every insurance suggestion a person should have", () => {
    const insuranceTopics = new Set([
      "health_insurance",
      "life_insurance",
      "long_term_care",
      "medigap",
      "business_insurance",
    ]);
    for (const p of PEOPLE) {
      const r = reportFor(p);
      const should = p.should.filter((t) => insuranceTopics.has(t));
      expect(r.hit.filter((t) => insuranceTopics.has(t)).sort(), p.id).toEqual(should.sort());
    }
  });

  it("says the open enrollment window for health plans, and that it is a comparison", () => {
    const [s] = firedFor("freelancer", "health_insurance");
    expect(s.title).toMatch(/Compare health plans/);
    expect(s.why).toMatch(/Nov 1 to Jan 15/);
    expect(s.urgency).toBe("soon");
  });
});

describe("the policy-by-policy detectors in their own words", () => {
  it("asks for a better rate only when the premium rose", () => {
    const [s] = firedFor("renter", "insurance_negotiation");
    expect(s.worthCents).toBe((13_100 - 11_800) * 12);
    expect(s.why).toMatch(/\$118\.00 to \$131\.00 a month/);
  });

  it("raises an unclaimed repair after the deductible, urgently", () => {
    const [s] = firedFor("family", "insurance_claim");
    expect(s.worthCents).toBe(310_000 - 100_000);
    expect(s.urgency).toBe("now");
  });

  it("is quiet about a repair once a claim payout is seen", () => {
    const data = inputFor("family");
    data.transactions = [
      ...data.transactions,
      {
        date: "2026-10-10",
        amountCents: -250_000,
        description: "STATE FARM CLAIM PAYMENT",
        pfc: "INCOME_OTHER_INCOME",
        accountId: data.accounts[0].id,
      },
    ];
    const profile = buildProfile(data);
    const d = INSURANCE_DETECTORS.find((x) => x.topic === "insurance_claim")!;
    expect(d.detect({ profile, data })).toBeNull();
  });

  it("cancels a protection plan a premium card likely covers", () => {
    const [s] = firedFor("equity", "card_cover");
    expect(s.worthCents).toBe(1_700 * 12);
  });

  it("compares private cover with the employer's, up to half", () => {
    const [s] = firedFor("preretire", "employer_benefits");
    expect(s.worthCents).toBe(Math.round(11_000 * 12 * 0.5));
  });

  it("raises an unread policy document only with insurance charges to compare", () => {
    const [s] = firedFor("retiree", "policy_documents");
    expect(s.confidence.reason).toMatch(/1 document you uploaded|insurance charges/);
    const data = { ...inputFor("retiree"), unreadPolicyDocuments: 0 };
    const d = INSURANCE_DETECTORS.find((x) => x.topic === "policy_documents")!;
    expect(d.detect({ profile: buildProfile(data), data })).toBeNull();
  });
});

describe("the figures are the person's own", () => {
  it("counts only premiums as car and home cover: Priya pays Chubb $410 a month, not a home-store total", () => {
    const [s] = firedFor("equity", "insurance_shopping");
    expect(s.why).toContain("$4,920.00");
    expect(s.worthCents).toBe(Math.round(492_000 * 0.1));
  });

  it("shows the whole loss and leaves the yearly chance to the ranking", () => {
    const [renters] = firedFor("renter", "renters_insurance");
    expect(renters.worthCents).toBe(3_000_000);
    expect(renters.worthIsExpected).toBeUndefined();
    const [ltc] = firedFor("preretire", "long_term_care");
    expect(ltc.worthCents).toBe(21_600_000);
    // $30,000 at 3% a year is a $900 expected loss: it ranks, but not in Maya's top three, which
    // are real money. An uninsured car is required, so it leads for Sam.
    const top = (id: string) =>
      pickForToday(rankSuggestions(reportFor(PEOPLE.find((x) => x.id === id)!).fired)).map(
        (r) => r.suggestion.topic,
      );
    expect(top("renter")).not.toContain("renters_insurance");
    expect(top("freelancer")[0]).toBe("auto_insurance");
    expect(top("owner")[0]).toBe("business_insurance");
  });
});

describe("how sure Jane is", () => {
  it("never states a typical saving or an unseen benefit with more certainty than its ceiling", () => {
    const caps = {
      insurance_shopping: 70,
      health_insurance: 70,
      medigap: 70,
      insurance_negotiation: 75,
      insurance_claim: 65,
      card_cover: 55,
      employer_benefits: 60,
      policy_documents: 75,
    } as const;
    for (const p of PEOPLE) {
      for (const s of reportFor(p).fired) {
        const cap = caps[s.topic as keyof typeof caps];
        if (cap) expect(s.confidence.percent, `${p.id} ${s.topic}`).toBeLessThanOrEqual(cap);
      }
    }
  });

  it("names every piece of evidence in the reason, and says why it was capped", () => {
    const [s] = firedFor("equity", "card_cover");
    expect(s.confidence.percent).toBe(55);
    expect(s.confidence.reason).toMatch(
      /protection-plan charges.*premium-card fees?.*card's actual benefits/,
    );
  });

  it("shows life and business cover at their whole loss, and marks a missing car or business cover as required", () => {
    const find = (id: string, topic: string) =>
      reportFor(PEOPLE.find((x) => x.id === id)!).fired.find((x) => x.topic === topic)!;
    expect(find("family", "life_insurance").worthCents).toBe(
      (buildProfile(inputFor("family")).facts.monthly_income.value as number) * 12 * 10,
    );
    const owner = find("owner", "business_insurance");
    expect(owner.worthCents).toBe(5_000_000);
    expect(owner.required).toBe(true);
    expect(firedFor("freelancer", "auto_insurance")[0].required).toBe(true);
    expect(firedFor("renter", "renters_insurance")[0].required).toBeUndefined();
  });
});

describe("the umbrella suggestion follows the need calculator (insurance QA pass)", () => {
  it("is not offered on gross balances when the net worth after debts is under the line", () => {
    // The sample family has $108k in the bank and investments, a home and a $338k mortgage.
    const data = inputFor("family");
    const profile = buildProfile(data);
    const umbrella = INSURANCE_DETECTORS.find((d) => d.topic === "umbrella")!;
    expect(umbrella.detect({ profile, data })).toBeNull();
  });
  it("counts the home: the retiree's net worth is over the line, and the figure is the need's", () => {
    const data = inputFor("retiree");
    const profile = buildProfile(data);
    const umbrella = INSURANCE_DETECTORS.find((d) => d.topic === "umbrella")!;
    const s = umbrella.detect({ profile, data });
    expect(s?.short).toContain("$856,994.00");
    expect(s?.why).toContain("what you own less what you owe");
  });
});
