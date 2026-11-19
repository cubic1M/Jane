import { describe, expect, it } from "vitest";
import { nowFromOldData } from "./invariants";

// The "now from old statements" rule (class 5, debug3-invariants.md) on what the walkers found,
// and on the same words once they say when.

const flat = (text: string) => ({ "trees.money.summaries.have:net-worth": text });

describe("talk of now, from statements that ended long ago", () => {
  it("is caught when it doesn't say when", () => {
    for (const text of [
      "You keep $8,450.00 in cash; about $2,046.29 is more than you need.",
      "$8,450.00 today. Nothing coming up takes it lower.",
      "You have $8,450.00 and owe $0.00.",
      "You pay $55.00 a month for internet.",
    ]) {
      expect(nowFromOldData(flat(text), "2026-09-11"), text).toHaveLength(1);
    }
  });

  it("is fine once it says when, or when the statements are recent", () => {
    expect(
      nowFromOldData(
        flat("You have $8,450.00 and owe $0.00. That's from your statements, which end on Sep 11."),
        "2026-09-11",
      ),
    ).toEqual([]);
    expect(
      nowFromOldData(flat("$10,597.07 on Oct 20, about $12,511.09 today."), "2026-09-11"),
    ).toEqual([]);
    expect(nowFromOldData(flat("You have $8,450.00 and owe $0.00."), null)).toEqual([]);
    // A cover's monthly benefit isn't cash held now.
    expect(nowFromOldData(flat("You need $4.9k/mo; you have $0/mo."), "2026-09-11")).toEqual([]);
  });
});
