import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));

import { PEOPLE } from "@/config/people";
import { buildProfile, type ProfileInput } from "@/profile/build";
import { inputFor } from "@/profile/sample";
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
    ["family", "fsa_deadline"],
    ["family", "deductible_met"],
    ["family", "medical_bill_dispute"],
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
    ["renter", "fsa_deadline"],
    ["retiree", "deductible_met"],
    ["freelancer", "medical_bill_dispute"],
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

  it("values a risk as the expected yearly loss, never the whole loss", () => {
    const [renters] = firedFor("renter", "renters_insurance");
    expect(renters.worthCents).toBe(Math.round(3_000_000 * 0.03));
    const [ltc] = firedFor("preretire", "long_term_care");
    expect(ltc.worthCents).toBe(Math.round((21_600_000 * 0.2) / 10));
    const [umbrella] = firedFor("preretire", "umbrella");
    expect(umbrella.worthCents).toBeLessThan(500_000_000 * 0.01);
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

  it("values life and business cover as an expected yearly loss, not the whole loss", () => {
    const family = reportFor(PEOPLE.find((x) => x.id === "family")!).fired.find(
      (s) => s.topic === "life_insurance",
    )!;
    expect(family.worthCents).toBeLessThan(1_000_000);
    const owner = reportFor(PEOPLE.find((x) => x.id === "owner")!).fired.find(
      (s) => s.topic === "business_insurance",
    )!;
    expect(owner.worthCents).toBe(200_000);
  });
});

describe("the health year, unasked", () => {
  it("says the FSA money left and its date, with urgency rising toward it", () => {
    const [s] = firedFor("family", "fsa_deadline");
    expect(s.why).toMatch(/\$2,400\.00 for your FSA/);
    expect(s.why).toMatch(/lost after Dec 31 \(75 days\)/);
    // 75 days away: later; inside 60 it is soon, inside 30 now.
    expect(s.urgency).toBe("later");
    expect(s.confidence.percent).toBeLessThanOrEqual(70);
    expect(s.confidence.reason).toMatch(/can't see your FSA claims/);
  });

  it("raises a bill above the plan's share for the team, not for an in-network provider's due", () => {
    const [s] = firedFor("family", "medical_bill_dispute");
    expect(s.why).toMatch(/Bayview Imaging Center billed \$2,100\.00/);
    expect(s.worthCents).toBeGreaterThan(10_000);
  });

  it("says planned care is cheaper once the deductible is met, in the last months only", () => {
    const [s] = firedFor("family", "deductible_met");
    expect(s.why).toMatch(/paid your whole \$1,500\.00 deductible/);
    const data = { ...inputFor("family"), today: "2026-08-17" };
    const d = INSURANCE_DETECTORS.find((x) => x.topic === "deductible_met")!;
    expect(d.detect({ profile: buildProfile(data), data })).toBeNull();
  });

  it("says nothing without the plan's terms", () => {
    const data = { ...inputFor("family"), healthPlan: null, fsaElectionCents: null };
    const profile = buildProfile(data);
    for (const topic of ["fsa_deadline", "deductible_met", "medical_bill_dispute"]) {
      const d = INSURANCE_DETECTORS.find((x) => x.topic === topic)!;
      expect(d.detect({ profile, data }), topic).toBeNull();
    }
  });
});
