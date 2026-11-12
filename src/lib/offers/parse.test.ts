import { describe, expect, it } from "vitest";
import { blockedBy, disallowedFor } from "./fetch";
import {
  fingerprintOf,
  readFdicNational,
  readFredSeries,
  readPlanPrices,
  readSavingsApy,
  readTreasuryBills,
} from "./parse";

// The offers catalog's readers, on pages shaped like the real ones (read 2026-11-12): each finds the
// figure the page states and leaves out what it can't find, never a guess.

describe("Treasury's bill auctions", () => {
  it("takes each term's latest held auction, passing over one not yet held", () => {
    const body = {
      data: [
        { auction_date: "2026-10-19", security_term: "13-Week", high_investment_rate: "null" },
        { auction_date: "2026-10-15", security_term: "4-Week", high_investment_rate: "4.068000" },
        { auction_date: "2026-10-13", security_term: "13-Week", high_investment_rate: "4.190000" },
        { auction_date: "2026-10-06", security_term: "13-Week", high_investment_rate: "4.250000" },
        { auction_date: "2026-10-13", security_term: "6-Week", high_investment_rate: "4.055000" },
      ],
    };
    expect(readTreasuryBills(body)).toEqual({ "tbill.4w": 407, "tbill.13w": 419 });
    expect(readTreasuryBills({ error: "Invalid Query Param" })).toEqual({});
  });
});

describe("the FDIC's national rates", () => {
  it("reads each product's national rate from the table, not the page's prose", () => {
    const html = `<p>Savings accounts are covered below.</p><h2>Monthly Rate Cap Information as of October 19, 2026</h2>
      <table><tr><td>Savings</td><td>0.38</td><td>1.13</td></tr>
      <tr><td>Interest Checking</td><td>0.07</td><td>0.82</td></tr>
      <tr><td>Money Market</td><td>0.63</td><td>1.38</td></tr>
      <tr><td>12 month CD</td><td>1.76</td><td>2.51</td></tr></table>`;
    expect(readFdicNational(html)).toEqual({
      "fdic.savings": 38,
      "fdic.checking": 7,
      "fdic.money_market": 63,
      "fdic.cd_12m": 176,
    });
    expect(readFdicNational("<p>Page moved</p>")).toEqual({});
  });
});

describe("a FRED series", () => {
  it("takes the newest observation that has a value", () => {
    expect(
      readFredSeries({
        observations: [
          { date: "2026-10-29", value: "6.31" },
          { date: "2026-11-05", value: "6.27" },
          { date: "2026-11-12", value: "." },
        ],
      }),
    ).toBe(627);
    expect(readFredSeries({})).toBeNull();
  });
});

describe("a bank's savings page", () => {
  it("takes the account's top stated APY over its lower tiers", () => {
    const html = `<script>var x = "9.99% APY";</script><h1>Platinum Savings</h1>
      <p>Earn 3.75% APY on balances of $5,000 or more</p><p>0.25% APY under $5,000</p>`;
    expect(readSavingsApy(html, "savings.cit_platinum")).toEqual({ "savings.cit_platinum": 375 });
    expect(readSavingsApy("<p>Rates load here</p>", "savings.x")).toEqual({});
  });
});

describe("a streaming service's plans page", () => {
  it("reads the price after a free first month, for the usual plan and the student plan", () => {
    const spotify = `<nav>Individual</nav><h3>Premium Individual</h3><p>$0 for 1 month</p><p>$12.99 / month after</p>
      <h3>Premium Student</h3><p>$0 for 1 month</p><p>$6.99 / month after</p><h3>Duo</h3><p>$18.99 / month</p>`;
    expect(readPlanPrices(spotify, "spotify")).toEqual({
      "plan.spotify.individual": 1_299,
      "plan.spotify.student": 699,
    });
    const apple = `<p>Individual $11.99/month, first month free</p><p>Family $19.99/month</p>
      <p>Student Extra savings at just $6.99/month, first month free</p>`;
    expect(readPlanPrices(apple, "apple_music")).toEqual({
      "plan.apple_music.individual": 1_199,
      "plan.apple_music.student": 699,
    });
  });

  it("leaves out a plan it can't price", () => {
    expect(readPlanPrices("<p>Student plans available</p>", "x")).toEqual({});
  });
});

describe("a page's fingerprint", () => {
  it("changes with its words, not its markup", () => {
    expect(fingerprintOf('<p class="a">3.65% APY</p>')).toBe(
      fingerprintOf('<div id="b">3.65% APY</div>'),
    );
    expect(fingerprintOf("<p>3.65% APY</p>")).not.toBe(fingerprintOf("<p>3.70% APY</p>"));
  });
});

describe("robots.txt", () => {
  const robots = `User-agent: googlebot
Disallow: /everything/

User-agent: *
Disallow: /*/xhr/*
Disallow: /private
Allow: /private/ok

User-agent: OtherBot
Disallow: /us/premium/`;

  it("keeps only the rules for every robot", () => {
    expect(disallowedFor(robots)).toEqual(["/*/xhr/*", "/private"]);
  });

  it("refuses a path a rule names, with its wildcards", () => {
    const rules = disallowedFor(robots);
    expect(blockedBy(rules, "/us/premium/")).toBe(false);
    expect(blockedBy(rules, "/us/xhr/prices")).toBe(true);
    expect(blockedBy(rules, "/private/ok")).toBe(true);
    expect(blockedBy([], "/anything")).toBe(false);
  });
});
