import { describe, expect, it } from "vitest";
import { PERSON_IDS } from "@/config/people";
import { buildProfile, type ProfileInput } from "@/profile/build";
import { inputFor } from "@/profile/sample";
import { parseProfile } from "./profile-intents";
import { profileReply } from "./replies-profile";
import { whoAmI } from "./who-am-i";

// "Give me a summary of who I am" (founder, 2026-10-26): short, warm and accurate, every claim
// traced to a fact, each said as sure as Jane is, nothing invented.

const profileOf = (id: string, told: ProfileInput["told"] = {}) => buildProfile(inputFor(id, told));

describe("who am I", () => {
  it("says the Reyes family has kids, a pet and a home of their own", () => {
    const { body, claims } = whoAmI(profileOf("family"));
    expect(body).toMatch(/You .*have kids at home.*own your home/);
    expect(body).toMatch(/have a pet/);
    expect(claims.map((c) => c.fact)).toEqual(
      expect.arrayContaining(["has_children", "has_pet", "housing"]),
    );
  });

  it("traces every claim to a fact Jane holds, and words it by how sure it is", () => {
    for (const id of PERSON_IDS) {
      const profile = profileOf(id);
      const { body, claims } = whoAmI(profile);
      for (const claim of claims) {
        const fact = profile.facts[claim.fact];
        expect(fact.value, `${id} ${claim.fact}`).not.toBeNull();
        expect(fact.value, `${id} ${claim.fact}`).not.toBe(false);
        expect(body, `${id}`).toContain(claim.text);
        // How it is said follows how sure Jane is: a guess is never in the plain sentence.
        const plain = body
          .split(/(?<=\.)\s/)
          .find((s) => s.startsWith("You ") && !/^You (?:probably|told)/.test(s));
        if (fact.source !== "told" && fact.confidence < 75 && plain) {
          expect(plain, `${id} ${claim.fact} is not sure`).not.toContain(claim.text);
        }
      }
    }
  });

  it("never says what it does not hold: no kids for someone with none, no pet, no student", () => {
    for (const id of PERSON_IDS.filter((p) => p !== "family")) {
      const { body } = whoAmI(profileOf(id));
      expect(body, id).not.toMatch(/kids at home|new baby|have a pet|student/);
    }
  });

  it("says nothing about health beyond what it costs, and has no figures to invent", () => {
    for (const id of PERSON_IDS) {
      const { body } = whoAmI(profileOf(id));
      expect(body, id).not.toMatch(/diagnos|condition|disease|religio|politic|immigra|sexual/i);
      expect(body, id).not.toMatch(/\d|\$/);
    }
    expect(whoAmI(profileOf("retiree")).body).toMatch(/spend a real share on health care/);
  });

  it("hedges a guess and trusts what the person told", () => {
    const told = whoAmI(profileOf("renter", { has_pet: true }));
    expect(told.body).toMatch(/You told me you have a pet/);
    // Four pet purchases inside one month, in a year of data: a guess.
    const day = (date: string, description: string) => ({
      date,
      amountCents: 4500,
      description,
      pfc: null,
      accountId: "a",
    });
    const guess = whoAmI(
      buildProfile({
        today: "2026-10-21",
        transactions: [
          day("2025-11-02", "SOME SHOP"),
          ...["2026-03-03", "2026-03-10", "2026-03-17", "2026-03-24"].map((d) =>
            day(d, "PETCO 1881"),
          ),
        ],
        accounts: [],
        liabilities: [],
        told: {},
      }),
    );
    expect(guess.body).toMatch(/I'm not sure, but you may have a pet/);
  });

  it("is short, warm and points to the profile to correct it", () => {
    const { body } = whoAmI(profileOf("family"));
    expect(body.split(/[.!?]\s/).length).toBeLessThanOrEqual(6);
    expect(body).toMatch(/^Here's the picture I have of you, from your payments\./);
    expect(body).toMatch(/correct it on your profile/);
    expect(profileReply(profileOf("family")).actions[0]).toMatchObject({ href: "/profile" });
  });

  it("knows it knows nothing yet", () => {
    const empty = buildProfile({
      today: "2026-10-21",
      transactions: [],
      accounts: [],
      liabilities: [],
      told: {},
    });
    expect(whoAmI(empty).body).toMatch(/don't know much about you yet/);
    expect(whoAmI(empty).claims).toEqual([]);
  });
});

describe("asking who I am", () => {
  it.each([
    "give me a summary of who I am",
    "who am I?",
    "tell me about myself",
    "what do you know about me",
    "Describe me",
    "what kind of person am I",
    "who do you think I am",
  ])("%s", (text) => {
    expect(parseProfile(text.toLowerCase())).toEqual({ kind: "profile" });
  });

  it("does not take a question about spending or a person's name for it", () => {
    expect(parseProfile("who am i paying on the 5th")).toBeNull();
    expect(parseProfile("tell me about my spending")).toBeNull();
  });
});
