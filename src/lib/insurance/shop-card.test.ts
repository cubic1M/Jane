import { describe, expect, it } from "vitest";
import { DEMO_ADVICE_LABEL } from "@/config/advice";
import { cardProblems } from "@/lib/option-card";
import { toOptionSet } from "@/lib/option-set";
import type { StoredQuote } from "./quotes";
import type { Shop } from "./shop";
import { shopCard, shopIdOf } from "./shop-card";

// A reshop's quotes as the pick-one card (gap audit: the spec's option cards cover "insurance
// plans to switch to"): Jane's pick first, then the other quotes that also cost less.

const quote = (id: string, name: string, annual: number, sameCover = true): StoredQuote =>
  ({
    id,
    policyId: "p1",
    partner: "demo",
    partnerQuoteId: `pq-${id}`,
    carrier: { id, name, rating: "A", ratingScore: 90, claimsPhone: "", claimsUrl: "" },
    kind: "auto",
    premiumCents: Math.round(annual / 12),
    premiumFrequency: "monthly",
    annualPremiumCents: annual,
    termMonths: 6,
    deductibleCents: 50_000,
    coverage: {},
    sameCover,
    differences: sameCover ? [] : ["Lower injury limits"],
    demo: true,
    expiresAt: new Date("2026-11-01"),
    createdAt: new Date("2026-10-18"),
  }) as StoredQuote;

const shop = (over: Partial<Shop> = {}): Shop => ({
  id: "shop1",
  policyId: "p1",
  reason: "asked",
  status: "open",
  currentAnnualCents: 170_400,
  pick: quote("q1", "Lighthouse", 129_600),
  runnersUp: [
    quote("q2", "Harbor", 150_000),
    quote("q3", "Costly", 180_000),
    quote("q4", "Cheapest", 120_000, false),
  ],
  savingCents: 40_800,
  why: ["Same cover for $408.00 less a year.", "Rated A by the demo rater."],
  quoteCount: 4,
  demo: true,
  expiresAt: new Date("2026-11-01"),
  createdAt: new Date("2026-10-18"),
  ...over,
});

const policy = { carrier: "GEICO", kind: "auto" as const };

describe("shopCard", () => {
  it("puts Jane's pick first, then only the other quotes that cost less, cheapest first", () => {
    const card = shopCard(shop(), policy)!;
    expect(card.options.map((o) => o.id)).toEqual(["q1", "q4", "q2"]);
    expect(card.options[0]).toMatchObject({ isPick: true, label: "Lighthouse" });
    expect(card.options[0].whyThisOne).toBe("Same cover for $408.00 less a year.");
    expect(card.options[0].details).toContain(DEMO_ADVICE_LABEL);
    expect(card.options[1].whyThisOne).toBe(
      "$504.00 a year less than you pay now, but not the same cover.",
    );
    expect(card.options[1].facts).toContain("Different cover: Lower injury limits");
    expect(card).toMatchObject({ kind: "insurance", advice: true, newCover: false });
    expect(shopIdOf(card.topic)).toBe("shop1");
    expect(cardProblems(card)).toEqual([]);
  });

  it("floats as short cards: one dollar figure a year each, Jane's pick labelled", () => {
    const set = toOptionSet(shopCard(shop(), policy)!);
    expect(set.title).toBe("Switch your GEICO car insurance");
    expect(set.options[0]).toMatchObject({
      headline: "Lighthouse, $1,296/yr",
      badge: "Jane's pick",
    });
    for (const o of set.options) expect(o.headline.match(/\$[\d,]+/g)).toHaveLength(1);
  });

  it("is nothing when the shop is answered or has no pick", () => {
    expect(shopCard(shop({ status: "accepted" }), policy)).toBeNull();
    expect(shopCard(shop({ pick: null }), policy)).toBeNull();
    expect(shopIdOf("life")).toBeNull();
  });
});
