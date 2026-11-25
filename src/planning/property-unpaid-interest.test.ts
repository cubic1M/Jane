import { describe, expect, it } from "vitest";
import { interestOver } from "./property";

describe("interestOver when the payment is below the month's interest", () => {
  it("adds the unpaid interest to the balance", () => {
    // 100000 cents at 12% a year: 1000 cents of interest in month one, 500 paid.
    const one = interestOver(100_000, 1200, 500, 1);
    expect(one.interestCents).toBe(1000);
    expect(one.balanceCents).toBe(100_500);
    // Month two's interest is on the larger balance.
    const two = interestOver(100_000, 1200, 500, 2);
    expect(two.interestCents).toBe(1000 + 1005);
  });
  it("still amortizes normally and ends at zero", () => {
    const r = interestOver(100_000, 1200, 200_000, 3);
    expect(r.balanceCents).toBe(0);
  });
});
