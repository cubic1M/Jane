import { describe, expect, it } from "vitest";
import { DIY_KITS } from "@/config/diy";
import { RESHOP_BANNED_PHRASES } from "@/config/insurance";
import { buildCard, type CardFinding } from "@/lib/cards";
import { checkGuardrails, reshopBannedPhrases } from "@/lib/guardrails";
import { savingsLine } from "@/lib/savings-text";

// Connectors roadmap round 14 (4.3): a reshop for a real account never says it saves, never
// calls another insurer cheaper or its cover better, and never tells the person to cancel or
// switch, so nothing Jane says can lead someone to drop a policy. Demo advice shows partner
// quotes with their source and may say what one saves.

const reshop: CardFinding = {
  id: "finding_reshop",
  type: "insurance_reshop",
  title: "Compare your car insurance",
  annualSavingsCents: null,
  evidence: { merchant: "GEICO", yearlyCostCents: 182_400, months: 12 },
  explanation: null,
  explanationHash: null,
};

describe("a reshop's words for a real account", () => {
  it("finds each banned phrase as whole words, in any case, with a curly apostrophe", () => {
    expect(reshopBannedPhrases("You’ll save on this")).toEqual(["you'll save"]);
    expect(reshopBannedPhrases("A CHEAPER plan. Switch now!")).toEqual(["cheaper", "switch now"]);
    expect(reshopBannedPhrases("Same coverage for less")).toEqual(["same coverage for less"]);
    // Not inside other words.
    expect(reshopBannedPhrases("Applying takes a minute; the appliance is covered")).toEqual([]);
    for (const phrase of RESHOP_BANNED_PHRASES) {
      expect(reshopBannedPhrases(`Here: ${phrase}.`)).toEqual([phrase]);
    }
  });

  it("aren't on the card, its steps or its savings line", () => {
    const card = buildCard(reshop);
    const diy = DIY_KITS.insurance_reshop!;
    const words = [
      card.title,
      card.explanation,
      card.whatChanges,
      card.giveUp,
      ...card.alternatives,
      ...card.evidence.map((row) => row.label),
      diy.summary,
      ...diy.steps,
      savingsLine("insurance_reshop", null),
    ];
    for (const text of words) expect(reshopBannedPhrases(text), text).toEqual([]);
    // So Jane never prompts a lapse.
    expect(diy.summary).toContain("keep your current policy until a new one starts");
  });

  it("stop Claude's explanation of a reshop in the standard profile only", () => {
    const said = "Switch now: GEICO's rivals are cheaper.";
    expect(checkGuardrails(said, [], "insurance_reshop")).toEqual({
      ok: false,
      issues: ["insurance_comparison"],
    });
    expect(
      checkGuardrails("Compare quotes for the same coverage.", [], "insurance_reshop"),
    ).toEqual({
      ok: true,
    });
    // Other findings may call a phone plan cheaper; demo advice shows the quote it means.
    expect(checkGuardrails("A cheaper plan exists.", [], "price_increase")).toEqual({ ok: true });
    expect(checkGuardrails(said, [], "insurance_reshop", "demo_advice")).toEqual({ ok: true });
  });
});
