import { DETECTOR_RATES as R } from "@/config/detectors";
import { formatCents } from "@/lib/money";
import type { ProfileInput } from "@/profile/build";
import { type Detector, suggestionId } from "./contract";
import { evidence, factEvidence, outCents, tx, weakest } from "./helpers";

// Detectors for insurance (spec step 259), from what the profile knows: the covers whose
// charges are seen, the home, the car, the people and the assets. Each says what it is worth
// (a premium that comparing could trim, or a cost avoided), how sure Jane is, and why this
// person. Life and business cover are in home.ts and work.ts. The policy-by-policy checks (coverage checkup, claims, renewals, health year) need
// the policies themselves and run from the insurance lane's own snapshot; see
// docs/detectors/insurance.md. Pure; see ./contract.ts.

const OPEN_ENROLLMENT_FROM = "11-01";
const OPEN_ENROLLMENT_TO = "01-15";

// Charges for one kind of cover over the year seen, by what the statement says.
const charges = (data: ProfileInput, pattern: RegExp) =>
  tx(data, (t) => t.amountCents > 0 && pattern.test(t.description));
const AUTO_HOME = /\bAUTO\b|\bHOME\b|HOMEOWNERS|GEICO|PROGRESSIVE|STATE FARM|AAA|ALLSTATE|CHUBB/i;
const HEALTH = /HEALTHCARE|MARKETPLACE|BLUE CROSS|AETNA/i;
const MEDIGAP = /MEDIGAP|SUPPLEMENT/i;

const assets = (data: ProfileInput) =>
  data.accounts
    .filter((a) => a.type === "depository" || a.type === "investment")
    .reduce((s, a) => s + Math.max(0, a.balanceCents), 0);

// Whether today falls in the marketplace open enrollment (Nov 1 to Jan 15), or within a month
// of it, so a comparison is timely.
function enrollmentSoon(today: string): boolean {
  const md = today.slice(5);
  const [m] = md.split("-").map(Number);
  return md >= OPEN_ENROLLMENT_FROM || md <= OPEN_ENROLLMENT_TO || m === 10;
}

const rentersInsurance: Detector = {
  capability: "insurance",
  topic: "renters_insurance",
  needs: ["housing", "insurance_home"],
  detect({ profile }) {
    const housing = profile.facts.housing;
    const cover = profile.facts.insurance_home;
    if (housing.value !== "rent" || cover.value !== false) return null;
    return {
      id: suggestionId("insurance", "renters_insurance"),
      capability: "insurance",
      topic: "renters_insurance",
      title: "Cover your belongings with renters insurance",
      worthCents: R.rentersContentsCents,
      worthKind: "risk",
      confidence: weakest([
        factEvidence(housing),
        evidence("seen", profile.months, 0, "renters-cover charges"),
      ]),
      urgency: "later",
      why: `You rent and I see no renters-cover charge in ${profile.months} months. Your landlord's policy covers the building, not the ${formatCents(R.rentersContentsCents)} or so of belongings inside it. It usually costs under $20 a month.`,
      action: { label: "Get quotes", href: "/insurance" },
    };
  },
};

const autoInsurance: Detector = {
  capability: "insurance",
  topic: "auto_insurance",
  needs: ["has_car", "insurance_auto"],
  detect({ profile, data }) {
    const car = profile.facts.has_car;
    const cover = profile.facts.insurance_auto;
    if (car.value !== true || cover.value !== false) return null;
    // A car loan means the lender requires cover, so it exists somewhere Jane can't see.
    if (data.accounts.some((a) => a.subtype === "auto")) return null;
    return {
      id: suggestionId("insurance", "auto_insurance"),
      capability: "insurance",
      topic: "auto_insurance",
      title: "Check your car is insured",
      worthCents: R.autoLiabilityCents,
      worthKind: "risk",
      confidence: weakest([
        factEvidence(car),
        evidence("seen", profile.months, 0, "car-cover charges"),
      ]),
      urgency: "now",
      why: `I see car costs but no car-insurance charge in ${profile.months} months. If it's paid some other way, tell me and I'll stop asking. Without it, one accident could cost you ${formatCents(R.autoLiabilityCents)} or more.`,
      action: { label: "Add or compare car cover", href: "/insurance" },
    };
  },
};

const umbrella: Detector = {
  capability: "insurance",
  topic: "umbrella",
  needs: ["housing"],
  detect({ profile, data }) {
    const total = assets(data);
    if (total < R.umbrellaAssetsCents) return null;
    return {
      id: suggestionId("insurance", "umbrella"),
      capability: "insurance",
      topic: "umbrella",
      title: "Look at an umbrella policy",
      worthCents: total,
      worthKind: "risk",
      confidence: weakest([
        evidence("seen", profile.months, data.accounts.length, "account balances"),
        factEvidence(profile.facts.housing),
      ]),
      urgency: "later",
      why: `You have about ${formatCents(total)} in your accounts. A big liability claim above your car and home limits could reach it. An umbrella policy pays above those limits and usually costs a few hundred dollars a year.`,
      action: { label: "See umbrella cover", href: "/insurance" },
    };
  },
};

const insuranceShopping: Detector = {
  capability: "insurance",
  topic: "insurance_shopping",
  needs: ["insurance_auto", "insurance_home"],
  detect({ profile, data }) {
    const paid = charges(data, AUTO_HOME);
    const yearly = outCents(paid);
    if (paid.length < R.insuranceShopMinCharges || yearly < R.insuranceShopMinCents) return null;
    const saves = Math.round(yearly * R.insuranceShopShare);
    return {
      id: suggestionId("insurance", "insurance_shopping"),
      capability: "insurance",
      topic: "insurance_shopping",
      title: "Compare your car and home cover before it renews",
      worthCents: saves,
      worthKind: "saves",
      confidence: weakest([
        evidence("seen", profile.months, paid.length, "car and home cover charges"),
      ]),
      urgency: "later",
      why: `You paid ${formatCents(yearly)} for car and home cover over ${profile.months} months. Comparing the same cover usually finds up to ${formatCents(saves)} a year, and I do it for free before each renewal.`,
      action: { label: "Compare my cover", href: "/insurance" },
    };
  },
};

const healthInsurance: Detector = {
  capability: "insurance",
  topic: "health_insurance",
  needs: ["income_pattern", "insurance_health"],
  detect({ profile, data }) {
    const pattern = profile.facts.income_pattern;
    const cover = profile.facts.insurance_health;
    if (pattern.value !== "uneven" && pattern.value !== "business") return null;
    const paid = charges(data, HEALTH);
    const yearly = outCents(paid);
    const timely = enrollmentSoon(profile.today);
    if (cover.value === true && paid.length > 0) {
      const saves = Math.round(yearly * R.healthCompareShare);
      return {
        id: suggestionId("insurance", "health_insurance"),
        capability: "insurance",
        topic: "health_insurance",
        title: "Compare health plans at open enrollment",
        worthCents: saves,
        worthKind: "saves",
        confidence: weakest([
          factEvidence(pattern),
          evidence("seen", profile.months, paid.length, "health-plan charges"),
        ]),
        urgency: timely ? "soon" : "later",
        why: `You buy your own health plan and paid ${formatCents(yearly)} in ${profile.months} months. Comparing plans on what you'd really pay in a year, premium plus likely costs, can find up to ${formatCents(saves)} a year. Open enrollment runs Nov 1 to Jan 15.`,
        action: { label: "Compare plans", href: "/insurance" },
      };
    }
    if (cover.value === false) {
      return {
        id: suggestionId("insurance", "health_insurance"),
        capability: "insurance",
        topic: "health_insurance",
        title: "Get a health plan",
        worthCents: R.uninsuredStayCents,
        worthKind: "risk",
        confidence: weakest([
          factEvidence(pattern),
          evidence("seen", profile.months, 0, "health-plan charges"),
        ]),
        urgency: timely ? "soon" : "later",
        why: `You work for yourself, so no employer plan covers you, and I see no health-plan charge in ${profile.months} months. A hospital stay can cost tens of thousands of dollars. If a partner's plan covers you, tell me and I'll stop asking.`,
        action: { label: "Compare plans", href: "/insurance" },
      };
    }
    return null;
  },
};

const medigap: Detector = {
  capability: "insurance",
  topic: "medigap",
  needs: ["life_stage", "insurance_medigap"],
  detect({ profile, data }) {
    const stage = profile.facts.life_stage;
    const cover = profile.facts.insurance_medigap;
    if (stage.value !== "retired" || cover.value !== true) return null;
    const paid = charges(data, MEDIGAP);
    const yearly = outCents(paid);
    if (yearly <= 0) return null;
    const saves = Math.round(yearly * R.medigapCompareShare);
    return {
      id: suggestionId("insurance", "medigap"),
      capability: "insurance",
      topic: "medigap",
      title: "Compare your Medicare supplement",
      worthCents: saves,
      worthKind: "saves",
      confidence: weakest([
        factEvidence(stage),
        evidence("seen", profile.months, paid.length, "Medicare supplement charges"),
      ]),
      urgency: "later",
      why: `You paid ${formatCents(yearly)} for a Medicare supplement over ${profile.months} months. The same standard plan costs different amounts at different insurers, and prices rise with age, so comparing can find up to ${formatCents(saves)} a year.`,
      action: { label: "Compare supplements", href: "/insurance" },
    };
  },
};

const longTermCare: Detector = {
  capability: "insurance",
  topic: "long_term_care",
  needs: ["life_stage"],
  detect({ profile, data }) {
    const stage = profile.facts.life_stage;
    if (stage.value !== "approaching") return null;
    const total = assets(data);
    if (total < R.longTermCareMinAssetsCents) return null;
    const cost = R.longTermCareYearCents * R.longTermCareYears;
    return {
      id: suggestionId("insurance", "long_term_care"),
      capability: "insurance",
      topic: "long_term_care",
      title: "Think about long-term care before you retire",
      worthCents: cost,
      worthKind: "risk",
      confidence: weakest([
        factEvidence(stage),
        evidence("seen", profile.months, data.accounts.length, "account balances"),
      ]),
      urgency: "later",
      why: `You're close to retiring with about ${formatCents(total)} saved. Care at home or in a facility can cost about ${formatCents(R.longTermCareYearCents)} a year, and it's cheaper to plan for it before 65.`,
      action: { label: "Read about long-term care", href: "/insurance" },
    };
  },
};

export const INSURANCE_DETECTORS: readonly Detector[] = [
  rentersInsurance,
  autoInsurance,
  umbrella,
  insuranceShopping,
  healthInsurance,
  medigap,
  longTermCare,
];
