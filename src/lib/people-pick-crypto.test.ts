import { describe, expect, it, vi } from "vitest";

vi.mock("node:crypto", async (original) => {
  const real = await original<typeof import("node:crypto")>();
  return { ...real, randomInt: vi.fn(() => 1) };
});

import { randomInt } from "node:crypto";
import { PEOPLE } from "@/config/people";
import { pickPerson } from "./people";

// Code scanning (js/insecure-randomness, alert 107): which sample person "any" gets came from
// Math.random and flowed into a sample person's tax answers. It's chosen with node:crypto now; a
// test can still hand in its own random.
describe("a sample person chosen for the visitor", () => {
  it("comes from node:crypto, not Math.random", () => {
    const math = vi.spyOn(Math, "random");
    expect(pickPerson("any")).toBe(PEOPLE[1].id);
    expect(randomInt).toHaveBeenCalledWith(PEOPLE.length);
    expect(math).not.toHaveBeenCalled();
  });

  it("still takes a test's own random", () => {
    expect(pickPerson("any", () => 0)).toBe(PEOPLE[0].id);
  });
});
