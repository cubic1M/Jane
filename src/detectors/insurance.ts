import { DETECTOR_RATES as R } from "@/config/detectors";
import { formatCents } from "@/lib/money";
import type { ProfileInput } from "@/profile/build";
import { type Detector, suggestionId } from "./contract";
import type { Confidence } from "./contract";
import { evidence, factEvidence, outCents, tx } from "./helpers";

// Detectors for insurance (spec step 259), from what the profile knows: the covers whose
// charges are seen, the home, the car, the people and the assets. Each says what it is worth
// (a premium that comparing could trim, or a cost avoided), how sure Jane is, and why this
// person. Life and business cover are in home.ts and work.ts. The policy-by-policy checks (coverage checkup, claims, renewals, health year) need
// the policies themselves and run from the insurance lane's own snapshot; see
// docs/detectors/insurance.md. Pure; see ./contract.ts.

// The weakest piece of evidence sets the percentage, and every piece is named in the reason.
function combine(parts: readonly Confidence[]): Confidence {
  const percent = Math.min(...parts.map((p) => p.percent));
  return { percent, reason: parts.map((p) => p.reason).join("; ") };
}
// A ceiling for a suggestion whose amount is typical, not quoted (see DETECTOR_RATES.insuranceCaps).
function capped(c: Confidence, max: number, note: string): Confidence {
  return c.percent <= max ? c : { percent: max, reason: `${c.reason}; ${note}` };
}
const CAPS = R.insuranceCaps;

// A name as people say it: "COUNTY LIBRARY" -> "County Library".
const plain = (name: string) => name.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());

const OPEN_ENROLLMENT_FROM = "11-01";
const OPEN_ENROLLMENT_TO = "01-15";

// Charges for one kind of cover over the year seen, by what the statement says.
const charges = (data: ProfileInput, pattern: RegExp) =>
  tx(data, (t) => t.amountCents > 0 && pattern.test(t.description));
// Premiums only: charges in the insurance category, so "HOME DEPOT" is not home cover.
const premiums = (data: ProfileInput, pattern: RegExp) =>
  tx(
    data,
    (t) =>
      t.amountCents > 0 && t.pfc === "GENERAL_SERVICES_INSURANCE" && pattern.test(t.description),
  );
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
  covers: ["insurance_policies"],
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
      worthCents: Math.round(R.rentersContentsCents * R.rentersClaimChance),
      worthKind: "risk",
      confidence: combine([
        factEvidence(housing),
        evidence("seen", profile.months, 0, "renters-cover charges"),
      ]),
      urgency: "later",
      why: `You rent and I see no renters-cover charge in ${profile.months} months. Your landlord's policy covers the building, not the ${formatCents(R.rentersContentsCents)} or so of belongings inside it. A fire or a break-in in a given year is unlikely (about ${Math.round(R.rentersClaimChance * 100)}%), and renters cover usually costs under $20 a month.`,
      action: { label: "Get quotes", href: "/insurance" },
    };
  },
};

const autoInsurance: Detector = {
  capability: "insurance",
  covers: ["insurance_policies"],
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
      worthCents: Math.round(R.autoLiabilityCents * R.autoAtFaultChance),
      worthKind: "risk",
      confidence: combine([
        factEvidence(car),
        evidence("seen", profile.months, 0, "car-cover charges"),
      ]),
      urgency: "now",
      why: `I see car costs but no car-insurance charge in ${profile.months} months. If it's paid some other way, tell me and I'll stop asking. Without it, an accident you cause (about ${Math.round(R.autoAtFaultChance * 100)}% of drivers have one in a year) could cost you ${formatCents(R.autoLiabilityCents)} or more.`,
      action: { label: "Add or compare car cover", href: "/insurance" },
    };
  },
};

const umbrella: Detector = {
  capability: "insurance",
  covers: ["insurance_policies"],
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
      worthCents: Math.round(total * R.umbrellaLawsuitChance),
      worthKind: "risk",
      confidence: combine([
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
  covers: ["insurance_quotes", "insurance_savings"],
  topic: "insurance_shopping",
  needs: ["insurance_auto", "insurance_home"],
  detect({ profile, data }) {
    const paid = premiums(data, AUTO_HOME);
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
      confidence: capped(
        combine([evidence("seen", profile.months, paid.length, "car and home cover charges")]),
        CAPS.shopping,
        "the saving is typical, not quoted",
      ),
      urgency: "later",
      why: `You paid ${formatCents(yearly)} for car and home cover over ${profile.months} months. Comparing the same cover usually finds up to ${formatCents(saves)} a year, and I do it for free before each renewal.`,
      action: { label: "Compare my cover", href: "/insurance" },
    };
  },
};

const healthInsurance: Detector = {
  capability: "insurance",
  covers: ["insurance_quotes"],
  topic: "health_insurance",
  needs: ["income_pattern", "insurance_health"],
  detect({ profile, data }) {
    const pattern = profile.facts.income_pattern;
    const cover = profile.facts.insurance_health;
    if (pattern.value !== "uneven" && pattern.value !== "business") return null;
    const paid = premiums(data, HEALTH);
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
        confidence: capped(
          combine([
            factEvidence(pattern),
            evidence("seen", profile.months, paid.length, "health-plan charges"),
          ]),
          CAPS.health,
          "the saving is typical, and I can't see a partner's plan",
        ),
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
        worthCents: Math.round(R.uninsuredStayCents * R.hospitalStayChance),
        worthKind: "risk",
        confidence: capped(
          combine([
            factEvidence(pattern),
            evidence("seen", profile.months, 0, "health-plan charges"),
          ]),
          CAPS.health,
          "the saving is typical, and I can't see a partner's plan",
        ),
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
  covers: ["insurance_quotes"],
  topic: "medigap",
  needs: ["life_stage", "insurance_medigap"],
  detect({ profile, data }) {
    const stage = profile.facts.life_stage;
    const cover = profile.facts.insurance_medigap;
    if (stage.value !== "retired" || cover.value !== true) return null;
    const paid = premiums(data, MEDIGAP);
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
      confidence: capped(
        combine([
          factEvidence(stage),
          evidence("seen", profile.months, paid.length, "Medicare supplement charges"),
        ]),
        CAPS.medigap,
        "the saving is typical, not quoted",
      ),
      urgency: "later",
      why: `You paid ${formatCents(yearly)} for a Medicare supplement over ${profile.months} months. The same standard plan costs different amounts at different insurers, and prices rise with age, so comparing can find up to ${formatCents(saves)} a year.`,
      action: { label: "Compare supplements", href: "/insurance" },
    };
  },
};

const longTermCare: Detector = {
  capability: "insurance",
  covers: ["insurance_checkup"],
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
      worthCents: Math.round((cost * R.longTermCareChanceOverWindow) / R.longTermCareWindowYears),
      worthKind: "risk",
      confidence: combine([
        factEvidence(stage),
        evidence("seen", profile.months, data.accounts.length, "account balances"),
      ]),
      urgency: "later",
      why: `You're close to retiring with about ${formatCents(total)} saved. Care at home or in a facility can cost about ${formatCents(R.longTermCareYearCents)} a year, and it's cheaper to plan for it before 65.`,
      action: { label: "Read about long-term care", href: "/insurance" },
    };
  },
};

const daysBetween = (from: string, to: string) =>
  Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000);
const median = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
};

// Spec step 259, the policy-by-policy checks Jane can see in the charges.

// A premium that went up at its last charge: worth asking the insurer for a better rate.
const insuranceNegotiation: Detector = {
  capability: "insurance",
  covers: ["insurance_negotiations"],
  topic: "insurance_negotiation",
  needs: ["insurance_auto", "insurance_home"],
  detect({ profile, data }) {
    const byName = new Map<string, { date: string; cents: number }[]>();
    for (const t of premiums(data, AUTO_HOME)) {
      const list = byName.get(t.description) ?? [];
      list.push({ date: t.date, cents: t.amountCents });
      byName.set(t.description, list);
    }
    for (const [name, list] of byName) {
      if (list.length < R.negotiationMinCharges) continue;
      const sorted = [...list].sort((a, b) => a.date.localeCompare(b.date));
      const last = sorted[sorted.length - 1];
      const before = median(sorted.slice(0, -1).map((c) => c.cents));
      if (before <= 0 || last.cents < before * (1 + R.negotiationMinRise)) continue;
      const yearly = (last.cents - before) * 12;
      return {
        id: suggestionId("insurance", "insurance_negotiation"),
        capability: "insurance",
        topic: "insurance_negotiation",
        title: "Ask your insurer for a better rate",
        worthCents: yearly,
        worthKind: "saves",
        confidence: capped(
          combine([evidence("seen", profile.months, list.length, "charges from the same insurer")]),
          CAPS.negotiation,
          "a call may not change the price",
        ),
        urgency: "soon",
        why: `${plain(name)} went from ${formatCents(before)} to ${formatCents(last.cents)} a month, ${formatCents(yearly)} more a year. A call, with a same-cover quote from another insurer in hand, often brings it back down.`,
        action: { label: "Call them for me", href: "/insurance" },
      };
    }
    return null;
  },
};

// A repair or loss paid out of pocket on a policy that may have covered it.
const REPAIR = /COLLISION|BODY SHOP|AUTO BODY|TOWING|ROOF|WATER DAMAGE|RESTORATION|HAIL/i;
const CLAIM_PAID = /CLAIM|INSURANCE PAYMENT|INS PAYOUT|INSURANCE PAYOUT/i;
const insuranceClaim: Detector = {
  capability: "insurance",
  covers: ["insurance_claims"],
  topic: "insurance_claim",
  needs: ["insurance_auto", "insurance_home"],
  detect({ profile, data }) {
    const insured = premiums(data, AUTO_HOME);
    if (insured.length === 0) return null;
    if (tx(data, (t) => t.amountCents < 0 && CLAIM_PAID.test(t.description)).length > 0)
      return null;
    const repairs = charges(data, REPAIR).filter(
      (t) =>
        daysBetween(t.date, profile.today) <= R.claimWindowDays &&
        t.amountCents > R.claimDeductibleCents,
    );
    if (repairs.length === 0) return null;
    const top = repairs.reduce((a, b) => (b.amountCents > a.amountCents ? b : a));
    const recover = top.amountCents - R.claimDeductibleCents;
    return {
      id: suggestionId("insurance", "insurance_claim"),
      capability: "insurance",
      topic: "insurance_claim",
      title: "Check whether this repair was a claim",
      worthCents: recover,
      worthKind: "saves",
      confidence: capped(
        combine([
          evidence("seen", profile.months, insured.length, "car and home cover charges"),
          evidence("seen", profile.months, repairs.length, "repair charges and no claim payout"),
        ]),
        CAPS.claim,
        "it depends on what your policy covers",
      ),
      urgency: "now",
      why: `You paid ${formatCents(top.amountCents)} to ${plain(top.description)} on ${top.date} and I see no insurance payout. After a typical ${formatCents(R.claimDeductibleCents)} deductible a claim could return about ${formatCents(recover)}; claims have notice deadlines.`,
      action: { label: "Start a claim", href: "/insurance/claims" },
    };
  },
};

// A move or a bought car the insurer hasn't been told about.
const LIFE_EVENT =
  /U-?HAUL|MOVING|MOVERS|TWO MEN AND A TRUCK|\bPODS\b|CARMAX|AUTO SALES|AUTO GROUP/i;
const coverChange: Detector = {
  capability: "insurance",
  covers: ["insurance_cover_changes"],
  topic: "cover_change",
  needs: ["insurance_auto", "insurance_home"],
  detect({ profile, data }) {
    const insured = premiums(data, /AUTO|HOME|RENTERS|PROGRESSIVE|GEICO|STATE FARM|LEMONADE/i);
    if (insured.length === 0) return null;
    const events = charges(data, LIFE_EVENT).filter(
      (t) => daysBetween(t.date, profile.today) <= R.coverChangeWindowDays,
    );
    if (events.length === 0) return null;
    const event = events[0];
    return {
      id: suggestionId("insurance", "cover_change"),
      capability: "insurance",
      topic: "cover_change",
      title: "Tell your insurer about your move",
      worthCents: Math.round(R.rentersContentsCents * R.coverChangeClaimChance),
      worthKind: "risk",
      confidence: combine([
        evidence("seen", profile.months, insured.length, "cover charges"),
        evidence("seen", profile.months, events.length, "moving or car-purchase charges"),
      ]),
      urgency: "soon",
      why: `You paid ${plain(event.description)} ${formatCents(event.amountCents)} on ${event.date}. A policy with your old address or without your new car can leave a claim in doubt, and the change is usually free.`,
      action: { label: "See the changes", href: "/insurance" },
    };
  },
};

// A protection plan paid for, and a premium card that likely already gives it.
const PROTECTION =
  /ASURION|SQUARETRADE|APPLECARE|PROTECTION PLAN|DEVICE PROTECTION|RENTAL CAR INS/i;
const PREMIUM_CARD = /SAPPHIRE|PLATINUM|RESERVE|VENTURE X|ANNUAL FEE/i;
const cardCover: Detector = {
  capability: "insurance",
  covers: ["insurance_card_cover"],
  topic: "card_cover",
  needs: [],
  detect({ profile, data }) {
    const plans = charges(data, PROTECTION);
    const fee = charges(data, PREMIUM_CARD);
    if (plans.length === 0 || fee.length === 0) return null;
    const yearly = outCents(plans);
    return {
      id: suggestionId("insurance", "card_cover"),
      capability: "insurance",
      topic: "card_cover",
      title: "Check your card already covers this",
      worthCents: yearly,
      worthKind: "saves",
      confidence: capped(
        combine([
          evidence("seen", profile.months, plans.length, "protection-plan charges"),
          evidence("seen", profile.months, fee.length, "premium-card fees"),
        ]),
        CAPS.cardCover,
        "I can't see your card's actual benefits",
      ),
      urgency: "later",
      why: `You paid ${formatCents(yearly)} for a protection plan over ${profile.months} months, and you hold a premium card whose benefits often cover phones and trips bought with it. If yours does, the plan can be cancelled.`,
      action: { label: "See what your card covers", href: "/insurance" },
    };
  },
};

// A private plan while an employer is likely to offer one.
const PRIVATE_PLAN = /LIFE|TERM|HEALTHCARE|MARKETPLACE|BLUE CROSS|AETNA|INDIVIDUAL PLAN/i;
const employerBenefits: Detector = {
  capability: "insurance",
  covers: ["insurance_benefits"],
  topic: "employer_benefits",
  needs: ["income_pattern", "employer"],
  detect({ profile, data }) {
    const pattern = profile.facts.income_pattern;
    const employer = profile.facts.employer;
    if (pattern.value !== "salary" || typeof employer.value !== "string") return null;
    const paid = charges(data, PRIVATE_PLAN).filter(
      (t) => t.pfc === "GENERAL_SERVICES_INSURANCE" || /LIFE|HEALTH/i.test(t.description),
    );
    const yearly = outCents(paid);
    if (paid.length === 0 || yearly <= 0) return null;
    const saves = Math.round(yearly * R.employerPlanShare);
    return {
      id: suggestionId("insurance", "employer_benefits"),
      capability: "insurance",
      topic: "employer_benefits",
      title: "Compare your private cover with your employer's",
      worthCents: saves,
      worthKind: "saves",
      confidence: capped(
        combine([
          factEvidence(pattern),
          factEvidence(employer),
          evidence("seen", profile.months, paid.length, "private cover charges"),
        ]),
        CAPS.employerBenefits,
        "I can't see your employer's plan",
      ),
      urgency: "later",
      why: `You pay ${formatCents(yearly)} a year for private cover and work for ${plain(String(employer.value))}. Employers usually pay about ${Math.round(R.employerPlanShare * 100)}% of a plan's cost, so the same cover through work can cost up to ${formatCents(saves)} a year less. Their open enrollment is the time to move.`,
      action: { label: "Review my work benefits", href: "/insurance/benefits" },
    };
  },
};

// An uploaded policy document waiting to be confirmed, so Jane can check the policy.
const policyDocuments: Detector = {
  capability: "insurance",
  covers: ["insurance_documents"],
  topic: "policy_documents",
  needs: [],
  detect({ profile, data }) {
    const waiting = data.unreadPolicyDocuments ?? 0;
    if (waiting <= 0) return null;
    const paid = charges(data, /./).filter((t) => t.pfc === "GENERAL_SERVICES_INSURANCE");
    const yearly = outCents(paid);
    if (yearly <= 0) return null;
    return {
      id: suggestionId("insurance", "policy_documents"),
      capability: "insurance",
      topic: "policy_documents",
      title: "Confirm the policy I read from your document",
      worthCents: Math.round(yearly * R.insuranceShopShare),
      worthKind: "saves",
      confidence: capped(
        combine([
          evidence("seen", profile.months, paid.length, "insurance charges"),
          { percent: 100, reason: `${waiting} document${waiting === 1 ? "" : "s"} you uploaded` },
        ]),
        CAPS.documents,
        "the saving is typical, not quoted",
      ),
      urgency: "soon",
      why: `You uploaded ${waiting} policy document${waiting === 1 ? "" : "s"} and I haven't added ${waiting === 1 ? "it" : "them"} to your insurance yet. Once confirmed, I can check the price against others: you paid ${formatCents(yearly)} for insurance in ${profile.months} months, and a comparison can find up to a tenth of that.`,
      action: { label: "Check what I read", href: "/insurance" },
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
  insuranceNegotiation,
  insuranceClaim,
  coverChange,
  cardCover,
  employerBenefits,
  policyDocuments,
];
