import { describe, expect, it } from "vitest";
import { ADVICE_TOPICS } from "@/config/suggestions";
import { PEOPLE } from "@/config/people";
import { checkGuardrails } from "@/lib/guardrails";
import { formatWholeDollars } from "@/lib/money";
import { tellsThemToAct } from "@/lib/real-account-text";
import { forRealAccount } from "@/lib/suggestions";
import { buildProfile, type ProfileInput } from "@/profile/build";
import { inputFor } from "@/profile/sample";
import { shortFormProblems } from "./harness";
import { TAX_SET_ASIDE_DETECTORS } from "./tax-set-aside";
import type { Suggestion } from "./contract";

// The tax left to cover, brought up unasked: a fact for a real account, a labelled move in demo advice.

type Figure = NonNullable<NonNullable<ProfileInput["extras"]>["taxSetAside"]>;

const figure = (over: Partial<Figure> = {}): Figure => ({
  year: 2026,
  status: "needed",
  advice: false,
  holdCents: 410_000,
  taxSoFarCents: 980_000,
  paidSoFarCents: 570_000,
  keptApartCents: 0,
  withholdingKnown: true,
  unknowns: [],
  confidence: { percent: 72, reason: "11 months of income in your accounts" },
  ...over,
});

function run(taxSetAside: Figure | undefined): Suggestion[] {
  const base = inputFor(PEOPLE[0]!.id);
  const data = {
    ...base,
    extras: { ...base.extras, householdMembers: 1, taxSetAside },
  } as ProfileInput;
  const profile = buildProfile(data);
  return TAX_SET_ASIDE_DETECTORS.flatMap((d) => d.detect({ profile, data }) ?? []);
}

describe("the unasked tax card", () => {
  it("comes up when tax is left to cover, with its confidence", () => {
    const [card, ...rest] = run(figure());
    expect(rest).toEqual([]);
    expect(card?.topic).toBe("tax_not_yet_paid");
    expect(card?.confidence.percent).toBe(72);
    expect(card?.title).toContain(formatWholeDollars(410_000));
    expect(card?.title).toContain("estimate");
    expect(card?.action.href).toBe("/taxes?focus=estimate:set-aside");
  });

  it.each(["covered", "unknown", "no_income"] as const)("isn't shown when %s", (status) => {
    expect(run(figure({ status, holdCents: 0 }))).toEqual([]);
  });

  it("isn't shown when the figure wasn't loaded", () => {
    expect(run(undefined)).toEqual([]);
  });

  it("meets the card's short form rules", () => {
    for (const advice of [false, true])
      expect(shortFormProblems(run(figure({ advice }))[0]!)).toEqual([]);
  });

  it("says what it doesn't know out loud, and plainly when nothing is kept apart", () => {
    const [card] = run(figure({ unknowns: ["Only 2 months of income are in your accounts."] }));
    expect(card?.why).toContain("Only 2 months of income");
    expect(card?.why).toContain("can't see any money kept apart");
    expect(run(figure({ keptApartCents: 5_000 }))[0]?.why).not.toContain("kept apart");
  });

  it("names the assumption when withholding isn't known", () => {
    const [card] = run(figure({ withholdingKnown: false }));
    expect(card?.why).toContain("Jane assumes");
  });
});

describe("where the advice line sits", () => {
  const real = run(figure())[0]!;
  const demo = run(figure({ advice: true }))[0]!;

  it("a real account's card is a fact: no move, and no set aside", () => {
    expect(forRealAccount(real)).toBe(true);
    for (const t of [real.title, real.headline, real.short, real.why]) {
      expect(tellsThemToAct(t), t).toBe(false);
      expect(t, t).not.toMatch(/\bset(?:ting)? aside\b/i);
      expect(checkGuardrails(t, [410_000, 980_000, 570_000]), t).toEqual({ ok: true });
    }
  });

  it("the set-aside card is demo advice: a real account can't get it, whatever the figure says", () => {
    expect(demo.topic).toBe("tax_set_aside");
    expect(demo.title).toMatch(/^Set aside about/);
    expect(ADVICE_TOPICS).toContain("tax_set_aside");
    expect(ADVICE_TOPICS).not.toContain("tax_not_yet_paid");
    expect(forRealAccount(demo)).toBe(false);
  });
});
