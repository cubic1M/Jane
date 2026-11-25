import { describe, expect, it } from "vitest";
import { buildProfile, type ProfileInput } from "@/profile/build";
import { DETECTORS, runDetectors } from "./index";
import { cashClearsCard } from "./student-money";
import { grad } from "./__fixtures__/students";

// CodeRabbit sweep 1c, det-02 finding 6: when cash clears only PART of the card, the card-interest
// card was hidden altogether, so the interest cash cannot stop was never brought up.
const fire = (data: ProfileInput, topic: string) =>
  runDetectors({ profile: buildProfile(data), data }, DETECTORS).find((s) => s.topic === topic) ??
  null;
const cashFor = (data: ProfileInput, clear: number): ProfileInput => {
  const { keepCents } = cashClearsCard(data)!;
  const depository = data.accounts.filter((a) => a.type === "depository");
  return {
    ...data,
    accounts: data.accounts.map((a) =>
      a.type !== "depository"
        ? a
        : { ...a, balanceCents: a.id === depository[0].id ? keepCents + clear : 0 },
    ),
  };
};

describe("card interest when cash clears only part of the card", () => {
  it("keeps the interest the cash cannot stop, and counts nothing twice", () => {
    const base = grad();
    const owed = cashClearsCard(base)!.owedCents;
    const data = cashFor(base, Math.round(owed / 4));
    const c = cashClearsCard(data)!;
    expect(c.clearCents).toBeLessThan(c.owedCents);
    const rest = fire(data, "card_interest");
    const part = fire(data, "card_from_cash");
    expect(part).not.toBeNull();
    expect(rest).not.toBeNull();
    // By hand: a quarter cleared, so three quarters of the card's year of interest is left.
    expect(rest!.worthCents).toBeGreaterThan(0);
    const whole = c.wholeCents;
    expect(part!.worthCents + rest!.worthCents).toBeLessThanOrEqual(whole + 2);
    expect(rest!.worthCents).toBeLessThan(whole);
  });

  it("still steps aside when the cash clears the whole card", () => {
    expect(fire(grad(), "card_interest")).toBeNull();
  });
});
