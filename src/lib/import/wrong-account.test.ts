import { describe, expect, it } from "vitest";
import { wrongAccountNote } from "./wrong-account";

describe("wrongAccountNote", () => {
  it("says so when another bank's file is going into an account", () => {
    expect(wrongAccountNote("Chase card", [{ file: "wf.csv", bank: "Wells Fargo" }])).toBe(
      "wf.csv looks like a Wells Fargo file, but it's going into Chase card. If that's wrong, pick its account above.",
    );
  });

  it("is quiet when the account is named for the file's bank, by its name or a short one", () => {
    expect(wrongAccountNote("Chase card", [{ file: "a.csv", bank: "Chase" }])).toBeNull();
    expect(
      wrongAccountNote("My BofA checking", [{ file: "b.csv", bank: "Bank of America" }]),
    ).toBeNull();
    expect(wrongAccountNote("Amex Gold", [{ file: "c.csv", bank: "American Express" }])).toBeNull();
    expect(wrongAccountNote("WF checking", [{ file: "d.csv", bank: "Wells Fargo" }])).toBeNull();
  });

  it("is quiet when no file says its bank (a mapped layout, OFX)", () => {
    expect(wrongAccountNote("Chase card", [{ file: "x.csv" }])).toBeNull();
  });

  it("names the first file that doesn't fit", () => {
    expect(
      wrongAccountNote("Citi card", [
        { file: "c.csv", bank: "Citi" },
        { file: "d.csv", bank: "Discover" },
      ]),
    ).toContain("d.csv looks like a Discover file");
  });

  it("doesn't take a short name inside another word", () => {
    expect(wrongAccountNote("Swft card", [{ file: "w.csv", bank: "Wells Fargo" }])).not.toBeNull();
  });
});
