import { describe, expect, it } from "vitest";
import { plural } from "./plural";

describe("plural", () => {
  it("writes a count with its noun", () => {
    expect(plural(1, "bill")).toBe("1 bill");
    expect(plural(3, "bill")).toBe("3 bills");
    expect(plural(0, "bill")).toBe("0 bills");
    expect(plural(2, "policy", "policies")).toBe("2 policies");
  });
});
