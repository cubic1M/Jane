import { describe, expect, it } from "vitest";
import { wrongAccountNote } from "./wrong-account";

describe("wrongAccountNote", () => {
  it("says so when another bank's file is going into an account", () => {
    expect(
      wrongAccountNote({ name: "Chase card" }, [{ file: "wf.csv", bank: "Wells Fargo" }]),
    ).toBe(
      "wf.csv looks like a Wells Fargo file, but it's going into Chase card. If that's wrong, pick its account above.",
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
