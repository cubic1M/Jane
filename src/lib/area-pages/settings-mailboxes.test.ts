import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { anchorFocus, itemId, settingsTree, type SettingsTreeInput } from "./settings";
import { LABEL_MAX_WORDS, SUMMARY_MAX_SENTENCES, sentences, words } from "./tree";

// Gmail mailboxes in Settings (src/app/settings/mailboxes/): one item under Banks and files, after
// "Add a bank or a file", while Gmail is offered or the person still has a mailbox. With the switch
// off, someone who connected one before still finds the page, and Disconnect on it.

const input: SettingsTreeInput = {
  banks: [{ id: "i1", name: "Chase", updated: "Nov 18, 2026", accounts: 2, needsSignIn: false }],
  imports: [],
  autopilot: null,
  sectorsOn: 0,
  sectors: 5,
  rulesOn: 0,
  channel: "Email",
  alertsOn: 3,
  alerts: 8,
  digest: true,
  remembered: 0,
  state: null,
  owned: 0,
  documents: 0,
  twoFactor: false,
  calendar: false,
};

const banksItems = (tree: ReturnType<typeof settingsTree>) =>
  tree.tree.branches.find((b) => b.id === "banks")?.items ?? [];
const MAILBOXES = itemId("banks", "mailboxes");

describe("the mailboxes item in Settings", () => {
  it("isn't there without a count", () => {
    expect(banksItems(settingsTree(input)).map((i) => i.id)).toEqual([
      "banks:item-i1",
      "banks:add",
    ]);
    expect(banksItems(settingsTree({ ...input, banks: [] })).map((i) => i.id)).toEqual([
      "banks:add",
    ]);
  });

  it("comes after adding a bank, so #banks still opens the first bank or Add", () => {
    for (const banks of [input.banks, []]) {
      const tree = settingsTree({ ...input, banks, mailboxes: 2 });
      const ids = banksItems(tree).map((i) => i.id);
      expect(ids.at(-1)).toBe(MAILBOXES);
      expect(ids.at(-2)).toBe("banks:add");
      expect(anchorFocus("banks", tree)).toBe(ids[0]);
      expect(anchorFocus("banks", tree)).not.toBe(MAILBOXES);
    }
  });

  it("says how many are connected, or offers connecting one", () => {
    const item = (mailboxes: number) => {
      const tree = settingsTree({ ...input, mailboxes });
      return {
        ...banksItems(tree).find((i) => i.id === MAILBOXES),
        summary: tree.summaries[MAILBOXES],
      };
    };
    expect(item(0)).toMatchObject({
      label: "Gmail mailboxes",
      figure: "None",
      summary:
        "Connect a Gmail mailbox, read-only, and Jane lists the money emails it reads there.",
    });
    expect(item(1).figure).toBe("1 mailbox");
    expect(item(2)).toMatchObject({
      figure: "2 mailboxes",
      summary: "The Gmail mailboxes you connected, and the money emails Jane read in them.",
    });
    // Nothing on it asks for the person: what each mailbox needs is said on its page.
    expect(item(2).status).toBeUndefined();
    expect(settingsTree({ ...input, mailboxes: 2 }).chips).toEqual([]);
  });

  it("keeps to the copy budget", () => {
    for (const mailboxes of [0, 1, 5]) {
      const tree = settingsTree({ ...input, mailboxes });
      const item = banksItems(tree).find((i) => i.id === MAILBOXES);
      expect(words(item?.label ?? "")).toBeLessThanOrEqual(LABEL_MAX_WORDS);
      expect(sentences(tree.summaries[MAILBOXES])).toBeLessThanOrEqual(SUMMARY_MAX_SENTENCES);
    }
  });

  // The page always reads the count, and hands it on while Gmail is offered or the person has one.
  it("is shown by Settings while Gmail is offered or a mailbox is connected, with a link to it", () => {
    const page = readFileSync("src/app/settings/page.tsx", "utf8");
    expect(page).toMatch(/mine\.gmailMailboxes\.count\(\),\n\s*\]\);/);
    expect(page).toMatch(
      /mailboxes: gmailOffered\(\) \|\| mailboxCount > 0 \? mailboxCount : undefined,/,
    );
    expect(page).toMatch(
      /details\[itemId\("banks", "mailboxes"\)\] = \(\s*<Link href="\/settings\/mailboxes"/,
    );
  });
});
