import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));

import { PEOPLE } from "@/config/people";
import { buildProfile, type ProfileInput } from "@/profile/build";
import { inputFor } from "@/profile/sample";
import { runDetectors } from "./index";
import { FAMILY_CREDIT_DETECTORS } from "./family-credit";

// Spec step 249: a child's credit file through a low-use card, and the exposure from a
// co-signed loan, on the sample people and on made-up co-signing.

const fire = (id: string, change: (d: ProfileInput) => ProfileInput = (d) => d) => {
  const data = change(inputFor(id));
  return runDetectors({ profile: buildProfile(data), data }, FAMILY_CREDIT_DETECTORS);
};

describe("starting a child's credit file", () => {
  it("is offered to the Reyes, with a guessed worth and a confidence that says what Jane can't see", () => {
    const [s] = fire("family");
    expect(s).toMatchObject({
      topic: "family_credit",
      worthKind: "earns",
      urgency: "later",
      action: { href: "/loans/helping" },
    });
    expect(s.worthCents).toBeGreaterThan(50_000);
    expect(s.confidence.percent).toBeLessThanOrEqual(55);
    expect(s.confidence.reason).toBe(
      "I can't tell how old your child is or whether a loan is coming",
    );
    expect(s.why).toMatch(/^One of your cards is only \d+% used and you have children\./);
    expect(s.why).toContain("a first $15,000 car loan over 5 years at 14%");
  });

  it("is for people with children on their own list only, and stops once they've done it", () => {
    for (const p of PEOPLE) {
      const found = fire(p.id).some((s) => s.topic === "family_credit");
      expect(found, p.name).toBe(p.should.includes("family_credit"));
    }
    expect(
      fire("family", (d) => ({
        ...d,
        familyCredit: { helped: 1, cosignedOwedCents: 0, cosignedMissed: 0 },
      })),
    ).toEqual([]);
  });

  it("needs a card used under 30%", () => {
    expect(
      fire("family", (d) => ({
        ...d,
        accounts: d.accounts.map((a) =>
          a.type === "credit" ? { ...a, balanceCents: (a.limitCents ?? 1) * 0.8 } : a,
        ),
      })),
    ).toEqual([]);
  });
});

describe("a co-signed loan", () => {
  const cosigned = (missed: number) => (d: ProfileInput) => ({
    ...d,
    familyCredit: { helped: 0, cosignedOwedCents: 1_200_000, cosignedMissed: missed },
  });

  it("is the person's exposure in full, as a risk, from what they told Jane", () => {
    const s = fire("preretire", cosigned(0)).find((x) => x.topic === "cosign_risk")!;
    expect(s).toMatchObject({ worthKind: "risk", worthCents: 1_200_000, urgency: "later" });
    expect(s.why).toBe(
      "You co-signed $12,000.00 for someone. If payments aren't made, you owe it and your credit takes the hit.",
    );
    expect(s.confidence.reason).toBe("you told me");
  });

  it("is urgent once a payment was missed", () => {
    const s = fire("preretire", cosigned(1)).find((x) => x.topic === "cosign_risk")!;
    expect(s.urgency).toBe("now");
    expect(s.title).toBe("A loan you co-signed has a missed payment");
    expect(s.why).toContain("It's on your credit report too");
  });

  it("stays quiet when nothing is co-signed", () => {
    expect(fire("preretire").some((x) => x.topic === "cosign_risk")).toBe(false);
  });
});
