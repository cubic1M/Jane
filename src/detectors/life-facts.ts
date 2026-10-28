import {
  PET_COVER_WORDS,
  PET_SIGNAL,
  PET_VET_BILL_CENTS,
  STUDENT_PLANS,
  STUDENT_PLAN_MIN_MONTHS,
} from "@/config/life-facts";
import { formatCents } from "@/lib/money";
import { hitsOf } from "@/profile/life-facts";
import { type Detector, suggestionId } from "./contract";
import { evidence, factEvidence, headlineOf, tx } from "./helpers";
import { CAPS, capped, combine } from "./insurance";

// Suggestions that exist because of what the profile knows about a person's life (founder,
// 2026-10-26: "adjust its suggestions to it"): cover for a pet only for someone who has one, and
// student plans only for a student. Each names the fact it rests on and takes its confidence,
// so a guess stays a guess. Pure; see ./contract.ts and docs/life-facts.md.

const petCover: Detector = {
  capability: "insurance",
  covers: [],
  topic: "pet_insurance",
  needs: ["has_pet"],
  detect({ profile, data }) {
    const pet = profile.facts.has_pet;
    if (pet.value !== true) return null;
    // Someone already paying a pet insurer needs nothing; someone in debt trouble needs the debt
    // plan before another monthly cost.
    if (
      tx(data, (t) => t.amountCents > 0 && PET_COVER_WORDS.test(t.description.toUpperCase()))
        .length > 0
    )
      return null;
    if (profile.facts.debt_trouble.value === true) return null;
    const seen = hitsOf(data.transactions, PET_SIGNAL);
    const spent = seen.txs.reduce((s, t) => s + t.amountCents, 0);
    return {
      id: suggestionId("insurance", "pet_insurance"),
      capability: "insurance",
      topic: "pet_insurance",
      title: "Cover your pet against a big vet bill",
      headline: headlineOf("Get pet insurance", PET_VET_BILL_CENTS, "risk"),
      short: `You've paid ${formatCents(spent)} in ${seen.matches} vet and pet payments and have no pet cover.`,
      worthCents: PET_VET_BILL_CENTS,
      worthKind: "risk",
      confidence: capped(
        combine([factEvidence(pet), evidence("seen", profile.months, 0, "pet-cover charges")]),
        CAPS.pet,
        "a vet bill that size is typical, not quoted",
      ),
      urgency: "later",
      why: `I see ${pet.evidence} and no pet-insurance charge. An emergency or surgery can cost ${formatCents(PET_VET_BILL_CENTS)} or more, and cover is much cheaper to start while your pet is healthy.`,
      action: { label: "See pet cover", href: "/insurance" },
    };
  },
};

const studentPlans: Detector = {
  capability: "subscriptions",
  covers: [],
  topic: "student_discounts",
  needs: ["is_student"],
  detect({ profile, data }) {
    const student = profile.facts.is_student;
    if (student.value !== true) return null;
    const paying = STUDENT_PLANS.filter((plan) => {
      const charges = tx(
        data,
        (t) => t.amountCents > 0 && plan.words.test(t.description.toUpperCase()),
      );
      return new Set(charges.map((t) => t.date.slice(0, 7))).size >= STUDENT_PLAN_MIN_MONTHS;
    });
    if (paying.length === 0) return null;
    const saves = paying.reduce((s, p) => s + p.yearlySavingCents, 0);
    const all = paying.map((p) => p.name);
    const names =
      all.length <= 1 ? all[0] : `${all.slice(0, -1).join(", ")} and ${all[all.length - 1]}`;
    return {
      id: suggestionId("subscriptions", "student_discounts"),
      capability: "subscriptions",
      topic: "student_discounts",
      title: "Switch to student plans",
      headline: headlineOf("Switch to student plans", saves, "saves"),
      short: `You pay for ${names}; each has a cheaper student plan.`,
      worthCents: saves,
      worthKind: "saves",
      confidence: combine([
        factEvidence(student),
        evidence("seen", profile.months, paying.length, "subscription charges"),
        { percent: 70, reason: "the student prices are typical list prices, not quoted" },
      ]),
      urgency: "later",
      why: `I see ${student.evidence}, and you pay for ${names}. Each has a student plan that usually costs about half, which comes to about ${formatCents(saves)} a year. You may need to verify you're a student.`,
      action: { label: "See my subscriptions", href: "/subscriptions" },
    };
  },
};

export const LIFE_FACT_DETECTORS: readonly Detector[] = [petCover, studentPlans];
