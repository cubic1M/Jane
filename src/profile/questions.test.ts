import { describe, expect, it } from "vitest";
import { PEOPLE } from "@/config/people";
import { QUESTIONS } from "@/config/questions";
import { buildProfile } from "./build";
import { bestQuestion, missingFacts } from "./questions";
import { inputFor } from "./sample";

// Spec step 257: each of the eight people is asked their highest-value question first, and
// nothing is asked twice.

describe("the one question worth asking", () => {
  it.each(PEOPLE)("$id is asked $firstQuestion first", (person) => {
    const data = inputFor(person.id);
    const profile = buildProfile(data);
    const best = bestQuestion(profile, data, new Set());
    expect(
      best?.spec.fact,
      JSON.stringify(missingFacts(profile, data).map((m) => [m.spec.fact, m.unlockCents])),
    ).toBe(person.firstQuestion ?? undefined);
    if (best) expect(best.unlockCents).toBeGreaterThan(0);
  });

  it("goes down the list as each is asked, never repeating, until none are left", () => {
    for (const person of PEOPLE) {
      const data = inputFor(person.id);
      const profile = buildProfile(data);
      const asked = new Set<string>();
      const order: string[] = [];
      for (;;) {
        const next = bestQuestion(profile, data, asked);
        if (!next) break;
        expect(asked.has(next.spec.fact), `${person.id} asked ${next.spec.fact} twice`).toBe(false);
        asked.add(next.spec.fact);
        order.push(next.spec.fact);
      }
      expect(order[0]).toBe(person.firstQuestion ?? undefined);
      // Most valuable first.
      const values = missingFacts(profile, data).map((m) => m.unlockCents);
      expect(values).toEqual([...values].sort((a, b) => b - a));
    }
  });

  it("doesn't ask what the profile already knows, and uses the answer for the life stage", () => {
    const data = inputFor("renter", { employer_match: "yes" });
    const profile = buildProfile(data);
    expect(missingFacts(profile, data).some((m) => m.spec.fact === "employer_match")).toBe(false);
    expect(profile.facts.employer_match).toMatchObject({
      value: "yes",
      source: "told",
      confidence: 100,
    });
    const near = buildProfile(inputFor("preretire", { age_band: "58_to_65" }));
    expect(near.facts.life_stage.value).toBe("approaching");
    expect(buildProfile(inputFor("renter", { age_band: "under_30" })).facts.life_stage.value).toBe(
      "starting",
    );
  });

  it("has at most four answers and a fact for each question", () => {
    for (const q of QUESTIONS) {
      expect(q.choices.length).toBeGreaterThan(0);
      expect(q.choices.length).toBeLessThanOrEqual(4);
      const data = inputFor("family");
      expect(buildProfile(data).facts[q.fact]).toBeDefined();
    }
  });
});
