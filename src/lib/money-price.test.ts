import { describe, expect, it } from "vitest";
import { formatPrice } from "./money";

describe("formatPrice", () => {
  it("drops the cents on whole dollars and keeps them otherwise", () => {
    expect(formatPrice(127_200)).toBe("$1,272");
    expect(formatPrice(127_250)).toBe("$1,272.50");
    expect(formatPrice(5)).toBe("$0.05");
    expect(formatPrice(0)).toBe("$0");
  });
});
