import { describe, expect, it } from "vitest";
import { checkGuardrails, dollarFigures, recommendsAChoice } from "@/lib/guardrails";
import { tellsThemToAct } from "@/lib/real-account-text";
import { ADVICE_TOPICS } from "@/config/suggestions";
import { buildProfile } from "@/profile/build";
import { inputFor } from "@/profile/sample";
import { HEADLINE_MAX, HEADLINE_MAX_WORDS, cardHeadline } from "./contract";
import { runDetectors, type Suggestion } from "./index";
import { TAX_FACT_DETECTORS } from "./tax-facts";

// Fact versions of advice-only cards (suggest-taxes phase 2): what a real account sees where the
// advice card is left out. Never for a demo person, never a move.

const facts = (id: "equity" | "retiree" | "renter", advice?: boolean) => {
  const data = inputFor(id);
  return runDetectors({ profile: buildProfile(data), data, advice }, TAX_FACT_DETECTORS);
};
const advice = (id: "equity" | "retiree") => {
  const data = inputFor(id);
  return runDetectors({ profile: buildProfile(data), data }).map((s) => s.topic);
};
// The chat's guardrail blocks any sentence naming a stock or investing, fact or not, so a holdings
// fact is held to what real-account cards go through (tellsThemToAct, src/lib/suggestions.ts
// forRealAccount) and to recommending nothing; the others pass the chat's guardrail too.
const plain = (s: Suggestion) => {
  for (const t of [s.title, s.headline, s.short, s.why]) {
    if (!s.topic.includes("stock"))
      expect(
        checkGuardrails(
          t,
          dollarFigures(t).map((f) => f.cents),
        ),
        t,
      ).toEqual({ ok: true });
    expect(tellsThemToAct(t), t).toBe(false);
    expect(recommendsAChoice(t), t).toBe(false);
  }
  expect(ADVICE_TOPICS).not.toContain(s.topic);
  const card = cardHeadline(s.headline);
  expect(s.headline.length).toBeLessThanOrEqual(HEADLINE_MAX);
  expect(card.split(/\s+/).length, card).toBeLessThanOrEqual(HEADLINE_MAX_WORDS);
};

describe("fact versions for real accounts", () => {
  it("tells Priya her company stock's share and what flat withholding on vests leaves, as facts", () => {
    const fired = facts("equity", false);
    const share = fired.find((s) => s.topic === "company_stock_share")!;
    const vest = fired.find((s) => s.topic === "stock_vest_tax")!;
    expect(share.why).toMatch(/% of the \$[\d,.]+ in your investment accounts/);
    // The same figure the advice card has.
    const data = inputFor("equity");
    const gap = runDetectors({ profile: buildProfile(data), data }).find(
      (s) => s.topic === "withholding_gap",
    )!;
    expect(vest.worthCents).toBe(gap.worthCents);
    expect(vest.why).toContain("flat 22% (IRS Pub. 15");
    plain(share);
    plain(vest);
  });

  it("tells Ruth the part of her Social Security that's income, and the W-4V's rates", () => {
    const s = facts("retiree", false).find((x) => x.topic === "social_security_taxed")!;
    expect(s.why).toContain("7%, 10%, 12% or 22%");
    expect(s.why).toContain("up to 85%");
    plain(s);
  });

  it("is never for a demo person, who has the advice card instead", () => {
    expect(facts("equity")).toEqual([]);
    expect(facts("equity", true)).toEqual([]);
    expect(facts("retiree")).toEqual([]);
    expect(advice("equity")).toEqual(expect.arrayContaining(["concentration", "withholding_gap"]));
    expect(advice("retiree")).toContain("social_security_tax");
  });

  it("says nothing to someone with no stock plan or Social Security", () => {
    expect(facts("renter", false)).toEqual([]);
  });
});
