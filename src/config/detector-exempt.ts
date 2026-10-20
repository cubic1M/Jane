// Registry capabilities (src/lib/jane-agent/capabilities) that don't make suggestions of
// their own, and why (spec step 254). Every other capability needs a detector in
// src/detectors, and a test fails if a new one has neither. Remove an entry when a detector
// for it is added.

export const DETECTOR_EXEMPT: Readonly<Record<string, string>> = {
  goals: "shows and sets the goals the person chose; the emergency-fund detector suggests one",
  payday:
    "answers when and how much the paycheck is; the steady-paycheck detector (steady_pay) covers uneven pay",
  coming_up: "lists bills and dates; nothing to suggest",
  saved: "reports what Jane already saved",
  whole_picture: "summarises the other capabilities",
  what_if: "a scenario the person asks for; the strategist (step 256) uses it as a tool",
  long_view: "a projection the person asks for; the strategist uses it as a tool",
  profile: "shows and corrects what Jane knows",
  did: "reports what Jane did",
  act: "carries out a button the person tapped",
  autopilot: "settings for what Jane may do alone",
  memory: "what Jane remembers",
  life_event: "checklists the person opens; suggestions arrive through the detectors",
};

// Registry tools (src/lib/jane-agent/claude-tools.ts) that look things up or act when asked and
// never suggest by themselves, and why (spec step 254). Every other tool is covered by a
// detector (`covers` on src/detectors) or is on the shrinking list in src/detectors/missing.ts.
export const TOOL_EXEMPT: Readonly<Record<string, string>> = {
  insurance_household:
    "needs the people the person lists on their insurance page and the policies they share; the profile holds neither, so a household gap can't be judged from the bank",
  tax_profile:
    "shows and sets the tax profile (filing status, children, state, how the person is paid)",
  tax_refunds:
    "shows the refunds Jane matched to the estimate and their plan; the plan arrives as a message when a deposit lands",
  tax_states:
    "works out the split when the person tells Jane about a move or a job in another state; nothing in the bank shows one",
  tax_last_return:
    "reads a return the person uploads and reviews it; the findings are shown when the upload arrives",
  tax_notices:
    "reads a letter the person uploads, checks it and drafts a reply; nothing is visible until one is uploaded",
  tax_accountant:
    "makes a read-only link when the person asks; a link is a credential, so Jane never makes one by herself",
  search_transactions: "looks up transactions the person asks about",
  spending_by_category: "answers what was spent where",
  monthly_totals: "answers month totals",
  list_actions: "lists what Jane did",
  upcoming_bills: "lists bills; nothing to suggest",
  coming_up: "lists what is due",
  open_findings: "lists findings, which already reach the person as decisions",
  finding_details: "explains a finding the person asks about",
  net_worth: "reports net worth",
  recent_changes: "reports changes, which already reach the person as heads-ups",
  proven_savings: "reports what Jane saved",
  autopilot_settings: "settings for what Jane may do alone",
  nightly_log: "reports what Jane checked",
  monthly_report: "reports the month",
  my_profile: "shows what Jane knows",
  long_view: "a projection the person asks for",
  what_if: "a scenario the person asks for",
  whole_picture: "summarises the other tools",
  priorities: "ranks what other tools found",
  health_score: "reports the score",
  money_moves: "lists transfers",
  propose_action: "offers a button for something else",
  show_block: "draws an answer",
  explainer: "explains a word",
  plan_upkeep: "reports budget upkeep",
  budgets: "shows budgets the person set",
  safe_to_spend: "answers how much is safe to spend",
  debt_autopilot: "reports what Jane does by herself for debts at the person's level",
  debt_review:
    "gathers the debt items the other detectors already raise, once a year, into one message",
  credit_goals: "a score plan the person asks for with their own target and date",
  car_purchase: "works out a car the person asks about; nothing in their data says they're buying",
  home_purchase:
    "works out a home the person asks about; nothing in their data says they're buying",
  loan_applications:
    "tracks an application the person started; the refinance and transfer detectors suggest them",
};
