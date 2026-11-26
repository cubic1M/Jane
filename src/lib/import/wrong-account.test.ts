import { describe, expect, it } from "vitest";
import {
  existingAccountNote,
  linkedAccountNote,
  mixedFilesNote,
  wrongAccountNote,
} from "./wrong-account";

describe("wrongAccountNote", () => {
  it("says so when another bank's file is going into an account", () => {
    expect(
      wrongAccountNote({ name: "Chase card" }, [{ file: "wf.csv", bank: "Wells Fargo" }]),
    ).toBe(
      "wf.csv looks like a Wells Fargo file, but it's going into Chase card. If that's wrong, pick its account above.",
    );
  });

  it("says a card's file from another bank is a card's, going into a bank account", () => {
    expect(
      wrongAccountNote({ name: "Wells Fargo checking", kind: "checking" }, [
        { file: "citi.csv", bank: "Citi", kind: "credit_card" },
      ]),
    ).toBe(
      "citi.csv looks like a Citi card file, but it's going into Wells Fargo checking. If that's wrong, pick its account above.",
    );
  });

  it("is quiet when the account is named for the file's bank, by its name or a short one", () => {
    expect(wrongAccountNote({ name: "Chase card" }, [{ file: "a.csv", bank: "Chase" }])).toBeNull();
    expect(
      wrongAccountNote({ name: "My BofA checking" }, [{ file: "b.csv", bank: "Bank of America" }]),
    ).toBeNull();
    expect(
      wrongAccountNote({ name: "Amex Gold" }, [{ file: "c.csv", bank: "American Express" }]),
    ).toBeNull();
    expect(
      wrongAccountNote({ name: "WF checking" }, [{ file: "d.csv", bank: "Wells Fargo" }]),
    ).toBeNull();
  });

  it("is quiet when no file says its bank (a mapped layout, OFX)", () => {
    expect(wrongAccountNote({ name: "Chase card" }, [{ file: "x.csv" }])).toBeNull();
  });

  it("names the first file that doesn't fit", () => {
    expect(
      wrongAccountNote({ name: "Citi card" }, [
        { file: "c.csv", bank: "Citi" },
        { file: "d.csv", bank: "Discover" },
      ]),
    ).toContain("d.csv looks like a Discover file");
  });

  it("says so when a card statement is going into a bank account, or the other way", () => {
    const checking = { name: "Chase checking", kind: "checking" };
    expect(
      wrongAccountNote(checking, [{ file: "card.csv", bank: "Chase", kind: "credit_card" }]),
    ).toBe(
      "card.csv looks like a card statement, but it's going into Chase checking. If that's wrong, pick its account above.",
    );
    expect(
      wrongAccountNote({ name: "Chase card", kind: "credit_card" }, [
        { file: "c.ofx", kind: "savings" },
      ]),
    ).toContain("looks like a bank account statement");
    // Checking and savings are both bank accounts; a kind not known says nothing.
    expect(wrongAccountNote(checking, [{ file: "s.ofx", kind: "savings" }])).toBeNull();
    expect(
      wrongAccountNote({ name: "Chase checking" }, [{ file: "c.csv", kind: "credit_card" }]),
    ).toBeNull();
  });

  it("doesn't take a short name inside another word", () => {
    expect(
      wrongAccountNote({ name: "Swft card" }, [{ file: "w.csv", bank: "Wells Fargo" }]),
    ).not.toBeNull();
  });
});

describe("mixedFilesNote", () => {
  it("says two accounts' files in one upload should go one at a time", () => {
    expect(
      mixedFilesNote([
        { file: "capital-one-360.csv", bank: "Capital One", kind: "checking" },
        { file: "amex.csv", bank: "American Express", kind: "credit_card" },
      ]),
    ).toBe(
      "capital-one-360.csv and amex.csv look like two different accounts. Upload them one at a time, so each gets its own.",
    );
    // Same bank, a card and a checking account.
    expect(
      mixedFilesNote([
        { file: "a.csv", bank: "Chase", kind: "checking" },
        { file: "b.csv", bank: "Chase", kind: "credit_card" },
      ]),
    ).not.toBeNull();
  });

  it("is quiet for months of one account, or when the files don't say", () => {
    expect(
      mixedFilesNote([
        { file: "jul.csv", bank: "Chase", kind: "checking" },
        { file: "aug.csv", bank: "Chase", kind: "savings" },
      ]),
    ).toBeNull();
    expect(mixedFilesNote([{ file: "x.csv" }, { file: "y.csv", bank: "Citi" }])).toBeNull();
    expect(mixedFilesNote([{ file: "one.csv", bank: "Citi" }])).toBeNull();
  });
});

describe("existingAccountNote", () => {
  const accounts = [
    { name: "Citi card", kind: "credit_card" },
    { name: "Chase checking", kind: "checking" },
  ];

  it("points at the account Jane already has for a new account's file", () => {
    expect(
      existingAccountNote(accounts, [{ file: "citi (1).csv", bank: "Citi", kind: "credit_card" }]),
    ).toBe(
      "You already have Citi card. If citi (1).csv is from it, pick it above, so its rows join the ones there.",
    );
  });

  it("is quiet for a different kind at the same bank, another bank, or no bank", () => {
    expect(
      existingAccountNote(accounts, [{ file: "c.csv", bank: "Chase", kind: "credit_card" }]),
    ).toBeNull();
    expect(
      existingAccountNote(accounts, [{ file: "d.csv", bank: "Discover", kind: "credit_card" }]),
    ).toBeNull();
    expect(existingAccountNote(accounts, [{ file: "e.csv" }])).toBeNull();
  });
});

describe("linkedAccountNote", () => {
  const linked = [
    { name: "Total Checking", institution: "Chase", mask: "4321", kind: "checking" },
    { name: "Freedom", institution: "Chase", mask: "9876", kind: "credit_card" },
    { name: "Card", institution: "Citibank Online", mask: null, kind: "credit_card" },
  ];

  it("is sure when the bank and the last four agree", () => {
    expect(
      linkedAccountNote(linked, [
        { file: "Chase4321_Activity.CSV", bank: "Chase", kind: "checking", mask: "4321" },
      ]),
    ).toEqual({
      sure: true,
      text: "You already link Total Checking ····4321 through Chase, so its transactions come in by themselves. There's no need to import Chase4321_Activity.CSV.",
    });
  });

  it("warns without the last four when the bank and kind agree", () => {
    expect(
      linkedAccountNote(linked, [
        { file: "citi.csv", bank: "Citi", kind: "credit_card", mask: null },
      ]),
    ).toEqual({
      sure: false,
      text: `Jane can't yet tell whether citi.csv is your linked Card. Until it can, citi.csv is left out of net worth; "This is a different account" on this page counts it.`,
    });
  });

  it("says nothing for another last four, another bank, another kind, or no bank", () => {
    expect(
      linkedAccountNote(linked, [{ file: "c.csv", bank: "Chase", kind: "checking", mask: "1111" }]),
    ).toBeNull();
    expect(
      linkedAccountNote(linked, [
        { file: "w.csv", bank: "Wells Fargo", kind: "checking", mask: null },
      ]),
    ).toBeNull();
    expect(
      linkedAccountNote(
        [linked[2]],
        [{ file: "c.csv", bank: "Citi", kind: "checking", mask: null }],
      ),
    ).toBeNull();
    expect(linkedAccountNote(linked, [{ file: "x.csv", mask: "4321" }])).toBeNull();
  });

  // Walk 23: only a Chase checking account linked, a savings statement uploaded: "If
  // f-savings-short.csv is your linked Plaid checking ····3235, skip it" would have left $5,120.00
  // out of net worth.
  describe("follows what net worth decides about the file", () => {
    const checking = [
      { id: "l1", name: "Plaid Checking", institution: "Chase", mask: "3235", kind: "checking" },
    ];
    const file = { file: "f-savings-short.csv", bank: "Chase", mask: null };

    it("says nothing about a savings file beside a linked checking account", () => {
      expect(linkedAccountNote(checking, [{ ...file, kind: "savings" }])).toBeNull();
    });

    it("says nothing when comparing the lines says it is a different account", () => {
      expect(
        linkedAccountNote(checking, [{ ...file, kind: "checking", verdicts: { l1: "different" } }]),
      ).toBeNull();
    });

    it("says it is left out by itself when the lines say it is the same account", () => {
      const note = linkedAccountNote(checking, [
        { ...file, kind: "checking", verdicts: { l1: "same" } },
      ]);
      expect(note).toEqual({
        sure: false,
        text: "f-savings-short.csv matches your linked Plaid Checking ····3235, whose transactions already come in from Chase, so Jane leaves it out of net worth by itself.",
      });
    });

    it("says it is left out until Jane can tell, and never tells the person to skip it", () => {
      for (const verdicts of [{ l1: "unknown" as const }, undefined]) {
        const note = linkedAccountNote(checking, [{ ...file, kind: "checking", verdicts }]);
        expect(note?.text).toContain("is left out of net worth");
        expect(note?.text).toContain("This is a different account");
        expect(note?.text).not.toMatch(/skip it/);
      }
    });
  });
});
