import { AREA_KEYS, areaOfCapability, type AreaKey } from "@/config/areas";
import { landing } from "@/lib/area-pages/landing";
import {
  FAMILY_NAMES,
  FAMILY_NAMES_IN_AREA,
  TOPIC_ACRONYMS,
  type FamilyKey,
} from "@/config/feature-map";
import { AREA_TABS } from "@/config/navigation";
import { ADVICE_TOPICS } from "@/config/suggestions";
import { cardHeadline, type Detector } from "@/detectors/contract";
import { BORROWING_POWER_DETECTORS } from "@/detectors/borrowing-power";
import { CONTROLLER_DETECTORS } from "@/detectors/controller";
import { COVER_GAP_DETECTORS } from "@/detectors/cover-gaps";
import { DEBT_DETECTORS } from "@/detectors/debt";
import { FAMILY_CREDIT_DETECTORS } from "@/detectors/family-credit";
import { FIGURES_DETECTORS } from "@/detectors/figures";
import { FIT_DETECTORS } from "@/detectors/fit";
import { runHarness } from "@/detectors/harness";
import { HOLDINGS_DETECTORS } from "@/detectors/holdings";
import { INVESTED_CASH_DETECTORS } from "@/detectors/invested-cash";
import { HOME_DETECTORS } from "@/detectors/home";
import { INSURANCE_DETECTORS } from "@/detectors/insurance";
import { INVESTING_DETECTORS } from "@/detectors/investing";
import { LIFE_DETECTORS } from "@/detectors/life";
import { LIFE_FACT_DETECTORS } from "@/detectors/life-facts";
import { MONEY_DETECTORS } from "@/detectors/money";
import { PLANNING_DETECTORS } from "@/detectors/planning";
import { PRACTICE_DETECTORS } from "@/detectors/practice";
import { PRACTICE_IDEA_DETECTORS } from "@/detectors/practice-ideas";
import { PRICE_RISE_DETECTORS } from "@/detectors/price-rises";
import { RENTING_DETECTORS } from "@/detectors/renting";
import { RETIREMENT_DETECTORS } from "@/detectors/retirement";
import { SPENDING_DETECTORS } from "@/detectors/spending";
import { TAX_DETECTORS } from "@/detectors/taxes";
import { TRADEOFF_DETECTORS } from "@/detectors/tradeoffs";
import { TWO_DETECTORS } from "@/detectors/two";
import { WORK_DETECTORS } from "@/detectors/work";

// The feature map, "What Jane does" (docs/design/home-hub.md): one tree per area, generated
// from Jane's own registry rather than written by hand. Area → branch → feature:
// - the areas are the area tabs (src/config/areas.ts, which places each capability);
// - a branch is a detector family (one file in src/detectors) within that area;
// - a feature is a detector (spec step 254), with an example of what it says, taken from the
//   eight sample people (the detector harness), and the page its button opens.
// "For you" is a detector that has reached this person (they have a suggestion with its key).

// Every detector, by family, in the registry's order (src/detectors/index.ts). The test holds
// this to DETECTORS, so a new family has to be added here (and named) to be on the map.
export const DETECTOR_FAMILIES: readonly { key: FamilyKey; detectors: readonly Detector[] }[] = [
  { key: "money", detectors: MONEY_DETECTORS },
  { key: "home", detectors: HOME_DETECTORS },
  { key: "work", detectors: WORK_DETECTORS },
  { key: "life", detectors: [...LIFE_DETECTORS, ...LIFE_FACT_DETECTORS] },
  { key: "insurance", detectors: INSURANCE_DETECTORS },
  { key: "coverGaps", detectors: COVER_GAP_DETECTORS },
  { key: "debt", detectors: DEBT_DETECTORS },
  { key: "fit", detectors: FIT_DETECTORS },
  { key: "spending", detectors: SPENDING_DETECTORS },
  { key: "renting", detectors: RENTING_DETECTORS },
  { key: "borrowing", detectors: BORROWING_POWER_DETECTORS },
  { key: "familyCredit", detectors: FAMILY_CREDIT_DETECTORS },
  { key: "taxes", detectors: TAX_DETECTORS },
  { key: "investing", detectors: INVESTING_DETECTORS },
  { key: "holdings", detectors: [...HOLDINGS_DETECTORS, ...INVESTED_CASH_DETECTORS] },
  { key: "priceRises", detectors: PRICE_RISE_DETECTORS },
  { key: "figures", detectors: FIGURES_DETECTORS },
  { key: "controller", detectors: CONTROLLER_DETECTORS },
  { key: "practice", detectors: PRACTICE_DETECTORS },
  { key: "planning", detectors: PLANNING_DETECTORS },
  { key: "two", detectors: TWO_DETECTORS },
  { key: "tradeoffs", detectors: TRADEOFF_DETECTORS },
  { key: "practiceIdeas", detectors: PRACTICE_IDEA_DETECTORS },
  { key: "retirement", detectors: RETIREMENT_DETECTORS },
];

export type FeatureNode = {
  // "<capability>:<topic>", the detector's suggestion key.
  id: string;
  name: string;
  // One line: an example of what Jane says, or what the feature is for.
  line: string;
  forYou: boolean;
  href: string;
  // What "Ask Jane about this" puts in the chat's message box.
  ask: string;
};

export type BranchNode = { id: string; name: string; forYou: number; features: FeatureNode[] };

export type AreaMap = {
  key: AreaKey;
  name: string;
  href: string;
  features: number;
  forYou: number;
  branches: BranchNode[];
};

// What a detector says for a sample person, if it says anything for one.
export type Example = { headline: string; href: string };

// "pmi_removal" → "PMI removal", "s_corp_election" → "S corp election".
export function topicName(topic: string): string {
  const words = topic.split("_").map((w) => (TOPIC_ACRONYMS.includes(w) ? w.toUpperCase() : w));
  words[0] = words[0][0].toUpperCase() + words[0].slice(1);
  return words.join(" ");
}

const ADVICE = new Set<string>(ADVICE_TOPICS);
const AREA_TAB = Object.fromEntries(AREA_TABS.map((t) => [t.key, t]));

export function buildFeatureMap({
  families = DETECTOR_FAMILIES,
  examples,
  reached,
  advice,
}: {
  families?: readonly { key: FamilyKey; detectors: readonly Detector[] }[];
  examples: ReadonlyMap<string, Example>;
  // The suggestion keys that have reached this person.
  reached: ReadonlySet<string>;
  // Demo advice mode: recommendations on investments, taxes, insurance and loans may show.
  advice: boolean;
}): AreaMap[] {
  return AREA_KEYS.map((area) => {
    const branches: BranchNode[] = [];
    // A feature is on the map once, in the first family that has it.
    const seen = new Set<string>();
    for (const family of families) {
      const features = family.detectors
        .filter((d) => areaOfCapability(d.capability) === area)
        .flatMap((d): FeatureNode[] => {
          const id = `${d.capability}:${d.topic}`;
          if (seen.has(id)) return [];
          seen.add(id);
          const example = examples.get(id);
          const name = topicName(d.topic);
          // Recommendations stay out for real accounts (step 98): the example is a sample
          // person's, but it reads as advice all the same.
          const held = ADVICE.has(d.topic) && !advice;
          return [
            {
              id,
              name,
              line: held
                ? "Shown with demo data only"
                : example
                  ? `Like: ${cardHeadline(example.headline)}`
                  : "Comes up when Jane spots it",
              forYou: reached.has(id),
              // Where Jane's own link for it lands (a hidden page lands on its area page).
              href: example?.href.startsWith("/") ? landing(example.href) : AREA_TAB[area].href,
              // Reads right whatever the name ("subscriptions", "a second look"): hub QA found "What is
              // subscriptions".
              ask: `Tell me about ${name.toLowerCase()}: does it apply to me?`,
            },
          ];
        });
      if (features.length === 0) continue;
      branches.push({
        id: `${area}/${family.key}`,
        name: FAMILY_NAMES_IN_AREA[`${area}/${family.key}`] ?? FAMILY_NAMES[family.key],
        forYou: features.filter((f) => f.forYou).length,
        features,
      });
    }
    const all = branches.flatMap((b) => b.features);
    return {
      key: area,
      name: AREA_TAB[area].label,
      href: AREA_TAB[area].href,
      features: all.length,
      forYou: all.filter((f) => f.forYou).length,
      branches,
    };
  });
}

// Each detector's first example across the sample people, worked out once per server: the
// harness is pure and runs on fixed sample data.
let cached: Map<string, Example> | null = null;
export function sampleExamples(): ReadonlyMap<string, Example> {
  if (cached) return cached;
  const out = new Map<string, Example>();
  for (const report of runHarness()) {
    for (const s of report.fired) {
      if (!out.has(s.id)) out.set(s.id, { headline: s.headline, href: s.action.href });
    }
  }
  cached = out;
  return out;
}
