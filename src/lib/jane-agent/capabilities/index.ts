import { answerDebt } from "../debt-answer";
import { DEBT_KINDS, type DebtIntent } from "../debt-intents";
import type { Intent } from "../intents";
import { insuranceAnswer } from "./insurance";
import { investingAnswer } from "./investing";
import { janeAnswer } from "./jane";
import { moneyAnswer } from "./money";
import type { Capability } from "./shared";
import { taxAnswer } from "./tax";

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
    kinds: ["safe_to_spend", "afford"],
    tools: ["safe_to_spend"],
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
    kinds: ["remember", "search", "flow", "help", "greeting", "learn", "follow_up", "unknown"],
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
  },
  {
    id: "taxes",
    bank: ["taxes", "giving"],
    kinds: ["tax"],
    tools: ["tax_estimate"],
    answer: taxAnswer,
  },
  {
    id: "investing",
    bank: ["investing", "hsa"],
    kinds: ["investments"],
    tools: ["investments_overview"],
    answer: investingAnswer,
  },
  {
    id: "debt",
    bank: ["debt", "loans", "student", "credit"],
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
