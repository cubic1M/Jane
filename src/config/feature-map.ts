import type { AreaKey } from "@/config/areas";

// The feature map ("What Jane does", docs/design/home-hub.md): the words its generated tree
// uses. The tree itself comes from the detectors (src/lib/feature-map.ts); these only name its
// branches. A branch is a detector family (one file in src/detectors) within an area; the test
// fails on a family with no name, so a new family shows up named.

export type FamilyKey =
  | "money"
  | "home"
  | "work"
  | "life"
  | "insurance"
  | "coverGaps"
  | "debt"
  | "fit"
  | "spending"
  | "renting"
  | "borrowing"
  | "familyCredit"
  | "taxes"
  | "investing"
  | "holdings"
  | "priceRises"
  | "figures"
  | "controller"
  | "practice"
  | "planning"
  | "two"
  | "tradeoffs"
  | "practiceIdeas"
  | "retirement";

export const FAMILY_NAMES: Readonly<Record<FamilyKey, string>> = {
  money: "Fees and cushion",
  home: "Your home",
  work: "Work and business",
  life: "Life changes",
  insurance: "Your cover",
  coverGaps: "Gaps in cover",
  debt: "Loans and cards",
  fit: "A better-fit loan",
  spending: "Bills and subscriptions",
  renting: "Renting",
  borrowing: "Before you borrow",
  familyCredit: "Family credit",
  taxes: "Tax moves",
  investing: "Retirement and savings plans",
  holdings: "What you hold",
  priceRises: "Price rises",
  figures: "Checking the numbers",
  controller: "Keeping the books",
  practice: "Practice money",
  planning: "Planning your money",
  two: "Money for two",
  tradeoffs: "Goals that compete",
  practiceIdeas: "Practice ideas",
  retirement: "The run-up to retirement",
};

// A family whose detectors land in more than one area is named for each.
export const FAMILY_NAMES_IN_AREA: Readonly<Partial<Record<`${AreaKey}/${FamilyKey}`, string>>> = {
  "loans/money": "Card and loan costs",
  "investments/money": "Idle cash",
  "loans/home": "Your mortgage",
  "insurance/home": "Cover for your family",
  "taxes/work": "Self-employed tax",
  "investments/work": "Work and retirement",
  "money/work": "Uneven pay",
  "insurance/work": "Business cover",
  "insurance/retirement": "Medicare",
  "investments/retirement": "Social Security",
};

// Topic ids read as words ("pmi_removal" is "PMI removal"); these stay in capitals.
export const TOPIC_ACRONYMS: readonly string[] = [
  "pmi",
  "hsa",
  "fsa",
  "rmd",
  "irmaa",
  "ptc",
  "bnpl",
  "ip",
  "pin",
  "ira",
  "pslf",
];

// The map's shape, in px at full size: node sizes and the gaps between columns and rows.
export const MAP_NODE = {
  root: { w: 176, h: 64 },
  group: { w: 300, h: 56 },
  feature: { w: 320, h: 68 },
} as const;
export const MAP_GAP = { column: 56, group: 12, feature: 10 } as const;
// Below this width the map zooms to the open branch's features alone.
export const MAP_NARROW_PX = 640;
// The camera never zooms in past full size, nor out past this.
export const MAP_MIN_SCALE = 0.55;
