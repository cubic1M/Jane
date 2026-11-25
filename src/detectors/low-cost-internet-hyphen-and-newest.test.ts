import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));

import { buildProfile, type ProfileInput } from "@/profile/build";
import { inputFor } from "@/profile/sample";
import { runDetectors } from "./index";
import { UTILITY_DETECTORS } from "./utilities";

// CodeRabbit sweep 1c (PR #2268): "XFINITY TRIPLE-PLAY" is a bundle too, and an internet bill from
// a provider with no plan here, newer than a configured one, means the person has left that one.
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
const three = (payee: string, cents = 10_000) =>
  ["2026-08-05", "2026-09-05", "2026-10-05"].map((date) => ({ date, cents, payee }));

describe("hyphenated bundle names", () => {
  it.each(["XFINITY TRIPLE-PLAY", "XFINITY DOUBLE-PLAY", "XFINITY TRIPLE PLAY"])(
    "%s is a bundle: the plan, no savings figure",
    (payee) => {
      const s = run(three(payee));
      expect(s).not.toBeNull();
      expect(s?.worthCents).toBe(0);
      expect(s?.why).toContain("no dollar figure");
    },
  );

  it("a plain internet bill still gets its figure", () => {
    expect(run(three("XFINITY INTERNET", 7_000))?.worthCents).toBe((7_000 - 1_495) * 12);
  });
});

describe("a newer bill from a provider with no plan here", () => {
  it("leaves the card out instead of naming the provider the person left", () => {
    const s = run([
      { date: "2026-09-05", cents: 7_000, payee: "COMCAST XFINITY" },
      { date: "2026-10-05", cents: 7_000, payee: "AT&T INTERNET" },
    ]);
    expect(s).toBeNull();
  });

  it("still names the configured provider when it is the newest", () => {
    const s = run([
      { date: "2026-09-05", cents: 7_000, payee: "AT&T INTERNET" },
      { date: "2026-10-05", cents: 7_000, payee: "COMCAST XFINITY" },
    ]);
    expect(s?.title).toContain("Xfinity");
  });
});
