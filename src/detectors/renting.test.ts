import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));

import { PEOPLE } from "@/config/people";
import { buildProfile, type ProfileInput } from "@/profile/build";
import { inputFor } from "@/profile/sample";
import { runDetectors } from "./index";
import { RENTING_DETECTORS } from "./renting";

// Spec step 248: rent reporting and a rent increase, on the sample people and on made-up rent.

const fire = (id: string, change: (d: ProfileInput) => ProfileInput = (d) => d) => {
  const data = change(inputFor(id));
  return runDetectors({ profile: buildProfile(data), data }, RENTING_DETECTORS);
};
const rent = (date: string, amountCents: number) => ({
  date,
  amountCents,
  description: "OAKWOOD APARTMENTS",
  pfc: "RENT_AND_UTILITIES_RENT",
  accountId: "x",
});
const withRents = (cents: number[]) => (d: ProfileInput) => ({
  ...d,
  transactions: [
    ...d.transactions.filter((t) => t.pfc !== "RENT_AND_UTILITIES_RENT"),
    ...cents.map((c, i) => rent(`2026-0${i + 4}-01`, c)),
  ],
});

describe("rent reporting", () => {
  it("is offered to Maya, who rents and owes on a card, with a reason and a confidence below certain", () => {
    const [s] = fire("renter");
    expect(s).toMatchObject({
      topic: "rent_reporting",
      worthKind: "saves",
      urgency: "later",
      action: { href: "/loans/renting" },
    });
    expect(s.worthCents).toBeGreaterThan(0);
    expect(s.why).toMatch(
      /^You pay \$1,450\.00 in rent every month and it isn't on your credit file\./,
    );
    expect(s.why).toContain("only starts when you say yes");
    expect(s.confidence.percent).toBeLessThanOrEqual(65);
    expect(s.confidence.reason).toBe("I can't tell whether your lenders count rent history");
  });

  it("is for renters on their own list only, and stops once they opt in", () => {
    for (const p of PEOPLE) {
      const found = fire(p.id).some((s) => s.topic === "rent_reporting");
      expect(found, p.name).toBe(p.should.includes("rent_reporting"));
    }
    expect(
      fire("renter", (d) => ({ ...d, rentReportingOn: true })).filter(
        (s) => s.topic === "rent_reporting",
      ),
    ).toEqual([]);
  });

  it("needs a few rent payments, and some debt for reporting to be worth anything", () => {
    const reporting = (list: { topic: string }[]) =>
      list.filter((s) => s.topic === "rent_reporting");
    expect(reporting(fire("renter", withRents([145_000, 145_000])))).toEqual([]);
    expect(
      reporting(
        fire("renter", (d) => ({
          ...d,
          accounts: d.accounts.map((a) => ({ ...a, balanceCents: Math.min(0, a.balanceCents) })),
        })),
      ),
    ).toEqual([]);
  });
});

describe("a rent increase", () => {
  it("reaches Maya, whose lease renewed at $1,450 from $1,320 (detector coverage)", () => {
    const s = fire("renter").find((x) => x.topic === "rent_increase")!;
    expect(s.why).toContain("went from $1,320.00 to $1,450.00 a month");
    expect(s.worthCents).toBe(156_000);
  });

  it("is raised when rent rose well past the usual, in dollars a year", () => {
    const s = fire("renter", withRents([145_000, 145_000, 145_000, 160_000])).find(
      (x) => x.topic === "rent_increase",
    )!;
    expect(s).toMatchObject({ worthKind: "risk", urgency: "soon", worthCents: 180_000 });
    expect(s.why).toContain("went from $1,450.00 to $1,600.00 a month");
    expect(s.why).toContain("10.3% against a usual 4%");
    expect(s.confidence.reason).toMatch(/stand-in/);
  });

  it("stays quiet for a usual rise, flat rent and owners", () => {
    expect(
      fire("renter", withRents([145_000, 145_000, 145_000, 150_000])).some(
        (x) => x.topic === "rent_increase",
      ),
    ).toBe(false);
    expect(
      fire("renter", withRents([145_000, 145_000, 145_000, 145_000])).some(
        (x) => x.topic === "rent_increase",
      ),
    ).toBe(false);
    expect(
      fire("owner", withRents([100_000, 100_000, 100_000, 130_000])).some(
        (x) => x.topic === "rent_increase",
      ),
    ).toBe(true);
    expect(fire("family").some((x) => x.topic === "rent_increase")).toBe(false);
  });
});
