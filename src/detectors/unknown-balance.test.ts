import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));

import { buildProfile, type ProfileInput } from "@/profile/build";
import { inputFor } from "@/profile/sample";
import { runDetectors } from "./index";

// Overnight upload QA (2026-10-27): a person who uploaded statements with no balance in them
// was told "Balance running low" and "Build an emergency cushion, protect $3,884", from a
// stand-in $0. An unknown balance is not an empty account.

const run = (data: ProfileInput) => runDetectors({ profile: buildProfile(data), data });
const topics = (data: ProfileInput) => run(data).map((s) => s.topic);

// The renter's cash, then the same person with every balance unknown at $0, as an upload
// without a balance column loads.
const unknown = (d: ProfileInput): ProfileInput => ({
  ...d,
  accounts: d.accounts.map((a) => ({ ...a, balanceCents: 0, balanceKnown: false })),
});
const empty = (d: ProfileInput): ProfileInput => ({
  ...d,
  accounts: d.accounts.map((a) => (a.type === "depository" ? { ...a, balanceCents: 0 } : a)),
});

describe("cash suggestions with no balance known", () => {
  const renter = inputFor("renter");

  it("warn when a known balance is truly empty", () => {
    expect(topics(empty(renter))).toContain("low_balance");
    expect(topics(empty(renter))).toContain("emergency_fund");
  });

  it("stay quiet when no checking or savings balance is known", () => {
    expect(topics(unknown(renter))).not.toContain("low_balance");
    expect(topics(unknown(renter))).not.toContain("emergency_fund");
  });
});

// Night QA 10-30: a student whose checking was overdrawn read "You keep -$278.80 in cash" and
// "You hold -$278.80 against about $2,502.11 a month in bills".
describe("cash suggestions for an overdrawn account", () => {
  const overdrawn = (d: ProfileInput): ProfileInput => {
    let first = true;
    return {
      ...d,
      accounts: d.accounts.map((a) => {
        if (a.type !== "depository") return a;
        const balanceCents = first ? -27_880 : 0;
        first = false;
        return { ...a, balanceCents };
      }),
    };
  };

  it("say overdrawn, never a negative amount of cash", () => {
    const cash = run(overdrawn(inputFor("renter"))).filter((s) =>
      ["low_balance", "emergency_fund"].includes(s.topic),
    );
    expect(cash.map((s) => s.topic).sort()).toEqual(["emergency_fund", "low_balance"]);
    for (const s of cash) {
      expect(`${s.short} ${s.why}`).toContain("$278.80 overdrawn");
      expect(`${s.short} ${s.why}`).not.toMatch(/-\$/);
    }
  });
});
