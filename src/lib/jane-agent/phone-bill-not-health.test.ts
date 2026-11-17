import { describe, expect, it } from "vitest";
import { parseIntent } from "./intents";

// Debugger 11-17 (r325, Plaid sandbox checking paying Visible Wireless $45 a month, chat on a
// phone): "is my phone bill too high?" answered "I don't have your health plan's deductible and
// out-of-pocket maximum yet." The health plan's "is this bill right?" took any bill. An everyday
// bill is what it costs; a medical bill is still the medical bill check.

const TODAY = "2026-11-17";

describe("is my bill too high", () => {
  it("is what a phone or internet bill costs", () => {
    expect(parseIntent("is my phone bill too high?", TODAY)).toEqual({
      kind: "cost",
      target: "phone",
      year: false,
    });
    expect(parseIntent("is my internet bill too much", TODAY)).toMatchObject({
      kind: "cost",
      target: "internet",
    });
  });

  it("is still the medical bill check for a medical bill", () => {
    expect(parseIntent("is this hospital bill right?", TODAY).kind).toBe("medical_bills");
    expect(parseIntent("was the bill correct", TODAY)).toMatchObject({
      kind: "insurance",
      ask: "health_year",
    });
  });
});
