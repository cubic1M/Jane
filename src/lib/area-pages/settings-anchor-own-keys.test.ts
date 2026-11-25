import { describe, expect, it } from "vitest";
import { anchorFocus, settingsTree, type SettingsTreeInput } from "./settings";

// CodeRabbit sweep 1c, area-02 (#11): a name that is on every object ("constructor") is not an
// anchor, and no longer throws.

const input: SettingsTreeInput = {
  banks: [],
  imports: [],
  autopilot: null,
  sectorsOn: 0,
  sectors: 5,
  rulesOn: 0,
  channel: "Off",
  alertsOn: 0,
  alerts: 8,
  digest: false,
  remembered: 0,
  state: null,
  owned: 0,
  documents: 0,
  twoFactor: false,
  calendar: false,
};

describe("anchorFocus with an inherited name", () => {
  it.each(["constructor", "toString", "__proto__", "hasOwnProperty"])(
    "gives no focus for %s",
    (name) => {
      expect(anchorFocus(name, settingsTree(input))).toBeUndefined();
    },
  );
});
