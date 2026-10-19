// Cover that comes with a credit card (spec step 152): phone protection, rental car cover,
// extended warranty and travel insurance. Until a card-benefits data partner is connected,
// this stand-in catalog is the source: each entry is written from the card's benefit guide
// and reviewed by our team before it's used, and only cards in it are matched. A card not
// in the catalog is never assumed to cover anything.

export type CardBenefitKind = "phone" | "rental_car" | "extended_warranty" | "travel";

// What a kind of cover pays for. A duplicate is only raised when the card covers
// everything the paid plan does.
export type Peril =
  "damage" | "theft" | "breakdown" | "collision" | "trip_cancellation" | "trip_delay" | "medical";

// What the person has to do for the card's cover to apply, which Jane checks in their
// transactions: pay the phone bill with the card, buy the item with it, pay for rentals or
// trips with it.
export type CardCondition = "phone_bill" | "the_purchase" | "rentals" | "trips";

export type CardBenefit = {
  kind: CardBenefitKind;
  label: string;
  covers: readonly Peril[];
  condition: CardCondition;
  // The limits, as shown to the person, with the amounts the guardrails allow.
  limits: readonly { label: string; cents: number | null; text?: string }[];
};

export type CardProduct = {
  id: string;
  // The card's name as the bank reports it on the account.
  name: string;
  match: RegExp;
  benefits: readonly CardBenefit[];
  // Our team's review of the entry.
  reviewedOn: string;
  // Stand-in entries for the demo bank are only matched for demo-bank people.
  demo: boolean;
};

export const CONDITION_WORDS: Record<CardCondition, string> = {
  phone_bill: "you pay your phone bill with the card",
  the_purchase: "you bought the item with the card",
  rentals: "you pay for the rental with the card and turn down the rental company's cover",
  trips: "you pay for the trip with the card",
};

export const CARD_BENEFIT_LABELS: Record<CardBenefitKind, string> = {
  phone: "Cell phone protection",
  rental_car: "Rental car damage cover",
  extended_warranty: "Extended warranty",
  travel: "Trip cancellation and delay cover",
};

export const CARD_CATALOG: readonly CardProduct[] = [
  {
    id: "demo-card",
    name: "Demo Credit Card",
    match: /^demo credit card$/i,
    reviewedOn: "2026-10-15",
    demo: true,
    benefits: [
      {
        kind: "phone",
        label: CARD_BENEFIT_LABELS.phone,
        covers: ["damage", "theft"],
        condition: "phone_bill",
        limits: [
          { label: "Up to", cents: 80_000, text: "a claim" },
          { label: "Deductible", cents: 5_000 },
          { label: "Claims a year", cents: null, text: "2" },
        ],
      },
      {
        kind: "rental_car",
        label: CARD_BENEFIT_LABELS.rental_car,
        covers: ["collision", "theft"],
        condition: "rentals",
        limits: [
          { label: "Up to", cents: 5_000_000, text: "a rental" },
          { label: "Rentals up to", cents: null, text: "15 days" },
        ],
      },
      {
        kind: "extended_warranty",
        label: CARD_BENEFIT_LABELS.extended_warranty,
        covers: ["breakdown"],
        condition: "the_purchase",
        limits: [
          { label: "Adds", cents: null, text: "1 year to warranties of 3 years or less" },
          { label: "Up to", cents: 1_000_000, text: "an item" },
        ],
      },
      {
        kind: "travel",
        label: CARD_BENEFIT_LABELS.travel,
        covers: ["trip_cancellation", "trip_delay"],
        condition: "trips",
        limits: [
          { label: "Cancellation up to", cents: 500_000, text: "a trip" },
          { label: "Delay up to", cents: 50_000, text: "after 12 hours" },
        ],
      },
    ],
  },
];
