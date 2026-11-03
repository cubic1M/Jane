import { describe, expect, it } from "vitest";
import { nameMatches } from "./names";

// 11-03, Claude refusing every time: "for my car" found the credit card payment, "and my rent" the
// current price of Netflix, and a bare "what" the finding whose title says "covers what Asurion does".
describe("nameMatches", () => {
  it.each([
    ["car", "Credit card payment"],
    ["rent", "Netflix current plan went up"],
    ["what", "Your card already covers what Asurion does"],
    ["which card", "Credit card payment"],
  ])("%s isn't %s", (target, name) => {
    expect(nameMatches(target, name)).toBe(false);
  });

  it.each([
    ["netflix", "Netflix"],
    ["netf", "Netflix"],
    ["card", "Credit card payment"],
    ["car", "Car insurance"],
    ["fitness", "PLANETFITNESS"],
    ["gym", "Planet Fitness"],
    ["netflx", "Netflix"],
    ["verizon bill", "Verizon Wireless bill"],
  ])("%s is %s", (target, name) => {
    expect(nameMatches(target, name)).toBe(true);
  });
});
