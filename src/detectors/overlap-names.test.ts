import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));

import { buildProfile, type ProfileInput } from "@/profile/build";
import { inputFor } from "@/profile/sample";
import { runDetectors } from "./index";
import { SPENDING_DETECTORS } from "./spending";

// Debugger 11-15: Spending & bills listed "Spotify" under Subscriptions, and two lines up
// "Paying twice for one service: You pay for Spotify Usa, Audible, Peacock Premium…", the
// statement's words. The overlap names each service as the subscriptions list does.

const music = (description: string, amountCents: number) =>
  ["2026-07-09", "2026-08-09", "2026-09-09", "2026-10-09"].map((date) => ({
    date,
    amountCents,
    description,
    pfc: "ENTERTAINMENT_MUSIC_AND_AUDIO",
    accountId: "x",
  }));

describe("two music services at once", () => {
  it("are named as the subscriptions list names them", () => {
    const base = inputFor("preretire");
    const data: ProfileInput = {
      ...base,
      transactions: [
        ...base.transactions,
        ...music("SPOTIFY USA", 1_199),
        ...music("PANDORA MEDIA", 999),
      ],
    };
    const overlap = runDetectors({ profile: buildProfile(data), data }, SPENDING_DETECTORS).find(
      (s) => s.topic === "duplicate_subscription",
    );
    expect(overlap).toBeDefined();
    expect(overlap!.short).toContain("Spotify");
    expect(overlap!.short).not.toContain("Spotify Usa");
    expect(overlap!.why).not.toContain("Spotify Usa");
  });
});
