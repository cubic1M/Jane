import { describe, expect, it } from "vitest";
import { CHAT_BUNDLE_MAX } from "@/config/agent-chat";
import { bundleGroups, bundleOf } from "./bundle";
import { shortName } from "./sources/findings";

// Spec step 92: which suggestions go together, and how a bundle reads.

const item = (n: number, group = "bill_negotiation", source = "findings") => ({
  kind: "decision",
  dedupeKey: `${source}:${n}`,
  priority: 60 + n,
  source,
  bundle: {
    group,
    name: `Bill ${n}`,
    line: `Bill ${n}: could save about $1.00 a year`,
    cents: 100,
  },
});

describe("bundleGroups", () => {
  it("groups by kind, two or more, at most the most a message holds", () => {
    const many = Array.from({ length: CHAT_BUNDLE_MAX + 2 }, (_, n) => item(n));
    expect(bundleGroups([...many, item(99, "bank_fees")]).map((g) => g.length)).toEqual([
      CHAT_BUNDLE_MAX,
    ]);
    expect(bundleGroups([item(1), item(2, "bank_fees")])).toEqual([]);
    expect(bundleGroups([{ ...item(1), bundle: undefined }, item(2)])).toEqual([]);
  });
});

describe("bundleOf", () => {
  it("reads as one message, a Yes each, at the most urgent one's priority", () => {
    const bundle = bundleOf([item(1), item(2)]);
    expect(bundle.body.split("\n")[0]).toBe(
      "I found 2 bills I could lower, about $2.00 a year in all.",
    );
    expect(bundle.actions.map((a) => a.id)).toEqual(["bundle.1", "bundle.2", "open"]);
    expect(bundle.priority).toBe(62);
    expect(bundleOf([item(1), item(2)]).dedupeKey).toBe(bundle.dedupeKey);
    expect(bundleOf([item(2), item(3)]).dedupeKey).not.toBe(bundle.dedupeKey);
  });
});

describe("shortName", () => {
  it("names a finding the way the button says it", () => {
    expect(shortName("Review your Netflix subscription")).toBe("Netflix");
    expect(shortName("Your Verizon Wireless phone bill is above the typical price")).toBe(
      "Verizon Wireless",
    );
    expect(shortName("Charged twice? $64.20 at Target")).toBe("Target");
    expect(shortName("$246.00 in fees on Demo Checking in the last 12 months")).toBe(
      "Demo Checking",
    );
    expect(shortName("Something rather long that has no pattern at all")).toMatch(/…$/);
    // Debugger 11-02: titles told apart by price, and an insurer whose name says insurance.
    expect(shortName("Your USAA insurance at $138.22 could cost less")).toBe("USAA");
    expect(shortName("Your Next Insurance policy could cost less")).toBe("Next Insurance");
    expect(shortName("Review your Spotify subscription at $16.99")).toBe("Spotify");
    expect(shortName("Review your Netflix subscription on Chase Sapphire")).toBe("Netflix");
  });
});
