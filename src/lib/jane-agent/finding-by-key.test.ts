import { describe, expect, it } from "vitest";
import { findingByKey } from "./finding-by-key";

// Debugger 10-31: which open finding a charge points to was the database's order, so it changed
// between runs when two findings share a key.
describe("findingByKey", () => {
  const at = (day: number) => new Date(Date.UTC(2026, 9, day));
  it("prefers the particular finding over the general review, then the oldest", () => {
    const review = {
      id: "r",
      key: "merchant:netflix",
      type: "subscription_review",
      createdAt: at(1),
    };
    const rise = { id: "p", key: "merchant:netflix", type: "price_increase", createdAt: at(5) };
    const fee = { id: "f", key: "account:a", type: "bank_fees", createdAt: at(2) };
    expect(findingByKey([review, rise, fee])).toEqual(
      new Map([
        ["merchant:netflix", "p"],
        ["account:a", "f"],
      ]),
    );
    expect(findingByKey([rise, review]).get("merchant:netflix")).toBe("p");
  });
});
