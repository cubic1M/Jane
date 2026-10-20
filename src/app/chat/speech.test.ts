import { describe, expect, it } from "vitest";
import { heardError, spokenText, transcriptOf } from "./speech";

// Spec step 186: what the browser heard, and a message as words to read aloud.

const result = (transcript: string, isFinal: boolean) =>
  Object.assign([{ transcript }], { isFinal });

describe("what the browser heard", () => {
  it("joins the phrases in order and says whether the last is final", () => {
    expect(transcriptOf([result("how much can I ", true), result("spend", false)])).toEqual({
      text: "how much can I spend",
      final: false,
    });
    expect(transcriptOf([result(" cancel Hulu ", true)])).toEqual({
      text: "cancel Hulu",
      final: true,
    });
    expect(transcriptOf([])).toEqual({ text: "", final: false });
  });

  it("says what went wrong in plain words", () => {
    expect(heardError("not-allowed")).toMatch(/^The microphone is off for this site/);
    expect(heardError("no-speech")).toMatch(/^I didn't hear anything/);
    expect(heardError("network")).toBe("Speaking didn't work this time. Type instead.");
  });
});

describe("a message read aloud", () => {
  it("drops list marks and makes each line a sentence", () => {
    expect(
      spokenText(
        "These 2 matter most:\n1. Review your Hulu subscription\n- Due tomorrow",
        null,
        "Saved.",
      ),
    ).toBe("These 2 matter most: Review your Hulu subscription. Due tomorrow. Saved.");
  });
});
