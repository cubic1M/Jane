import { insuranceDecider } from "../insurance/decide-router";
import { debtDecide } from "../debt-decide";
import { answerDecision } from "../decision";
import { answerDebt } from "../debt-answer";
import { DEBT_KINDS, type DebtIntent } from "../debt-intents";
import type { Intent } from "../intents";
import { insuranceAnswer } from "./insurance";
import { investingAnswer } from "./investing";
import { janeAnswer } from "./jane";
import { moneyAnswer } from "./money";
import type { Capability } from "./shared";
import { taxAnswer, taxDecide } from "./tax";

// Every capability of Jane's chat in one place (spec step 190): what she answers, the tools
// Claude has for it and the bank questions that test it. Each sector's intents, replies and
// tools used to be registered in several scattered files; now there is one entry per
// capability here, and ../registry.test.ts holds the list to its rules: no two capabilities
// claim the same kind of question, each has a tool Claude has and questions in the bank.
// Adding a capability: its feature's own code, and one entry here.

const debtAnswer: Capability["answer"] = ({ userId, intent, client, now }) =>
  answerDebt(userId, intent as DebtIntent, { client, now });

export const CAPABILITIES: readonly Capability[] = [
  // Money, bills, spending and goals.
  {
    id: "cost",
    bank: ["cost", "subs", "spent"],
    kinds: ["cost", "about"],
    tools: ["subscriptions", "finding_details"],
    answer: moneyAnswer,
  },
  {
    id: "subscriptions",
    bank: ["subs"],
    kinds: ["subscriptions"],
    tools: ["subscriptions"],
    answer: moneyAnswer,
  },
  {
    id: "payday",
    bank: ["income", "pay"],
    kinds: ["payday", "paycheck"],
    tools: ["safe_to_spend", "money_moves"],
    answer: moneyAnswer,
  },
  {
    id: "safe_to_spend",
    bank: ["safe"],
    kinds: ["safe_to_spend", "afford", "balance_forecast", "save_more"],
    tools: ["safe_to_spend", "balance_forecast"],
    answer: moneyAnswer,
  },
  {
    id: "spending",
    bank: ["spending", "spent"],
    kinds: ["spending"],
    tools: ["show_block"],
    answer: moneyAnswer,
  },
  {
    id: "coming_up",
    bank: ["bills", "due"],
    kinds: ["coming_up", "bills_paid"],
    tools: ["coming_up", "money_moves"],
    answer: moneyAnswer,
  },
  {
    id: "net_worth",
    bank: ["networth"],
    kinds: ["net_worth"],
    tools: ["net_worth"],
    answer: moneyAnswer,
  },
  {
    id: "decision",
    bank: ["decision"],
    kinds: ["decision"],
    tools: ["decision"],
    answer: async ({ userId, intent, client, now }) =>
      intent.kind === "decision"
        ? answerDecision(userId, intent, null, { client, now, sectors: CAPABILITIES })
        : null,
  },
  { id: "goals", bank: ["goals"], kinds: ["goals"], tools: ["goals"], answer: moneyAnswer },
  {
    id: "saved",
    bank: ["spending"],
    kinds: ["saved", "changes", "review", "monthly_report"],
    tools: ["proven_savings", "recent_changes", "plan_upkeep", "monthly_report"],
    answer: moneyAnswer,
  },

  // Jane herself.
  {
    id: "whole_picture",
    bank: ["whole", "life"],
    kinds: ["whole_picture", "priorities", "health"],
    tools: ["whole_picture", "priorities", "health_score"],
    answer: janeAnswer,
  },
  // Spec step 203: what-if scenarios; step 209: the long view.
  {
    id: "what_if",
    bank: ["scenarios"],
    kinds: ["what_if"],
    tools: ["what_if"],
    answer: janeAnswer,
  },
  {
    id: "long_view",
    bank: ["longview"],
    kinds: ["long_view"],
    tools: ["long_view"],
    answer: janeAnswer,
  },
  // Spec step 253: the picture of you.
  {
    id: "profile",
    bank: ["profile"],
    kinds: ["profile"],
    tools: ["my_profile"],
    answer: janeAnswer,
  },
  // Spec step 240: a steady paycheck from uneven income.
  {
    id: "steady_pay",
    bank: ["steady"],
    kinds: ["steady_pay"],
    tools: ["steady_pay"],
    answer: janeAnswer,
  },
  {
    id: "did",
    bank: ["timeline", "settings"],
    kinds: ["checked", "timeline", "what_did"],
    tools: ["nightly_log"],
    answer: janeAnswer,
  },
  {
    id: "act",
    bank: ["act"],
    kinds: ["act", "approve_all", "undo", "multi", "move_to_goal"],
    tools: ["propose_action"],
    answer: janeAnswer,
  },
  {
    id: "autopilot",
    bank: ["settings"],
    kinds: ["autopilot_overview", "autopilot_sector", "pause_autopilot"],
    tools: ["autopilot_settings"],
    answer: janeAnswer,
  },
  {
    id: "memory",
    bank: ["follow", "help"],
    kinds: [
      "remember",
      "search",
      "flow",
      "help",
      "greeting",
      "ack",
      "remind",
      "learn",
      "follow_up",
      "explain",
      "why_finding",
      "unknown",
    ],
    tools: ["explainer"],
    answer: janeAnswer,
  },
  {
    id: "life_event",
    bank: ["life"],
    kinds: ["life_event"],
    tools: ["life_events"],
    answer: janeAnswer,
  },

  // Sectors.
  {
    id: "insurance",
    bank: ["insurance"],
    kinds: ["insurance"],
    tools: ["insurance_policies"],
    answer: insuranceAnswer,
    // "Should I get umbrella insurance?" (docs/decisions.md).
    ...insuranceDecider,
  },
  {
    id: "taxes",
    bank: ["taxes", "giving"],
    kinds: ["tax"],
    // Every tax tool Claude has (src/lib/jane-agent/tax-tools.ts).
    tools: [
      "tax_estimate",
      "tax_accountant",
      "tax_calendar",
      "tax_equity",
      "tax_family",
      "tax_forms",
      "tax_giving",
      "tax_home",
      "tax_identity",
      "tax_investments",
      "tax_last_return",
      "tax_notices",
      "tax_plan",
      "tax_profile",
      "tax_property",
      "tax_records",
      "tax_refunds",
      "tax_return",
      "tax_savings",
      "tax_self_employed",
      "tax_side_income",
      "tax_states",
      "tax_tags",
      "tax_withholding",
      "tax_years",
      "tax_business",
      "tax_inherited",
      "tax_health",
      "tax_decide",
    ],
    answer: taxAnswer,
    decides: ["tax"],
    decide: taxDecide,
  },
  {
    id: "investing",
    bank: [
      "investing",
      "hsa",
      "crypto",
      "cash",
      "retirement",
      "oldaccounts",
      "family",
      "property",
      "costly",
      "invreview",
      "location",
      "planmenu",
      "performance",
      "shortterm",
      "windfall",
      "values",
      "familyfile",
    ],
    kinds: ["investments"],
    // Every investing tool Claude has: the overview first, then one per topic.
    tools: [
      "investments_overview",
      "company_stock",
      "crypto",
      "cash_plan",
      "steady_hand",
      "retirement_accounts",
      "old_accounts",
      "retirement_income",
      "family_investing",
      "property",
      "costly_products",
      "yearly_review",
      "asset_location",
      "plan_menu",
      "honest_performance",
      "short_term_money",
      "sudden_money",
      "values_investing",
      "family_file",
    ],
    answer: investingAnswer,
  },
  {
    id: "debt",
    bank: ["debt", "loans", "student", "credit"],
    decides: ["loan", "payoff_or_invest"],
    decide: debtDecide,
    kinds: [...DEBT_KINDS] as Capability["kinds"],
    tools: [
      "debts",
      "payoff_plan",
      "credit_score",
      "student_loans",
      "mortgage",
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
      "home_equity",
      "debt_trouble",
      "debt_review",
      "car_loan",
      "debt_decision",
      "loan_fit",
    ],
    answer: debtAnswer,
  },
];

const byKind = new Map<string, Capability>();
for (const capability of CAPABILITIES) {
  for (const kind of capability.kinds) byKind.set(kind, capability);
}

// The capability that answers this kind of question, if one does.
export const capabilityFor = (intent: Intent): Capability | undefined => byKind.get(intent.kind);
