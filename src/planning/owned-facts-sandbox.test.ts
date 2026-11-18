import { describe, expect, it } from "vitest";
import { investmentSummary } from "@/insights/investments";
import { ownedFacts } from "./owned-facts";

// Plaid Investments on, walked in the Plaid sandbox (11-17): what a First Platypus Bank brokerage
// user's holdings look like as Plaid sends them, and what the Investing page's summary says.

const accounts = [
  {
    id: "a401k",
    name: "Plaid 401k",
    subtype: "401k",
    balanceCents: 2_363_198,
    institution: "First Platypus Bank",
  },
  {
    id: "ahsa",
    name: "Plaid Cares Health Savings Account",
    subtype: "hsa",
    balanceCents: 600_900,
    institution: "First Platypus Bank",
  },
  {
    id: "acd",
    name: "Plaid Bronze Standard 0.2% Interest CD",
    subtype: "cd",
    balanceCents: 100_000,
    institution: "First Platypus Bank",
  },
];
const securities = [
  { id: "usd", name: "U S Dollar", ticker: null, type: "cash", isCashEquivalent: true },
  // Plaid's sandbox flags Bitcoin as a cash equivalent.
  { id: "btc", name: "Bitcoin", ticker: "BTC", type: "cryptocurrency", isCashEquivalent: true },
  {
    id: "sbsi",
    name: "Southside Bancshares Inc.",
    ticker: "SBSI",
    type: "equity",
    isCashEquivalent: false,
  },
  {
    id: "tbill",
    name: "United States Treas Bills 0.000% 10/31/24",
    ticker: null,
    type: "fixed income",
    isCashEquivalent: false,
  },
  {
    id: "camyx",
    name: "Cambiar International Equity Institutional",
    ticker: "CAMYX",
    type: "mutual fund",
    isCashEquivalent: false,
  },
  {
    id: "call",
    name: "Nflx Feb 01'18 $355 Call",
    ticker: "NFLX180201C00355000",
    type: "derivative",
    isCashEquivalent: false,
  },
];
const holding = (securityId: string, valueCents: number) => ({
  id: `h${securityId}`,
  accountId: "a401k",
  securityId,
  quantity: 1,
  priceCents: valueCents,
  priceAsOf: "2026-11-16",
  valueCents,
  costBasisCents: null,
});
const holdings = [
  holding("usd", 1_234_567),
  holding("btc", 11_557),
  holding("sbsi", 739_749),
  holding("tbill", 94_808),
  holding("camyx", 185_588),
  holding("call", 11_000),
];

const summary = investmentSummary(accounts, securities, holdings);
const facts = ownedFacts(summary.accounts)!;

describe("the Investing summary on Plaid's sandbox holdings", () => {
  it("never counts Bitcoin as uninvested cash, though Plaid flags it", () => {
    expect(facts.cash.cents).toBe(1_234_567);
    expect(facts.sentences.join(" ")).toContain("$12,345.67");
  });

  it("asks a fee only of a fund: not a Treasury bill, an option or a coin", () => {
    expect(facts.fees.unknownNames).toEqual(["CAMYX"]);
    // With no fee total to leave it out of, it doesn't say "that total".
    expect(facts.sentences.join(" ")).not.toContain("that total");
  });

  it("calls only funds 'funds whose mix I don't know', never a coin or an option", () => {
    const mixLine = facts.sentences[0]!;
    expect(mixLine).not.toMatch(/funds whose mix I don't know \([^)]*(BTC|NFLX)/);
    // The coin and the option are "other"; the fund is still named beside them.
    expect(mixLine).toMatch(/\d+% other, \d+% in funds whose mix I don't know \(CAMYX\)\.$/);
  });

  it("says the same total as the page's tree, and names accounts that list no holdings", () => {
    expect(summary.totalCents).toBe(3_064_098);
    const text = facts.sentences.join(" ");
    expect(text).toContain("You own $30,640.98.");
    expect(text).toContain(
      "Plaid Cares Health Savings Account and Plaid Bronze Standard 0.2% Interest CD don't list what they hold.",
    );
    expect(text).toContain("of what your accounts list");
  });
});
