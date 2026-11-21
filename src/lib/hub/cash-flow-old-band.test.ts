import { describe, expect, it } from "vitest";
import { cashFlowView } from "./view";

// Manager, 11-20: statements too old to walk to today (BALANCE_ROLL_MAX_DAYS) expect no pay
// (src/detection/paydays.ts), so Home's strip listed their bills alone, a shortfall that isn't
// there: upload S7, ending Oct 20, read Nov 25, showed rent Dec 3 and Comcast Dec 7 and no pay.
// With where they end known, the strip lists nothing as coming up and says so.

const read = {
  asOf: "2026-11-25",
  bills: [
    { merchant: "Essex Property", date: "2026-12-03", amountCents: 98_000 },
    { merchant: "Comcast California", date: "2026-12-07", amountCents: 8_999 },
  ],
  deposits: [],
  deadlines: [],
  historyDays: 142,
};

describe("Home's strip, from statements too old to walk to today", () => {
  it("lists none of their bills and says where they end", () => {
    const view = cashFlowView({ ...read, statementsEnd: "2026-10-20" });
    expect(view.events).toEqual([]);
    expect(view.empty).toBe(
      "Your statements end Oct 20, 2026: upload newer ones to see what's due now.",
    );
  });

  it("lists them while the statements still reach now", () => {
    expect(cashFlowView(read).events.map((e) => e.label)).toEqual([
      "Essex Property",
      "Comcast California",
    ]);
  });
});
