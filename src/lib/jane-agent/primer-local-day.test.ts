import { describe, expect, it } from "vitest";
import { cachedPrimer, forgetPrimer, keepPrimer } from "./primer-cache";
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

  // CodeRabbit part 2: the memory copy is dropped at the person's own midnight, not by its age alone.
  it("drops the copy in memory past the person's midnight", () => {
    const primer = { text: "today: Nov 11", cents: [] };
    keepPrimer("u-midnight", new Date("2026-11-12T07:59:00Z"), primer, ZONE);
    expect(cachedPrimer("u-midnight", new Date("2026-11-12T07:59:30Z"))).toBe(primer);
    expect(cachedPrimer("u-midnight", new Date("2026-11-12T08:00:30Z"))).toBeNull();
    forgetPrimer("u-midnight");
  });
});
