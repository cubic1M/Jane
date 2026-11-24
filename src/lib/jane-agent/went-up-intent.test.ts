import { describe, expect, it } from "vitest";
import { parseIntent } from "./intents";

// Debugger 11-19 (r354 Plaid S6 and r358 upload S1, on a phone): "When did Netflix go up?" and "How
// much did Hulu go up?" got "I can't answer that one yet", while Jane had "Netflix went up from
// $15.49 to $17.99" and "Hulu went up from $9.99 to $11.99" on its cards. A question about one
// merchant's price going up is about that merchant: its price change, from its charges, which says
// when (11-23: before its card's summary, which didn't).

const ASOF = "2026-11-19";

describe("a merchant's price going up", () => {
  it.each([
    ["How much did Hulu go up?", "hulu"],
    ["When did Netflix go up?", "netflix"],
    ["did my phone bill go up?", "phone"],
    ["has Planet Fitness gone up", "planet fitness"],
  ])("%s is about %s", (question, target) => {
    expect(parseIntent(question, ASOF)).toEqual({ kind: "price_change", target });
  });

  // "Why" is the charge explained, with the day it went up (./charge-explain.ts), and the price
  // change's own answer when no charge goes by that name.
  it("why did my spotify go up is the charge explained, up", () => {
    expect(parseIntent("why did my spotify go up", ASOF)).toEqual({
      kind: "charge_explain",
      target: "spotify",
      amountCents: null,
      day: null,
      high: false,
      up: true,
    });
  });

  it("leaves prices that are about to go up to their own answer", () => {
    expect(parseIntent("any bills going up?", ASOF)).toEqual({ kind: "price_rises" });
  });
});
