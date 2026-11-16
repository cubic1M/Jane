import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Debugger 11-16 (an uploaded checking and Chase card, $339 a year in card interest): "Cut your
// card interest" on Loans & credit opened this page, which said "This needs a lending partner, and
// there isn't one for your accounts yet." and nothing else. No real account has a lending partner,
// so every one of them got that. Without one, the page sends the person on: to the card interest
// finding, whose steps and call script they follow themselves, or to the payoff plan. The redirect
// is in the page (e2e/card-interest-no-partner.spec.ts walks it).

const page = readFileSync(join(__dirname, "page.tsx"), "utf8");

describe("the card interest page without a lending partner", () => {
  it("isn't a dead end", () => {
    expect(page).not.toMatch(/needs a lending partner/);
  });

  it("opens the card interest finding's steps, or the payoff plan", () => {
    expect(page).toMatch(/type: "card_interest"/);
    expect(page).toMatch(/redirect\(finding \? `\/report\/\$\{finding\.id\}/);
    expect(page).toMatch(/`\/debt\$\{back\}`/);
  });
});
