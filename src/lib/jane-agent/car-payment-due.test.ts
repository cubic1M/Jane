import { describe, expect, it } from "vitest";
import { parseIntent } from "./intents";

// Desktop sweeps 7 to 9 (upload S3: Chase checking paying Toyota Financial $345.12 on the 9th):
// "when is my car payment due?" looked for a charge named "car", found none and said "I don't see a
// regular car payment yet". Asked when it's due, it's the car loan's answer, which names the next
// payment, as "how much is my car payment?" already is.

const ASOF = "2026-11-20";

describe("when the car payment is due", () => {
  it.each([
    "When is my car payment due?",
    "when's my car payment",
    "when does my car loan payment go out",
    "when do I pay my car loan",
    "when should i pay my auto loan",
  ])("%s is the car loan's answer", (question) => {
    expect(parseIntent(question, ASOF)).toEqual({
      kind: "debt_detail",
      target: question.includes("auto") ? "auto" : "car",
    });
  });

  it("leaves car insurance, rent and a student loan's due date to their own answers", () => {
    expect(parseIntent("when is my car insurance due", ASOF)).toMatchObject({ kind: "insurance" });
    expect(parseIntent("when is rent due", ASOF)).toMatchObject({ kind: "cost", target: "rent" });
    expect(parseIntent("when is my student loan payment due", ASOF)).toEqual({ kind: "debt_due" });
  });
});
