import { describe, expect, it } from "vitest";
import { savedLine } from "./saved-line";

describe("what an upload says it did", () => {
  it("says nothing was new, as before, when nothing changed", () => {
    expect(savedLine({ rows: 0, read: 1, corrected: 0 })).toBe(
      "Nothing new: Jane already had this transaction.",
    );
    expect(savedLine({ rows: 0, read: 5, corrected: 0 })).toBe(
      "Nothing new: Jane already had all 5 of these transactions.",
    );
  });

  it("says what was saved, as before", () => {
    expect(savedLine({ rows: 5, read: 5, corrected: 0 })).toMatch(
      /^Saved 5 transactions\. Jane finishes/,
    );
    expect(savedLine({ rows: 2, read: 5, corrected: 0 })).toMatch(
      /^Saved 2 new transactions; 3 were already here\./,
    );
  });

  // Debugger 11-02: a re-upload that put rows right would have said "Nothing new".
  it("says when it put rows right", () => {
    expect(savedLine({ rows: 0, read: 7, corrected: 7 })).toMatch(
      /^Put right 7 transactions Jane already had; nothing new\. Jane finishes/,
    );
    expect(savedLine({ rows: 0, read: 7, corrected: 1 })).toMatch(
      /^Put right 1 transaction Jane already had;/,
    );
    expect(savedLine({ rows: 2, read: 7, corrected: 5 })).toMatch(
      /^Saved 2 new transactions and put right 5 Jane already had\./,
    );
  });
});
