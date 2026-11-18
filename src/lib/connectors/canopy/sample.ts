import type { CanopyPull } from "./api";

// Canopy's own example of GET /teams/{teamId}/pulls/{pullId} ("Personal Example Response" in its
// OpenAPI definition, docs.usecanopy.com/openapi/documentation.json, read 2026-11-17), cut to the
// fields Jane reads: a State Farm home, car and term life policy. The tests read it as Canopy
// sends it; the sandbox twin moves its dates to around today (samplePull).
export const CANOPY_DOCS_PULL: CanopyPull = {
  pull_id: "59ced597-b48f-49e3-9756-799e4c6f79a0",
  status: "SUCCESS",
  insurance_provider_name: "statefarm",
  insurance_provider_friendly_name: null,
  policies: [
    {
      policy_id: "a5c3eac9-537c-4146-8de9-99fb55455126",
      policy_type: "HOMEOWNERS",
      carrier_name: "statefarm",
      carrier_friendly_name: null,
      status: "ACTIVE",
      effective_date: "2022-12-13T06:00:00.000Z",
      expiry_date: "2023-12-13T06:00:00.000Z",
      renewal_date: null,
      total_premium_cents: 175349,
      deductible_cents: null,
      dwellings: [
        {
          coverages: [
            {
              name: "DWELLING",
              per_person_limit_cents: null,
              per_incident_limit_cents: 28838000,
              deductible_cents: null,
              is_declined: false,
            },
            {
              name: "OTHER_STRUCTURES",
              per_person_limit_cents: null,
              per_incident_limit_cents: 2883800,
              deductible_cents: null,
              is_declined: false,
            },
            {
              name: "PERSONAL_PROPERTY",
              per_person_limit_cents: null,
              per_incident_limit_cents: 14419000,
              deductible_cents: null,
              is_declined: false,
            },
            {
              name: "LOSS_OF_USE",
              per_person_limit_cents: null,
              per_incident_limit_cents: 5767600,
              deductible_cents: null,
              is_declined: false,
            },
            {
              name: "PERSONAL_LIABILITY",
              per_person_limit_cents: null,
              per_incident_limit_cents: 10000000,
              deductible_cents: null,
              is_declined: false,
            },
            {
              name: "MEDICAL_PAYMENTS",
              per_person_limit_cents: 100000,
              per_incident_limit_cents: null,
              deductible_cents: null,
              is_declined: false,
            },
            {
              name: "ALL_OTHER_PERILS",
              per_person_limit_cents: null,
              per_incident_limit_cents: null,
              deductible_cents: 288380,
              is_declined: false,
            },
            {
              name: "WINDSTORM_OR_HAIL",
              per_person_limit_cents: null,
              per_incident_limit_cents: null,
              deductible_cents: 576760,
              is_declined: false,
            },
          ],
        },
      ],
    },
    {
      policy_id: "b3e00891-29d4-4ac6-a906-9b6a162f6a09",
      policy_type: "AUTO",
      carrier_name: "statefarm",
      carrier_friendly_name: null,
      status: "ACTIVE",
      effective_date: "2022-12-13T06:00:00.000Z",
      expiry_date: "2023-06-13T05:00:00.000Z",
      renewal_date: null,
      total_premium_cents: 50781,
      deductible_cents: null,
      vehicles: [
        {
          coverages: [
            {
              name: "COLLISION",
              per_person_limit_cents: null,
              per_incident_limit_cents: null,
              deductible_cents: 50000,
              is_declined: false,
            },
            {
              name: "COMPREHENSIVE",
              per_person_limit_cents: null,
              per_incident_limit_cents: null,
              deductible_cents: 50000,
              is_declined: false,
            },
            {
              name: "BODILY_INJURY_LIABILITY",
              per_person_limit_cents: 10000000,
              per_incident_limit_cents: 30000000,
              deductible_cents: null,
              is_declined: false,
            },
            {
              name: "PROPERTY_DAMAGE_LIABILITY",
              per_person_limit_cents: null,
              per_incident_limit_cents: 5000000,
              deductible_cents: null,
              is_declined: false,
            },
            {
              name: "UNINSURED_MOTORISTS",
              per_person_limit_cents: 1500000,
              per_incident_limit_cents: 3000000,
              deductible_cents: null,
              is_declined: false,
            },
          ],
        },
      ],
    },
    {
      policy_id: "8c9d0e1f-2a3b-4c5d-6e7f-8a9b0c1d2e3f",
      policy_type: "TERM_LIFE",
      carrier_name: "statefarm",
      carrier_friendly_name: "State Farm",
      status: "ACTIVE",
      effective_date: "2024-01-01T06:00:00.000Z",
      expiry_date: "2044-01-01T06:00:00.000Z",
      renewal_date: null,
      total_premium_cents: 125000,
      deductible_cents: null,
    },
  ],
};

const shift = (iso: string | null, days: number) =>
  iso ? new Date(Date.parse(iso) + days * 86_400_000).toISOString() : null;

// The same pull for a sample-data person, its terms moved so the car renews in 21 days and the
// home in 200: the car's renewal reshop window (30 days, RESHOP_DAYS_BEFORE_RENEWAL_BY_KIND)
// catches it.
export function samplePull(now: Date): CanopyPull {
  const day = (iso: string) => Date.parse(iso.slice(0, 10));
  const today = Date.parse(now.toISOString().slice(0, 10));
  return {
    ...CANOPY_DOCS_PULL,
    policies: CANOPY_DOCS_PULL.policies.map((policy) => {
      const target = policy.policy_type === "AUTO" ? 21 : 200;
      const days = policy.expiry_date
        ? Math.round((today - day(policy.expiry_date)) / 86_400_000) + target
        : 0;
      return {
        ...policy,
        effective_date: shift(policy.effective_date, days),
        expiry_date: shift(policy.expiry_date, days),
      };
    }),
  };
}
