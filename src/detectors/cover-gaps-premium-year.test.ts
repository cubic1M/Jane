import { describe, expect, it } from "vitest";
import { monthlyChargeYear } from "./helpers";

// CodeRabbit sweep 1b (#2258): a premium is put on a year by the months it was charged in, not by
// the months of the whole history: an annual premium of $1,200 in 4 months of history read $3,600.
const row = (date: string, amountCents: number) => ({ date, amountCents });

describe("monthlyChargeYear", () => {
  it("puts a premium charged every month on a year", () => {
    const rows = [row("2026-06-03", 20_000), row("2026-07-03", 20_000), row("2026-08-03", 20_000)];
    expect(monthlyChargeYear(rows)).toBe(240_000);
  });
  it("says nothing of one annual premium seen in a short history", () => {
    expect(monthlyChargeYear([row("2026-06-03", 120_000)])).toBeNull();
  });
  it("says nothing of a quarterly premium", () => {
    const rows = [row("2026-01-03", 30_000), row("2026-04-03", 30_000), row("2026-07-03", 30_000)];
    expect(monthlyChargeYear(rows)).toBeNull();
  });
  it("says nothing of fewer than 3 months", () => {
    expect(monthlyChargeYear([row("2026-06-03", 20_000), row("2026-07-03", 20_000)])).toBeNull();
  });
  it("counts two charges in one month once", () => {
    const rows = [
      row("2026-06-03", 10_000),
      row("2026-06-20", 10_000),
      row("2026-07-03", 20_000),
      row("2026-08-03", 20_000),
    ];
    expect(monthlyChargeYear(rows)).toBe(240_000);
  });
});
