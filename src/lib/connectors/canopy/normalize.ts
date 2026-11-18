import type { PremiumFrequency } from "@/config/documents";
import type { PolicyKind } from "@/config/insurance";
import type { CanopyCoverage, CanopyPolicy, CanopyPull } from "./api";

// A Canopy pull's personal policies in Jane's shape (insurance_policies), so the renewal reshop,
// the coverage checkup and the gaps read them like any other policy. Pure.

export type ReadPolicy = {
  kind: PolicyKind;
  carrier: string;
  // The term's premium, paid per premiumFrequency (a 6-month term every 6 months).
  premiumCents: number | null;
  premiumFrequency: PremiumFrequency;
  termMonths: 6 | 12;
  deductibleCents: number | null;
  coverage: Record<string, number | boolean>;
  // YYYY-MM-DD: when the next term starts.
  renewalDate: string | null;
};

// Canopy's policy_type, by Jane's kinds. Commercial lines aren't the person's own and are left out.
const KINDS: Readonly<Record<string, PolicyKind>> = {
  AUTO: "auto",
  CLASSIC_CAR: "auto",
  NAMED_NON_OWNER: "auto",
  HOMEOWNERS: "home",
  CONDO: "home",
  MOBILE_HOME: "home",
  FARMOWNER: "home",
  RENTERS: "renters",
  LANDLORD: "rental_property",
  UMBRELLA: "umbrella",
  PERSONAL_LIABILITY: "umbrella",
  EXCESS_LIABILITY: "umbrella",
  LIFE: "life",
  TERM_LIFE: "life",
  UNIVERSAL_LIFE: "life",
  WHOLE_LIFE: "life",
  PET: "pet",
  BOAT: "boat",
  YACHT: "boat",
  PERSONAL_WATERCRAFT: "boat",
  PERSONAL_ARTICLES: "valuables",
  SHORT_TERM_DISABILITY: "disability",
  LONG_TERM_DISABILITY: "disability",
};
const COMMERCIAL =
  /^(COMMERCIAL_|BUSINESS_|WORKERS_|GENERAL_LIABILITY|ERRORS_|INLAND_|GARAGE|CYBER|MANAGEMENT_|ARTISAN_|CONTRACTORS_|FARM_)/;
// Cover the person has now. A pending cancellation still covers them until it happens.
const IN_FORCE = new Set(["ACTIVE", "PENDING_CANCELLATION"]);

const day = (iso: string | null | undefined) =>
  iso && /^\d{4}-\d{2}-\d{2}/.test(iso) ? iso.slice(0, 10) : null;

// 6 or 12, from the term's dates; 12 when they're missing.
function termOf(policy: CanopyPolicy): 6 | 12 {
  const from = day(policy.effective_date);
  const to = day(policy.expiry_date);
  if (!from || !to) return 12;
  const days = (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000;
  return days > 0 && days < 270 ? 6 : 12;
}

const named = (coverages: readonly CanopyCoverage[], name: string) =>
  coverages.find((c) => c.name === name && c.is_declined !== true);

function coverageOf(kind: PolicyKind, policy: CanopyPolicy): Record<string, number | boolean> {
  const out: Record<string, number | boolean> = {};
  const set = (key: string, value: number | null | undefined) => {
    if (typeof value === "number" && value > 0) out[key] = value;
  };
  if (kind === "auto") {
    const all = (policy.vehicles ?? []).flatMap((v) => v.coverages ?? []);
    const injury = named(all, "BODILY_INJURY_LIABILITY");
    set("bodilyInjuryPerPerson", injury?.per_person_limit_cents);
    set("bodilyInjuryPerAccident", injury?.per_incident_limit_cents);
    set("propertyDamage", named(all, "PROPERTY_DAMAGE_LIABILITY")?.per_incident_limit_cents);
    if (named(all, "COLLISION")) out.collision = true;
    if (named(all, "COMPREHENSIVE")) out.comprehensive = true;
    if (named(all, "UNINSURED_MOTORISTS")) out.uninsuredMotorist = true;
  }
  if (kind === "home" || kind === "renters") {
    const all = (policy.dwellings ?? []).flatMap((d) => d.coverages ?? []);
    if (kind === "home") set("dwelling", named(all, "DWELLING")?.per_incident_limit_cents);
    set("personalProperty", named(all, "PERSONAL_PROPERTY")?.per_incident_limit_cents);
    set("liability", named(all, "PERSONAL_LIABILITY")?.per_incident_limit_cents);
  }
  return out;
}

// The deductible that matters most: the policy's own, else a car's collision or a home's
// all-other-perils one.
function deductibleOf(policy: CanopyPolicy): number | null {
  if (typeof policy.deductible_cents === "number") return policy.deductible_cents;
  const all = [
    ...(policy.vehicles ?? []).flatMap((v) => v.coverages ?? []),
    ...(policy.dwellings ?? []).flatMap((d) => d.coverages ?? []),
  ];
  const main =
    named(all, "COLLISION") ?? named(all, "ALL_OTHER_PERILS") ?? named(all, "ALL_PERILS");
  return typeof main?.deductible_cents === "number" ? main.deductible_cents : null;
}

export function policiesFromPull(pull: CanopyPull): ReadPolicy[] {
  // carrier_name is an identifier ("statefarm"); a friendly name on any policy from the same carrier
  // in the pull names the rest (Canopy's example has it on the life policy only).
  const friendly = new Map(
    pull.policies.flatMap((p) =>
      p.carrier_friendly_name?.trim() ? [[p.carrier_name, p.carrier_friendly_name.trim()]] : [],
    ),
  );
  return pull.policies.flatMap((policy) => {
    const type = policy.policy_type ?? "";
    if (!IN_FORCE.has(policy.status ?? "") || COMMERCIAL.test(type)) return [];
    const kind = KINDS[type] ?? "other";
    const termMonths = termOf(policy);
    const carrier =
      friendly.get(policy.carrier_name) ??
      (pull.insurance_provider_friendly_name?.trim() || policy.carrier_name);
    return [
      {
        kind,
        carrier,
        premiumCents: policy.total_premium_cents,
        premiumFrequency: termMonths === 6 ? "semiannual" : "yearly",
        termMonths,
        deductibleCents: deductibleOf(policy),
        coverage: coverageOf(kind, policy),
        renewalDate: day(policy.renewal_date) ?? day(policy.expiry_date),
      },
    ];
  });
}
