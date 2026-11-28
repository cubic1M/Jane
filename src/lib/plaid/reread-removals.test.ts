import { describe, expect, it } from "vitest";
import { postedCap } from "./reread-removals";

describe("how many posted rows a read from the start may remove", () => {
  it("is the larger of the fixed number and the share of the link's rows", () => {
    expect(postedCap(21)).toBe(5);
    expect(postedCap(400)).toBe(8);
  });
});
