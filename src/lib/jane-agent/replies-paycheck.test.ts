import { describe, expect, it } from "vitest";
import { paycheckReply } from "./replies-paycheck";

// Spec step 144: "split my paycheck" before a paycheck has come in.

describe("paycheckReply with no plan", () => {
  it("says when the next paycheck is and that the plan comes then", () => {
    const reply = paycheckReply(null, true, {
      date: "2026-11-01",
      cents: 245_000,
      from: "Acme Corp",
      asOf: "2026-10-19",
    });
    expect(reply.body).toBe(
      "I split each paycheck when it lands. Your next one is Nov 1 (in 13 days): about $2,450.00 from Acme Corp. I'll show you the plan then.",
    );
  });

  it("says it hasn't seen one when there's no regular paycheck", () => {
    expect(paycheckReply(null).body).toBe("I haven't seen a paycheck lately to split.");
  });
});
