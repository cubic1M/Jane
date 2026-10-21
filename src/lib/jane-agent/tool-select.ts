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
      /\b(?:tax\w*|refunds?|w-?4|withh\w*|deduct\w*|1099|irs|filing|returns?|brackets?|roth|hsa|estimated|accountant|write.?offs?|dependents?|forms?|documents?|file|expenses?|tags?|profile|about me)\b/,
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
    ]),
    words:
      /\b(?:invest\w*|stocks?|etfs?|funds?|401\s?k|ira|retire\w*|portfolio|crypto\w*|bitcoin|ether\w*|bonds?|dividends?|brokerage|529|college|annuit\w*|rebalanc\w*|pension|rmd|savings account|high.?yield|money market|index|shares?|equity|risk|what is a|profile|about me|goals?|buckets?|split)\b/,
  },
} as const;

type SectorName = keyof typeof SECTORS;

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

export function toolsFor(
  all: readonly Anthropic.Tool[],
  question: string,
  previous: string | null,
  topic: Topic | null,
  asOf: string,
): Anthropic.Tool[] {
  const wanted = sectorsFor(question, previous, topic, asOf);
  return all.filter((tool) => {
    const sector = sectorOf(tool.name);
    return sector === null || wanted.has(sector);
  });
}
