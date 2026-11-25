import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));

import { buildProfile } from "@/profile/build";
import { inputFor } from "@/profile/sample";
import { runDetectors } from "./index";

// CodeRabbit sweep 1c, det-02 finding 2: a payee that took several purchases in ONE month counted as a
// subscription, billed 12 times a year. A subscription is the same charge in different months.
const sample = inputFor("renter");
const accountId = sample.accounts.find((a) => a.type === "depository")!.id;
const withCharges = (rows: { date: string; description: string }[]) => {
  const data = {
    ...sample,
    extras: undefined,
    transactions: rows.map((r, i) => ({
      id: `s${i}`,
      date: r.date,
      amountCents: 1_500,
      description: r.description,
      pfc: "ENTERTAINMENT_VIDEO_GAMES",
      accountId,
    })),
  };
  return runDetectors({ profile: buildProfile(data), data }).find(
    (s) => s.topic === "subscriptions",
  );
};
const monthly = (description: string) =>
  ["2026-07-05", "2026-08-05", "2026-09-05"].map((date) => ({ date, description }));
const oneMonth = (description: string) =>
  ["2026-09-02", "2026-09-09", "2026-09-16", "2026-09-23"].map((date) => ({ date, description }));

describe("subscriptions found from the charges", () => {
  it("does not count a payee with many purchases in one month", () => {
    const rows = [
      ...monthly("NETFLIX"),
      ...monthly("SPOTIFY"),
      ...monthly("HULU"),
      ...oneMonth("ARCADE"),
      ...oneMonth("GAMESTOP"),
    ];
    const s = withCharges(rows);
    expect(s?.short).toMatch(/across 3 subscriptions/);
    const watched =
      s?.watch?.kind === "charge_stops" ? s.watch.payees.map((p) => p.description) : [];
    expect(watched.sort()).toEqual(["HULU", "NETFLIX", "SPOTIFY"]);
  });

  it("says nothing when only one-month payees pass the count", () => {
    expect(
      withCharges([...oneMonth("ARCADE"), ...oneMonth("GAMESTOP"), ...oneMonth("XBOX")]),
    ).toBeUndefined();
  });

  it("still counts three monthly payees", () => {
    const s = withCharges([...monthly("A"), ...monthly("B"), ...monthly("C")]);
    expect(s?.short).toMatch(/across 3 subscriptions/);
  });
});
