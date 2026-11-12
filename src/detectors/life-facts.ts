import {
  PET_COVER_WORDS,
  PET_SIGNAL,
  PET_VET_BILL_CENTS,
  STUDENT_PLAN_PRICE_ROOM,
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
  detect({ profile, data, market }) {
    const student = profile.facts.is_student;
    if (student.value !== true) return null;
    // Today's prices where the catalog has them (read from each service's own page); without a
    // catalog, the typical prices. With one, a service whose prices aren't live isn't suggested.
    const priced = STUDENT_PLANS.flatMap((plan) => {
      if (!market) return [{ ...plan, checked: null }];
      const at = (which: "individual" | "student") =>
        market.plans.find((p) => p.merchantKey === plan.merchantKey && p.plan === which);
      const full = at("individual");
      const cheap = at("student");
      if (!full || !cheap || full.cents <= cheap.cents) return [];
      return [
        {
          ...plan,
          studentMonthlyCents: cheap.cents,
          yearlySavingCents: (full.cents - cheap.cents) * 12,
          // A hand-kept price (the catalog's first rows) says no source: it's a typical price.
          checked: /^https?:\/\//.test(cheap.sourceUrl)
            ? { on: cheap.checkedAt.slice(0, 10), from: new URL(cheap.sourceUrl).hostname }
            : null,
        },
      ];
    });
    const paying = priced.filter((plan) => {
      const charges = tx(
        data,
        (t) => t.amountCents > 0 && plan.words.test(t.description.toUpperCase()),
      );
      if (new Set(charges.map((t) => t.date.slice(0, 7))).size < STUDENT_PLAN_MIN_MONTHS) {
        return false;
      }
      // Already on the student plan, by what they pay now: a statement rarely says so.
      const latest = charges.reduce((a, b) => (b.date > a.date ? b : a));
      return latest.amountCents > plan.studentMonthlyCents * STUDENT_PLAN_PRICE_ROOM;
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
        paying.every((p) => p.checked)
          ? { percent: 85, reason: "the prices were read from each service's own page" }
          : { percent: 70, reason: "the student prices are typical list prices, not quoted" },
      ]),
      urgency: "later",
      why: `I see ${student.evidence}, and you pay for ${names}. Each has a student plan that usually costs about half, which comes to about ${formatCents(saves)} a year. You may need to verify you're a student.${checkedLine(paying)}`,
      action: { label: "See my subscriptions", href: "/subscriptions" },
    };
  },
};

// "Prices checked Nov 12 from spotify.com and apple.com", when they came from the catalog.
function checkedLine(plans: readonly { checked: { on: string; from: string } | null }[]): string {
  const checked = plans.flatMap((p) => (p.checked ? [p.checked] : []));
  if (checked.length === 0) return "";
  const on = checked.map((c) => c.on).sort()[0] as string;
  const from = [...new Set(checked.map((c) => c.from.replace(/^www\./, "")))].join(" and ");
  return ` Prices checked ${shortDay(on)} from ${from}.`;
}

const shortDay = (iso: string) =>
  new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });

export const LIFE_FACT_DETECTORS: readonly Detector[] = [petCover, studentPlans];
