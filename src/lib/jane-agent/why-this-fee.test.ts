import { describe, expect, it } from "vitest";
import { aboutReply } from "./capabilities/money";
import { parseIntent } from "./intents";
import type { Recurring } from "./recurring";
import type { Snapshot, SnapshotFinding } from "./snapshot";

// Debugger 11-17 (r331, a U.S. Bank checking upload with a $6.95 monthly maintenance fee, chat on
// a phone): "why is there a $6.95 fee?" answered "I can't answer that one yet", as "why did I get
// charged $34?" (an overdraft, r324) and "why am I getting charged $12 every month?" (r322) did.
// A question about a fee is about the person's fees: the bank fee finding answers it.

const TODAY = "2026-11-17";

describe("why is there a fee", () => {
  it("is about the fees", () => {
    for (const text of [
      "why is there a $6.95 fee?",
      "why was i charged a maintenance fee",
      "why did i get an overdraft fee",
      "what is this $34 fee",
    ]) {
      expect(parseIntent(text, TODAY)).toEqual({ kind: "about", target: "fees" });
    }
  });

  it("finds the bank fee finding", () => {
    const fees: SnapshotFinding = {
      findingId: "f1",
      type: "bank_fees",
      title: "$20.85 in fees on US Bank checking in the last 3 months",
      annualSavingsCents: 8_340,
      savings: "Could save about $83.40 a year",
      fingerprint: "fees",
      urgent: false,
      pick: null,
    };
    const snapshot = { concierge: false, findings: [fees], asOf: TODAY } as unknown as Snapshot;
    const reply = aboutReply(
      { kind: "about", target: "fees" },
      { charges: [] } as unknown as Recurring,
      snapshot,
      TODAY,
    );
    expect(reply?.body).toMatch(/^\$20\.85 in fees on US Bank checking/);
  });
});
