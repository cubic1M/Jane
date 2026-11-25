import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));

import { buildProfile, type ProfileInput } from "@/profile/build";
import { inputFor } from "@/profile/sample";
import { runDetectors } from "./index";
import { UTILITY_DETECTORS } from "./utilities";

// CodeRabbit sweep 1c (det-05, 4 and 16): the plan offered is the provider billed lately, priced
// from that provider's own recent bills, and an internet-and-TV bill gets the plan with no saving.
const INTERNET = "RENT_AND_UTILITIES_INTERNET_AND_CABLE";

const run = (bills: readonly { date: string; cents: number; payee: string }[]) => {
  const base = inputFor("renter");
  const account = base.accounts[0]!.id;
  const data: ProfileInput = {
    ...base,
    householdSize: 1,
    told: { ...base.told, monthly_income: 200_000 },
    transactions: [
      ...base.transactions.filter(
        (t) => t.pfc !== INTERNET && t.pfc !== "RENT_AND_UTILITIES_TELEPHONE",
      ),
      ...bills.map((b) => ({
        date: b.date,
        amountCents: b.cents,
        description: b.payee,
        pfc: INTERNET,
        accountId: account,
      })),
    ],
  };
  return (
    runDetectors({ profile: buildProfile(data), data }, UTILITY_DETECTORS).find(
      (s) => s.topic === "low_cost_internet",
    ) ?? null
  );
};

describe("the provider the low-cost internet card names", () => {
  it("is the one billed lately, not an old one that comes first in the list", () => {
    const s = run([
      { date: "2026-01-05", cents: 9_000, payee: "COMCAST XFINITY" },
      { date: "2026-08-05", cents: 6_500, payee: "SPECTRUM" },
      { date: "2026-09-05", cents: 6_500, payee: "SPECTRUM" },
      { date: "2026-10-05", cents: 6_500, payee: "SPECTRUM" },
    ]);
    expect(s?.title).toContain("Spectrum");
    expect(s?.worthCents).toBe((6_500 - 1_500) * 12);
  });

  it("prices the plan from the provider's latest months, not an older, dearer price", () => {
    const s = run([
      { date: "2026-03-05", cents: 12_000, payee: "COMCAST XFINITY" },
      { date: "2026-08-05", cents: 7_000, payee: "COMCAST XFINITY" },
      { date: "2026-09-05", cents: 7_000, payee: "COMCAST XFINITY" },
      { date: "2026-10-05", cents: 7_000, payee: "COMCAST XFINITY" },
    ]);
    expect(s?.worthCents).toBe((7_000 - 1_495) * 12);
  });
});

describe("an internet and TV bundle", () => {
  it("shows the plan with no savings figure, since the internet part isn't known", () => {
    const s = run(
      ["2026-08-05", "2026-09-05", "2026-10-05"].map((date) => ({
        date,
        cents: 10_000,
        payee: "XFINITY INTERNET AND TV BUNDLE",
      })),
    );
    expect(s).not.toBeNull();
    expect(s?.worthCents).toBe(0);
    expect(s?.title).toContain("Xfinity");
    expect(s?.why).toContain("no dollar figure");
    expect(s?.short).not.toMatch(/save/i);
  });
});
