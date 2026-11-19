import type { SaveOnPhonePlan } from "@/lib/saveonphone";

// One plan as SaveOnPhone's POST /api/v1/plans/search returned it on 2026-11-19 (its OpenAPI leaves the
// response untyped), cut to the fields Jane reads. Public catalog data, no one's own.
export const SAVEONPHONE_PLAN: SaveOnPhonePlan = {
  plan_id: 11,
  carrier: "Mint Mobile",
  name: "17GB Plan",
  network: "T-Mobile",
  data_gb: 17,
  unlimited: false,
  catalog_verified_at: "2026-11-18",
  saveonphone_url: "https://saveonphone.com/plans/mint-mobile-15gb-plan/",
  carrier_url: "https://www.mintmobile.com/plans/",
  affiliate_url: "https://saveonphone.com/go/mint-mobile-11",
  billing: {
    initial_months: 12,
    initial_total_cents: 18000,
    renewal_months: 12,
    renewal_total_cents: 24000,
    activation_fee_cents: 0,
    taxes: "excluded",
  },
  eligibility: { requires_autopay: false, new_customers_only: true },
  catalog: { prepay_months: 12, contract: false },
};
