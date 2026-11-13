import { describe, expect, it } from "vitest";
import { doneSummary } from "./saved-amount";

// Debugger 11-12: a student said Yes to two cards ("Drop your mortgage insurance, save
// $1,562/yr", "Get your employer's full 401(k) match, earn $798/yr"). Yes only opened their
// pages; nothing had changed. /jane's Done then said "about $2,360.26 a year expected", above its
// own "Nothing finished yet". A yes is a decision, not something done: Done holds what happened.

describe("the Done section's summary", () => {
  it("is nothing yet while nothing is finished or confirmed, whatever was said yes to", () => {
    expect(doneSummary(236_026, 0)).toBe("nothing yet");
    expect(doneSummary(236_026, 0, 0)).toBe("nothing yet");
  });

  it("still counts what's finished, and what the transactions confirm", () => {
    expect(doneSummary(63_696, 1)).toBe("about $636.96 a year expected");
    expect(doneSummary(48_888, 0, 48_888)).toBe("$488.88 confirmed");
  });
});
