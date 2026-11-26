import { describe, expect, it } from "vitest";
import { decideSummary } from "./jane";

// "To decide" beside its heading on /jane.

const none = { total: 0, totalSavingsCents: 0, onceCents: 0 };

describe("what To decide says", () => {
  it("never says there's nothing while the first scan is still reading", () => {
    expect(decideSummary(none, true)).toBe("still reading your accounts");
    expect(decideSummary(none, false)).toBe("nothing right now");
  });

  it("counts what there is, with what it's worth, scanning or not", () => {
    const some = { total: 3, totalSavingsCents: 120_000, onceCents: 0 };
    expect(decideSummary(some, false)).toBe(
      "3 things to look at, worth up to about $1,200.00 a year",
    );
    expect(decideSummary(some, true)).toBe(decideSummary(some, false));
    expect(decideSummary({ ...some, total: 1, totalSavingsCents: 0 }, false)).toBe(
      "1 thing to look at",
    );
  });
});
