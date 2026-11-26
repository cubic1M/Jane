import { describe, expect, it } from "vitest";
import { readReplyByRules } from "./read-reply";

// CodeRabbit part 2: a company's reply is "done" only when it says the thing was done, in what it
// wrote now: not in the history it quoted, not for a hold or a closed ticket.

describe("reading a company's reply by rules", () => {
  it("does not take the quoted history for the answer", () => {
    const reading = readReplyByRules(
      "Please provide the receipt.\n> We have cancelled the subscription.",
    );
    expect(reading.outcome).toBe("needs_info");
  });

  it("does not call a hold or a closed ticket a refund or a cancelled account", () => {
    expect(
      readReplyByRules("We have applied a temporary hold while we investigate your refund request.")
        .outcome,
    ).toBe("unclear");
    expect(readReplyByRules("We have closed your ticket.").outcome).toBe("unclear");
    expect(
      readReplyByRules(
        "We have applied a new temporary hold while we investigate your refund request.",
      ).outcome,
    ).toBe("unclear");
  });

  it("reads a qualified fee or price as done", () => {
    for (const text of [
      "We have reversed the annual fee.",
      "We've reversed the duplicate charge.",
      "We have applied a lower rate to your plan.",
    ]) {
      expect(readReplyByRules(text).outcome, text).toBe("done");
    }
  });

  // CodeRabbit #2286: a new fee is not a completed request.
  it("does not read a new fee as the request being done", () => {
    const reading = readReplyByRules(
      "We have applied a new account review fee. Please provide the receipt.",
    );
    expect(reading.outcome).toBe("needs_info");
    expect(readReplyByRules("We have applied a lower rate to your plan.").outcome).toBe("done");
    // CodeRabbit #2286: a higher or unchanged rate is not the request done, and a reply that also
    // asks for something is what it asks.
    expect(readReplyByRules("We have applied a new higher interest rate.").outcome).not.toBe(
      "done",
    );
    expect(
      readReplyByRules("We have applied a new higher interest rate. Please provide the receipt.")
        .outcome,
    ).toBe("needs_info");
    expect(readReplyByRules("The rate is unchanged.").outcome).not.toBe("done");
    expect(
      readReplyByRules("We have applied a lower rate. Please provide the receipt.").outcome,
    ).toBe("needs_info");
  });

  it("still reads a confirmation as done", () => {
    for (const text of [
      "We have cancelled your subscription.",
      "We've applied a credit to your account.",
      "We have reversed the charge.",
      "We've closed your account.",
      "Your refund has been processed.",
    ]) {
      expect(readReplyByRules(text).outcome, text).toBe("done");
    }
  });

  it("reads a lower rate with words between 'lower' and 'rate' as done", () => {
    expect(readReplyByRules("We have applied a lower interest rate to your plan.").outcome).toBe(
      "done",
    );
  });
});
