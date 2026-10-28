import { describe, expect, it } from "vitest";
import { ADVICE_TOPICS } from "./suggestions";

// Investing facts (what funds cost, what waiting cash earns, what an annuity costs) are for
// everyone; moves (switch, roll over, rebalance, start) are demo advice only.
describe("investing topics and real accounts", () => {
  it("keeps the fact topics open to everyone", () => {
    for (const t of ["investment_fees", "invested_cash", "costly_products", "beneficiaries"]) {
      expect(ADVICE_TOPICS).not.toContain(t);
    }
  });
  it("holds the investing moves for demo advice", () => {
    for (const t of ["old_accounts", "asset_location", "plan_menu", "rebalance", "auto_invest"]) {
      expect(ADVICE_TOPICS).toContain(t);
    }
  });
});
