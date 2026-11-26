import { describe, expect, it } from "vitest";
import { parseRefs } from "./types";

// CodeRabbit part 2: a stored tightItem that is not an id and an optional date is dropped, so a
// card refresh never calls string methods on a number.

describe("parseRefs and tightItem", () => {
  it("keeps a good one, with or without the shortfall date", () => {
    expect(parseRefs({ tightItem: { id: "r1" } })).toEqual({ tightItem: { id: "r1" } });
    expect(parseRefs({ tightItem: { id: "r1", shortfallOn: "2026-11-20" } })).toEqual({
      tightItem: { id: "r1", shortfallOn: "2026-11-20" },
    });
  });

  it("drops a malformed one and keeps the rest", () => {
    expect(parseRefs({ note: "x", tightItem: { id: "r1", shortfallOn: 123 } })).toEqual({
      note: "x",
    });
    expect(parseRefs({ tightItem: { shortfallOn: "2026-11-20" } })).toEqual({});
    expect(parseRefs({ tightItem: "r1" })).toEqual({});
  });
});
