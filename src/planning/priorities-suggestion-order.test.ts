import { describe, expect, it } from "vitest";
import { rankPriorities, type PriorityItem } from "./priorities";

const item = (over: Partial<PriorityItem>): PriorityItem => ({
  key: "k",
  kind: "finding",
  title: "Something",
  valueCents: null,
  minutes: 1,
  confidence: "high",
  href: "/plan",
  ...over,
});

describe("rankPriorities: the scan's suggestions lead in the scan's own order", () => {
  it("keeps suggestions first, in the order given, whatever they score", () => {
    const ranked = rankPriorities(
      [
        item({ key: "f1", title: "Big finding", valueCents: 900_000 }),
        item({ key: "s1", kind: "suggestion", title: "Low one", valueCents: 100 }),
        item({ key: "s2", kind: "suggestion", title: "High one", valueCents: 800_000 }),
        item({ key: "f2", title: "Small finding", valueCents: 5_000 }),
      ],
      "2026-10-19",
    );
    expect(ranked.map((r) => r.key)).toEqual(["s1", "s2", "f1", "f2"]);
  });
});
