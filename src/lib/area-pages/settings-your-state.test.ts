import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));

import { FACT_SPECS } from "@/profile/facts";
import { settingsTree, type SettingsTreeInput } from "./settings";

// Debugger 11-13, Settings at 1280 with the demo bank: Home and household listed "Where you live:
// Not set" (the state) while What Jane knows said "Where you live: you own your home" (own or
// rent). One label, two facts: the state is called what its control calls it.

const input: SettingsTreeInput = {
  banks: [
    { id: "i1", name: "Demo Bank", updated: "Nov 13, 2026", accounts: 8, needsSignIn: false },
  ],
  imports: [],
  autopilot: null,
  sectorsOn: 0,
  sectors: 6,
  rulesOn: 0,
  channel: "Phone",
  alertsOn: 12,
  alerts: 12,
  digest: true,
  remembered: 0,
  state: null,
  owned: 2,
  documents: 0,
  twoFactor: false,
  calendar: false,
};

describe("the state on Settings", () => {
  it("is called the state, not the label What Jane knows uses for own or rent", () => {
    const item = settingsTree(input)
      .tree.branches.flatMap((b) => b.items)
      .find((i) => i.id === "household:state");
    expect(item?.label).toBe("Your state");
    const housing = FACT_SPECS.find((f) => f.key === "housing")!.label;
    expect(item?.label).not.toBe(housing);
  });
});
