import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));

import { PEOPLE } from "@/config/people";
import { buildProfile, type ProfileInput } from "@/profile/build";
import { inputFor } from "@/profile/sample";
import { runDetectors } from "./index";
import { FIT_DETECTORS } from "./fit";

// Spec step 283: cards that could be one cheaper loan, from the fit engine.

const fire = (id: string, change: (d: ProfileInput) => ProfileInput = (d) => d) => {
  const data = change(inputFor(id));
  return runDetectors({ profile: buildProfile(data), data }, FIT_DETECTORS);
};

describe("consolidating cards", () => {
  it("is offered to Maya, whose card carries a balance at about 29% and who has no spare cash to clear it, with the maths and an honest confidence", () => {
    const [s] = fire("renter");
    expect(s).toMatchObject({
      topic: "consolidation",
      worthKind: "saves",
      urgency: "later",
      action: { href: "/loans/refinance" },
    });
    expect(s.worthCents).toBeGreaterThan(100_000);
    expect(s.why).toMatch(
      /^You owe \$1,940\.20 on a card at \d+\.\d%\. .+ at \d+\.\d\d% over \d(?:\.\d)? years would cost about \$[\d,.]+ less in all, fees counted, at \$[\d,.]+ a month\.$/,
    );
    expect(s.headline).toMatch(/^Move your cards to one cheaper loan, save \$[\d,]+$/);
    // The rate is worked out from interest charges, not given by the bank, and the offers are typical.
    expect(s.confidence.percent).toBeLessThanOrEqual(65);
  });

  it("counts only what it saves beyond a 0% transfer, so the dollars aren't counted twice", () => {
    const [s] = fire("renter");
    expect(s.rankCents).toBeDefined();
    expect(s.rankCents!).toBeLessThan(s.worthCents);
    expect(s.rankCents!).toBeGreaterThanOrEqual(0);
  });

  it("is for the people with it on their list, and never for someone in debt trouble", () => {
    // Maya, the Reyes and Jo owe on cards at 21% to 27% and keep their cash as an emergency
    // cushion (loans QA: one cash rule), so one cheaper loan is the idea.
    for (const p of PEOPLE) {
      expect(fire(p.id).length > 0, p.name).toBe(
        (p.should as readonly string[]).includes("consolidation"),
      );
    }
    const data = inputFor("renter");
    const trouble = { ...data, told: { ...data.told, debt_trouble: true } };
    expect(runDetectors({ profile: buildProfile(trouble), data: trouble }, FIT_DETECTORS)).toEqual(
      [],
    );
  });

  it("needs a balance worth moving and a rate worth beating", () => {
    expect(
      fire("renter", (d) => ({
        ...d,
        accounts: d.accounts.map((a) =>
          a.type === "credit" ? { ...a, balanceCents: 100_000 } : a,
        ),
      })),
    ).toEqual([]);
    // A card rate a personal loan doesn't beat by enough.
    expect(
      fire("renter", (d) => ({
        ...d,
        liabilities: d.liabilities.map((l) => (l.kind === "credit" ? { ...l, aprBps: 1_200 } : l)),
      })),
    ).toEqual([]);
  });

  it("stays quiet when cash they don't need would clear the card for less (that is the better pick)", () => {
    expect(
      fire("renter", (d) => ({
        ...d,
        accounts: d.accounts.map((a) =>
          a.type === "depository" ? { ...a, balanceCents: a.balanceCents + 5_000_000 } : a,
        ),
      })),
    ).toEqual([]);
  });
});
