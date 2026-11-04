import type { PfcDetailed } from "@/categorize/taxonomy";
import type { CardBenefitKind, Peril } from "../card-benefits";
import type { ConfidenceLevel } from "./general";

// --- Insurance ---------------------------------------------------------------------

export const INSURANCE_CATEGORIES: readonly PfcDetailed[] = ["GENERAL_SERVICES_INSURANCE"];

// --- Cover the person already has through a card (spec step 152) ------------------
// Plans people pay for that a card benefit can duplicate, by merchant, with what each
// covers. A plan is only called a duplicate when the card covers all of it
// (src/config/card-benefits.ts) and the person meets the card's condition.
export const COVER_PLANS: readonly {
  kind: CardBenefitKind;
  merchants: readonly string[];
  covers: readonly Peril[];
}[] = [
  {
    kind: "phone",
    merchants: [
      "asurion",
      "verizon protect",
      "total mobile protection",
      "assurant",
      "phone insurance",
    ],
    covers: ["damage", "theft"],
  },
  {
    kind: "rental_car",
    merchants: ["bonzah", "rental cover", "allianz rental", "rentalcover"],
    covers: ["collision", "theft"],
  },
  {
    kind: "extended_warranty",
    merchants: ["extended warranty", "warrantech"],
    covers: ["breakdown"],
  },
  {
    // Travel insurance with medical cover is more than a card gives, so isn't matched.
    kind: "travel",
    merchants: ["trip cancellation"],
    covers: ["trip_cancellation", "trip_delay"],
  },
];
// The categories a card's condition looks for in the person's transactions.
export const PHONE_BILL_CATEGORIES: readonly PfcDetailed[] = ["RENT_AND_UTILITIES_TELEPHONE"];
export const RENTAL_CATEGORIES: readonly PfcDetailed[] = ["TRAVEL_RENTAL_CARS"];
export const TRIP_CATEGORIES: readonly PfcDetailed[] = ["TRAVEL_FLIGHTS", "TRAVEL_LODGING"];
// A duplicate is never more sure than this: the card's terms can change.
export const COVERED_BY_CARD_MAX_CONFIDENCE: ConfidenceLevel = "medium";
