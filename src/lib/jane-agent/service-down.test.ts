import { describe, expect, it } from "vitest";
import { claudeIsDown, merchantAsked, serviceDownReply, SERVICE_DOWN_TEXT } from "./service-down";

describe("which failures mean Claude itself is down", () => {
  it("counts a refused key, an outage and a timeout, not a cap or a block", () => {
    for (const reason of ["key_refused", "api_error", "cooldown", "too_slow", "no_time"]) {
      expect(claudeIsDown(reason), reason).toBe(true);
    }
    for (const reason of [
      "daily_cap",
      "month_cap",
      "empty",
      "stop_refusal",
      "turn_cap",
      undefined,
    ]) {
      expect(claudeIsDown(reason), String(reason)).toBe(false);
    }
  });
});

describe("the place a question names", () => {
  it.each([
    ["did I buy something from california arts before", "california arts"],
    ["how much did I spend at Trader Joe's this year?", "Trader Joe's"],
    ["Did I buy a gift for my daughter from California Arts before?", "California Arts"],
    ["Did I pay for Netflix before?", "Netflix"],
    ["did I pay the dentist last month", null],
    ["when did I last pay netflix", null],
    ["what's my balance", null],
  ])("%s", (question, place) => {
    expect(merchantAsked(question)).toBe(place);
  });
});

describe("the reply when Claude can't be reached", () => {
  it("is plain, and offers the transactions page with the search filled in", () => {
    const reply = serviceDownReply("did I buy something from california arts before");
    expect(reply.body).toContain(SERVICE_DOWN_TEXT);
    expect(reply.body).not.toMatch(/ask again|key|401|error/i);
    expect(reply.actions).toEqual([
      expect.objectContaining({ href: "/transactions?q=california%20arts" }),
    ]);
  });

  it("has no link when no place is named, and no technical word", () => {
    const reply = serviceDownReply("how am I doing");
    expect(reply.body).toBe(SERVICE_DOWN_TEXT);
    expect(reply.actions).toEqual([]);
  });
});
