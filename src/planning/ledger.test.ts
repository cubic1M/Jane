import { describe, expect, it } from "vitest";
import { HELD_DAYS, STOP_GRACE_DAYS, WATCH_DAYS } from "@/config/outcomes";
import {
  COUNTED,
  HELD_RULE,
  LEDGER_RULES,
  LEDGER_STATES,
  STATE_LABEL,
  ledgerStateOf,
  notSeenRule,
  verifyRule,
} from "./ledger";

// The ledger's four states (and Not seen), and the rules shown beside them.

describe("the ledger's states", () => {
  it("walks Estimated, Done, Verified, Held; Not seen when it never showed or came back", () => {
    const marked = new Date("2026-10-30T12:00:00Z");
    expect(ledgerStateOf({ status: "shown" })).toBe("estimated");
    expect(ledgerStateOf({ status: "open", doneAt: marked })).toBe("done");
    expect(ledgerStateOf({ status: "unverifiable", doneAt: marked })).toBe("done");
    expect(ledgerStateOf({ status: "partial" })).toBe("verified");
    expect(ledgerStateOf({ status: "confirmed", heldAt: null })).toBe("verified");
    expect(ledgerStateOf({ status: "confirmed", heldAt: new Date() })).toBe("held");
    expect(ledgerStateOf({ status: "not_seen" })).toBe("not_seen");
    expect(ledgerStateOf({ status: "lapsed" })).toBe("not_seen");
    expect(ledgerStateOf({ status: "declined" })).toBeNull();
  });

  // Debugger 10-30 (manager decision, honest labels): Yes on a dock card read "[DONE] Ask your
  // lender to drop mortgage insurance" on /saved though the person had only said yes. Done needs
  // a done mark ("I did it", Mark done); until then it's "You said yes".
  it("never says Done without a done mark", () => {
    for (const status of ["open", "unverifiable"]) {
      expect(ledgerStateOf({ status, doneAt: null })).toBe("said_yes");
      expect(ledgerStateOf({ status })).toBe("said_yes");
    }
    expect(STATE_LABEL.said_yes).toBe("You said yes");
  });

  it("counts Verified and Held only", () => {
    expect([...COUNTED].sort()).toEqual(["held", "verified"]);
    expect(LEDGER_STATES).toHaveLength(6);
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
