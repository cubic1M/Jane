import { describe, expect, it } from "vitest";
import {
  SETTINGS_ANCHORS,
  SETTINGS_BRANCHES,
  anchorFocus,
  settingsTree,
  type SettingsTreeInput,
} from "./settings";
import { CHIPS_MAX, LABEL_MAX_WORDS, SUMMARY_MAX_SENTENCES, sentences, words } from "./tree";

// Settings as a tree (docs/design/area-pages.md): one item per setting with what it's set to,
// few words, the old #anchors still landing on their setting, and a chip only when something
// needs the person.

const ALL_GOOD: SettingsTreeInput = {
  banks: [{ id: "i1", name: "Chase", updated: "Oct 23, 2026", accounts: 3, needsSignIn: false }],
  imports: [],
  autopilot: "Handle the safe stuff",
  sectorsOn: 2,
  sectors: 5,
  rulesOn: 1,
  channel: "Email",
  alertsOn: 7,
  alerts: 8,
  digest: true,
  remembered: 4,
  state: "CA",
  owned: 1,
  documents: 2,
  twoFactor: true,
  calendar: false,
};

const items = (input: SettingsTreeInput) =>
  settingsTree(input).tree.branches.flatMap((b) => b.items);

describe("settingsTree", () => {
  it("keeps every label and summary within the copy budget", () => {
    const area = settingsTree({
      ...ALL_GOOD,
      imports: [
        {
          id: "a1",
          name: "Everyday checking ····1234",
          lastImport: "Oct 1, 2026",
          ended:
            "Everyday checking's data ends on 2026-10-01, the last day in the file you imported, so I can't see anything after it. Import a newer file and I'll pick up from there.",
        },
      ],
    });
    for (const b of area.tree.branches) expect(words(b.label)).toBeLessThanOrEqual(LABEL_MAX_WORDS);
    for (const i of area.tree.branches.flatMap((b) => b.items)) {
      expect(words(i.label), i.label).toBeLessThanOrEqual(LABEL_MAX_WORDS);
      expect(sentences(area.summaries[i.id]), i.id).toBeLessThanOrEqual(SUMMARY_MAX_SENTENCES);
    }
  });

  it("shows every branch, in order, each setting with what it's set to", () => {
    const area = settingsTree(ALL_GOOD);
    expect(area.tree.branches.map((b) => b.id)).toEqual(Object.keys(SETTINGS_BRANCHES));
    const figure = (id: string) => items(ALL_GOOD).find((i) => i.id === id)?.figure;
    expect(figure("banks:item-i1")).toBe("3 accounts");
    expect(figure("autopilot:level")).toBe("Handle the safe stuff");
    expect(figure("autopilot:sectors")).toBe("2 of 5");
    expect(figure("notify:messages")).toBe("Email");
    expect(figure("notify:alerts")).toBe("7 of 8");
    expect(figure("notify:email")).toBe("On");
    expect(figure("household:state")).toBe("CA");
    expect(figure("security:two-factor")).toBe("On");
    expect(figure("security:calendar")).toBe("Off");
    expect(area.tree.sub).toBe("All good");
    expect(area.chips).toEqual([]);
  });

  it("puts a bank that needs a sign-in up front, and asks for the autopilot level", () => {
    const input = {
      ...ALL_GOOD,
      autopilot: null,
      banks: [{ ...ALL_GOOD.banks[0], needsSignIn: true }],
      imports: [{ id: "a1", name: "Savings", lastImport: "Oct 1, 2026", ended: "Its data ends." }],
    };
    const area = settingsTree(input);
    const status = (id: string) => items(input).find((i) => i.id === id)?.status;
    expect(status("banks:item-i1")).toBe("act");
    expect(status("banks:csv-a1")).toBe("look");
    expect(status("autopilot:level")).toBe("look");
    expect(area.chips.map((c) => c.id)).toEqual(["banks:item-i1"]);
    expect(area.chips.length).toBeLessThanOrEqual(CHIPS_MAX);
    expect(area.tree.sub).toBe("1 urgent · 2 to look at");
    expect(area.summaries["banks:item-i1"]).toContain("sign in again");
  });

  it("lands every old #anchor on a real item or branch", () => {
    const area = settingsTree(ALL_GOOD);
    const ids = new Set(area.tree.branches.flatMap((b) => [b.id, ...b.items.map((i) => i.id)]));
    for (const anchor of Object.keys(SETTINGS_ANCHORS)) {
      expect(ids.has(anchorFocus(anchor, area)!), anchor).toBe(true);
    }
    // #banks opens the first bank, so its Refresh and Disconnect are on screen.
    expect(anchorFocus("banks", area)).toBe("banks:item-i1");
    expect(anchorFocus("alerts", area)).toBe("notify:alerts");
    expect(anchorFocus("nothing-here", area)).toBeUndefined();
  });

  it("offers adding a bank when none is linked", () => {
    const none = { ...ALL_GOOD, banks: [] };
    expect(settingsTree(none).tree.branches[0].items.map((i) => i.id)).toEqual(["banks:add"]);
    expect(anchorFocus("banks", settingsTree(none))).toBe("banks:add");
    expect(settingsTree(none).summaries["banks:add"]).toBe(
      "No banks linked. Link one, or import a statement file.",
    );
    expect(settingsTree(ALL_GOOD).summaries["banks:add"]).toBe(
      "Link another bank, or import a statement file.",
    );
  });
});
