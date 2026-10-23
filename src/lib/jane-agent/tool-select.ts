import type Anthropic from "@anthropic-ai/sdk";
import { capabilityFor } from "./capabilities";
import type { Topic } from "./context";
import { parseIntent } from "./intents";

// Which of Claude's ~125 tools a free question is sent with. All of them is ~20,000 tokens of
// definitions in every request: slow to start and costly. The general tools (spending, bills,
// goals, net worth, findings, the whole picture, decisions, buttons) always go; the four
// sectors' tools (debt and credit, insurance, taxes, investing) go when the question or the
// conversation is about that sector: what the rules read it as, the last topic, or its words.
// A question about none of them gets the general tools, which can still answer it.

const SECTORS = {
  debt: {
    tools: new Set([
      "debts",
      "payoff_plan",
      "refinance_offers",
      "debt_autopilot",
      "credit_score",
      "credit_cards",
      "credit_building",
      "bnpl_installments",
      "tight_money",
      "car_purchase",
      "home_purchase",
      "medical_bills",
      "credit_report_fixes",
      "card_interest",
      "student_long_game",
      "family_loans",
      "credit_goals",
      "car_loan",
      "debt_review",
      "debt_trouble",
      "home_equity",
      "mortgage",
      "student_loans",
      "balance_transfers",
      "loan_applications",
      "debt_decision",
      "loan_fit",
    ]),
    words:
      /\b(?:debts?|loans?|credit|cards?|owe|owed|interest|mortgage|apr|pay ?off|refinanc\w*|bnpl|afford\w*|student|medical|collections?|lender|borrow\w*|equity|score|installments?|overdraft|payday|payments?|minimum|avalanche|snowball|qualifying|due|consolidat\w*|overdraft|klarna|afterpay|affirm|rent|saving|savings|pay later)\b/,
  },
  insurance: {
    tools: new Set<string>(),
    prefix: "insurance_",
    words:
      /\b(?:insur\w*|cover(?:age|ed)?|polic(?:y|ies)|premiums?|deductibles?|claims?|renters?|umbrella|beneficiar\w*|warranty|liability)\b/,
  },
  tax: {
    tools: new Set<string>(),
    prefix: "tax_",
    words:
      /\b(?:tax\w*|refunds?|w-?4|withh\w*|deduct\w*|1099|irs|filing|returns?|brackets?|roth|hsa|estimated|accountant|write.?offs?|dependents?|forms?|documents?|file|expenses?|tags?|profile|about me|donat\w*|charit\w*|s corp|llc|home office|set aside)\b/,
  },
  investing: {
    tools: new Set([
      "holdings",
      "investor_profile",
      "investment_fees",
      "portfolio_review",
      "retirement_plan",
      "rebalance_plan",
      "auto_invest",
      "account_plan",
      "investments_overview",
      "investment_returns",
      "goal_buckets",
      "college_plan",
      "hsa",
      "company_stock",
      "retirement_accounts",
      "old_accounts",
      "retirement_income",
      "family_investing",
      "property",
      "costly_products",
      "yearly_review",
      "asset_location",
      "steady_hand",
      "cash_plan",
      "crypto",
      "market_news",
      "backtest_by_level",
      "practice_portfolio",
      "practice_settings",
      "change_practice_settings",
    ]),
    words:
      /\b(?:invest\w*|stocks?|etfs?|funds?|401\s?k|ira|retire\w*|portfolio|crypto\w*|bitcoin|ether\w*|bonds?|dividends?|brokerage|news|headlines?|filings?|8-?k|10-?q|529|college|annuit\w*|rebalanc\w*|pension|rmd|savings account|high.?yield|money market|index|shares?|equity|risk\w*|what is a|profile|about me|goals?|buckets?|split|practice|paper money|extra moves?|avoid\w*|harvest\w*|cash buffer|suggest only|need (?:this|the|that|my) money|extra rules|dip.?buys?)\b/,
  },
} as const;

type SectorName = keyof typeof SECTORS;

export const AREAS = Object.keys(SECTORS) as SectorName[];
export const isArea = (value: unknown): value is SectorName =>
  typeof value === "string" && (AREAS as string[]).includes(value);

// The words above only guess which areas a question needs: "my car got rear ended" or "how much
// will uncle sam take" name none of them. So Claude can ask for an area's tools itself; they come
// with its next step (./claude.ts). One fixed definition, sent with the general tools, so the
// cached start of every request stays the same.
export const OPEN_AREA_TOOL: Anthropic.Tool = {
  name: "open_area",
  description:
    "Get the tools for one area of the person's money when the question needs an area whose tools you don't have yet; they are added for your next step. debt: loans, credit cards, card interest, credit score, buying or leasing a car or a home, getting out of debt. insurance: their policies and cover, claims, accidents, what happens to their family if they die, or if they get sick or can't work. tax: what they'll owe or get back, withholding, write-offs, deadlines. investing: retirement and when they can stop working, stocks, funds, crypto, savings rates, where extra cash should go.",
  input_schema: {
    type: "object",
    properties: { area: { type: "string", enum: [...AREAS] } },
    required: ["area"],
  },
};

// One area's tools, for open_area.
export const areaTools = (all: readonly Anthropic.Tool[], area: SectorName) =>
  all.filter((tool) => sectorOf(tool.name) === area);

function sectorOf(name: string): SectorName | null {
  for (const [sector, def] of Object.entries(SECTORS) as [
    SectorName,
    (typeof SECTORS)[SectorName],
  ][]) {
    if (def.tools.has(name)) return sector;
    if ("prefix" in def && name.startsWith(def.prefix)) return sector;
  }
  return null;
}

// The one or two lookups that almost every question in a sector starts with. They are run
// while the person's numbers load and sent up front, so a sector question is one round of
// writing instead of a round of lookups first.
export const SECTOR_OVERVIEW: Readonly<Record<SectorName, readonly string[]>> = {
  debt: ["debts", "credit_score"],
  insurance: ["insurance_policies"],
  tax: ["tax_estimate"],
  investing: ["holdings", "investor_profile"],
};

// When what the question is about is clear, the specific lookup it needs, not the sector's
// overview: Claude would call this one next, a whole round later.
const SPECIFIC_LOOKUPS: readonly { when: RegExp; tools: readonly string[] }[] = [
  {
    when: /\b(?:rsus?|vest\w*|stock comp\w*|stock options?|espp|isos?|nsos?)\b/i,
    tools: ["tax_equity"],
  },
  {
    when: /\b(?:build\w*|improv\w*|rais\w*|fix\w*|boost\w*)\b[^.?!]{0,30}\bcredit\b|\bcredit (?:score|history|building)\b/i,
    tools: ["credit_building", "credit_score"],
  },
  {
    when: /\b(?:401\(?k\)?|403\(?b\)?|match|retirement|retire|ira|roth)\b/i,
    tools: ["retirement_accounts"],
  },
  { when: /\b(?:diversif\w*|allocation|portfolio|rebalanc\w*)\b/i, tools: ["portfolio_review"] },
  // Phase AW: the practice portfolio's settings ("make it less risky", "avoid oil companies").
  {
    when: /\b(?:practice|paper money|less risky|more risky|riskier|safer|extra moves?|avoid\w*|suggest only|cash buffer|need (?:this|the|that|my) money)\b/i,
    tools: ["practice_settings"],
  },
  // Spec step 295: "how would a High portfolio have done in 2022".
  {
    when: /\b(?:backtest\w*|replay\w*|would\b[^.?!]{0,40}\bhave (?:done|gone|fared|performed|lost|dropped|fallen))\b/i,
    tools: ["backtest_by_level"],
  },
  // The strategy each level follows: "which strategy does my level use?".
  {
    when: /\b(?:which|what) (?:investing |investment )?strateg(?:y|ies)\b|\b(?:investing|investment|autopilot'?s?|level'?s?) strateg(?:y|ies)\b|\bmy strategy\b/i,
    tools: ["backtest_by_level"],
  },
  // The rule replay: "did the extra rules help?", "do the dip buys work?".
  {
    when: /\b(?:extra rules|autopilot'?s? rules|rules? (?:help|hurt|work)\w*|dip.?buy\w*)\b/i,
    tools: ["backtest_by_level"],
  },
];

// The lookups to run up front for a question: the specific ones when it names one, otherwise
// the overview of each sector it is about (at most two sectors).
export function lookupsFor(question: string, sectors: ReadonlySet<SectorName>): string[] {
  if (sectors.size === 0 || sectors.size > 2) return [];
  const specific = SPECIFIC_LOOKUPS.filter((s) => s.when.test(question)).flatMap((s) => s.tools);
  if (specific.length > 0) return [...new Set(specific)];
  return [...new Set([...sectors].flatMap((sector) => SECTOR_OVERVIEW[sector]))];
}

// The sectors a question is about: from the rules' reading of it, the last topic's capability,
// and its own words (and the previous message's, since a follow-up is short).
export function sectorsFor(
  question: string,
  previous: string | null,
  topic: Topic | null,
  asOf: string,
): Set<SectorName> {
  const wanted = new Set<SectorName>();
  const tools = new Set<string>([
    ...(capabilityFor(parseIntent(question, asOf))?.tools ?? []),
    ...(topic ? (capabilityFor({ kind: topic.kind } as never)?.tools ?? []) : []),
  ]);
  for (const t of tools) {
    const s = sectorOf(t);
    if (s) wanted.add(s);
  }
  const text = `${question} ${previous ?? ""}`.toLowerCase();
  for (const [sector, def] of Object.entries(SECTORS) as [
    SectorName,
    (typeof SECTORS)[SectorName],
  ][]) {
    if (def.words.test(text)) wanted.add(sector);
  }
  return wanted;
}

// The tools for a question, in an order that caches well: the general tools every question gets
// come first and end in a cache breakpoint, so every request shares that cached start whatever
// sector it is about; then the button tool (only when `buttons`), then the sector's tools. The
// request's own system prompt follows them (./claude.ts).
export function toolsFor(
  all: readonly Anthropic.Tool[],
  question: string,
  previous: string | null,
  topic: Topic | null,
  asOf: string,
  { buttons = true }: { buttons?: boolean } = {},
): Anthropic.Tool[] {
  const wanted = sectorsFor(question, previous, topic, asOf);
  const kept = all.filter((tool) => {
    const sector = sectorOf(tool.name);
    return sector === null || wanted.has(sector);
  });
  const general = [
    ...kept.filter((t) => sectorOf(t.name) === null && t.name !== "propose_action"),
    OPEN_AREA_TOOL,
  ];
  const button = buttons ? kept.filter((t) => t.name === "propose_action") : [];
  const sectors = kept.filter((t) => sectorOf(t.name) !== null);
  const cached = general.map((t, i) =>
    i === general.length - 1 ? { ...t, cache_control: { type: "ephemeral" as const } } : t,
  );
  return [...cached, ...button, ...sectors];
}
