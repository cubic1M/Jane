import { describe, expect, it } from "vitest";
import { DEMO_ADVICE_LABEL } from "@/config/advice";
import { SIMULATED_LABEL } from "@/config/paper";
import { signalCard } from "./wording";

// The trade pop-up's words under the advice rule (CLAUDE.md): Jane's recommendation in full only in
// advice mode; a real account sees only its own strategy's rule firing on its simulated account,
// and only what passes the standard guardrails; never a news idea.

const rule = {
  source: "rule",
  ticker: "VTI",
  side: "buy",
  amountCents: 120_000,
  reason: "HAA's rule at the close on 2026-09-30: VTI up to 40% of the account.",
  confidence: 55,
};

describe("the trade pop-up's words", () => {
  it("in advice mode: ticker, side, size, why, how sure, and the demo-advice label", () => {
    expect(signalCard(rule, { advice: true })).toEqual({
      headline: "Buy $1,200 of VTI",
      reason: rule.reason,
      confidence: 55,
      label: DEMO_ADVICE_LABEL,
    });
    expect(signalCard({ ...rule, side: "sell" }, { advice: true })?.headline).toBe(
      "Sell $1,200 of VTI",
    );
    expect(signalCard({ ...rule, source: "news" }, { advice: true })?.label).toBe(
      DEMO_ADVICE_LABEL,
    );
  });

  it("never shows a figure the trade doesn't carry", () => {
    expect(
      signalCard({ ...rule, reason: "It could make you $5,000 by spring." }, { advice: true }),
    ).toBeNull();
  });

  it("a real account: only its own strategy's rule, labelled simulated, through the standard check", () => {
    expect(signalCard({ ...rule, source: "news" }, { advice: false })).toBeNull();
    expect(signalCard(rule, { advice: false })).toEqual({
      headline: "Your strategy's rule: buy $1,200 of VTI",
      reason: `On your simulated account. ${rule.reason}`,
      confidence: null,
      label: SIMULATED_LABEL,
    });
    // Anything the standard guardrails stop isn't shown at all.
    expect(
      signalCard({ ...rule, reason: "You should buy more index funds." }, { advice: false }),
    ).toBeNull();
  });
});
