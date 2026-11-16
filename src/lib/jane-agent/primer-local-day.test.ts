import { describe, expect, it } from "vitest";
import { usablePrimer } from "./primer-store";

// Gate C (11-16): the numbers saved for Claude were today's by UTC's day, as the chat's snapshot was
// before #1910. Saved at 7pm in Los Angeles, they were still said at 3pm the next day, yesterday's
// "in 3 days" with them; saved at 9am, they were thrown away at 4pm. Today is the person's.

const ZONE = "America/Los_Angeles";
const saved = (at: string) => ({ builtAt: new Date(at), stamp: null });

describe("the saved numbers for Claude", () => {
  it("aren't said the next day, saved in the evening", () => {
    // 7pm on Nov 10, read at 3pm on Nov 11.
    expect(
      usablePrimer(saved("2026-11-11T03:00:00Z"), null, new Date("2026-11-11T23:00:00Z"), ZONE),
    ).toBe(false);
  });

  it("are said all day, saved in the morning", () => {
    // 9am on Nov 11, read at 7pm on Nov 11.
    expect(
      usablePrimer(saved("2026-11-11T17:00:00Z"), null, new Date("2026-11-12T03:00:00Z"), ZONE),
    ).toBe(true);
  });

  it("go by the person's own zone", () => {
    // 1:30am and 3:30pm on Nov 11 in Kolkata: Nov 10 and Nov 11 in UTC.
    expect(
      usablePrimer(
        saved("2026-11-10T20:00:00Z"),
        null,
        new Date("2026-11-11T10:00:00Z"),
        "Asia/Kolkata",
      ),
    ).toBe(true);
  });
});
