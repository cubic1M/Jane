import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));

import { DETECTOR_RATES as R } from "@/config/detectors";
import { runDetectors } from "@/detectors";
import { buildProfile } from "@/profile/build";
import { inputFor } from "@/profile/sample";
import { subscriptionTrimCents, subscriptionTrimSentence } from "./subscription-trim";

// A figure on a card must be findable on the page the card opens: /subscriptions says where the
// subscriptions card's figure comes from, with the number the detector computes.

describe("subscriptionTrimSentence", () => {
  it("names the card's figure and the share it is of the yearly total", () => {
    const text = subscriptionTrimSentence(71_376);
    expect(text).toContain("$178");
    expect(text).toContain("$713.76");
    expect(text).toContain(`${Math.round(R.subscriptionTrimShare * 100)}%`);
    expect(text).not.toMatch(/will save|you should cancel|cancel them/i);
  });

  it("gives the same figure as the detector's card, from the same yearly total", () => {
    const sample = inputFor("renter");
    const accountId = sample.accounts.find((a) => a.type === "depository")!.id;
    const rows = ["NETFLIX", "SPOTIFY", "HULU"].flatMap((description, k) =>
      ["2026-07-05", "2026-08-05", "2026-09-05"].map((date, i) => ({
        id: `t${k}${i}`,
        date,
        amountCents: 1_500,
        description,
        pfc: "ENTERTAINMENT_VIDEO_GAMES",
        accountId,
      })),
    );
    const data = { ...sample, extras: undefined, transactions: rows };
    const card = runDetectors({ profile: buildProfile(data), data }).find(
      (s) => s.topic === "subscriptions",
    );
    const yearly = 3 * 1_500 * 12;
    expect(card?.worthCents).toBe(subscriptionTrimCents(yearly));
    expect(subscriptionTrimSentence(yearly)).toContain(`$${card!.worthCents / 100}`);
  });
});
