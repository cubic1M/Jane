import { describe, expect, it } from "vitest";
import { parseIntent } from "./intents";

// Debugger 11-19 and 11-20 (r359 and r372, upload S3 on a phone: Chase checking paying Toyota Motor
// Credit $338.12 a month): "how much do I pay for my car each month?" answered with gas ("You spent
// $36.62 on Transportation in November 2026 so far"), though "how much is my car payment?" names
// the loan. Asked as what's paid each month, it's the same question.

const ASOF = "2026-11-20";

describe("what's paid for a car or a student loan each month", () => {
  it.each([
    ["how much do I pay for my car each month?", "car"],
    ["how much do i pay for my car", "car"],
    ["how much do I pay each month for my student loan?", "student loan"],
  ])("%s is about the %s", (question, target) => {
    expect(parseIntent(question, ASOF)).toEqual({ kind: "debt_detail", target });
  });

  it("leaves gas and car insurance to their own answers", () => {
    expect(parseIntent("how much do I pay for gas each month?", ASOF)).toMatchObject({
      kind: "cost",
    });
    expect(parseIntent("how much do i pay for car insurance?", ASOF)).toMatchObject({
      kind: "insurance",
    });
  });
});
