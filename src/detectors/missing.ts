// Registry tools (the features Claude can look at, src/lib/jane-agent/claude-tools.ts) that no
// detector covers yet and that are not exempt (src/config/detector-exempt.ts), a ratchet: the
// list only shrinks (spec step 254). Each sector lane removes its tools as it adds detectors
// with `covers: [toolName]`. src/detectors/detectors.test.ts fails for a tool that is covered
// but still listed here, and for a tool that is not covered, not exempt and not listed. A new
// tool is never added to this list: it arrives with its detector or an exemption.

export const MISSING_DETECTOR: readonly string[] = [
  "debt_autopilot",
  "credit_score",
  "credit_building",
  "bnpl_installments",
  "tight_money",
  "car_purchase",
  "home_purchase",
  "medical_bills",
  "credit_report_fixes",
  "student_long_game",
  "family_loans",
  "credit_goals",
  "debt_review",
  "loan_applications",
  "life_events",
  "holdings",
  "investor_profile",
  "investment_fees",
  "portfolio_review",
  "rebalance_plan",
  "auto_invest",
  "investments_overview",
  "investment_returns",
  "goal_buckets",
  "old_accounts",
  "family_investing",
  "property",
  "costly_products",
  "yearly_review",
  "asset_location",
  "steady_hand",
  "crypto",
];
