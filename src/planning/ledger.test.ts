import { describe, expect, it } from "vitest";
import { HELD_DAYS, STOP_GRACE_DAYS, WATCH_DAYS } from "@/config/outcomes";
import {
  COUNTED,
  HELD_RULE,
  LEDGER_RULES,
  LEDGER_STATES,
  ledgerStateOf,
  notSeenRule,
  verifyRule,
} from "./ledger";

// The ledger's four states (and Not seen), and the rules shown beside them.

describe("the ledger's states", () => {
  it("walks Estimated, Done, Verified, Held; Not seen when it never showed or came back", () => {
    expect(ledgerStateOf({ status: "shown" })).toBe("estimated");
    expect(ledgerStateOf({ status: "open" })).toBe("done");
    expect(ledgerStateOf({ status: "unverifiable" })).toBe("done");
    expect(ledgerStateOf({ status: "partial" })).toBe("verified");
    expect(ledgerStateOf({ status: "confirmed", heldAt: null })).toBe("verified");
    expect(ledgerStateOf({ status: "confirmed", heldAt: new Date() })).toBe("held");
    expect(ledgerStateOf({ status: "not_seen" })).toBe("not_seen");
    expect(ledgerStateOf({ status: "lapsed" })).toBe("not_seen");
    expect(ledgerStateOf({ status: "declined" })).toBeNull();
  });

  it("counts Verified and Held only", () => {
    expect([...COUNTED].sort()).toEqual(["held", "verified"]);
    expect(LEDGER_STATES).toHaveLength(5);
  });
});

describe("the rules, shown", () => {
  it("say the numbers from config", () => {
    expect(verifyRule({ kind: "charge_stops", payees: [] })).toContain(`${STOP_GRACE_DAYS} days`);
    expect(verifyRule({ kind: "bill_drops", payees: [] })).toContain("3% lower");
    expect(verifyRule({ kind: "refund", payees: [] })).toContain("50%");
    expect(verifyRule(null)).toMatch(/^Stays an estimate/);
    expect(HELD_RULE).toContain(`${HELD_DAYS} days`);
    expect(notSeenRule({ kind: "refund", payees: [] })).toContain(`${WATCH_DAYS.refund} days`);
    expect(LEDGER_RULES[0]).toMatch(/Verified and Held only/);
  });
});
