import { describe, expect, it } from "vitest";
import { rankPriorities, urgencyOf, type PriorityItem } from "./priorities";

// Spec step 143: one ranked list, by money per minute of the person's time, urgency and
// confidence, with the reason for each place. AS_OF is Oct 19, 2026.

const AS_OF = "2026-10-19";
const item = (over: Partial<PriorityItem>): PriorityItem => ({
  key: over.key ?? over.title ?? "k",
  kind: "finding",
  title: "Something",
  valueCents: null,
  minutes: 1,
  confidence: "high",
  href: "/plan",
  ...over,
});

describe("rankPriorities", () => {
  it("puts the most money per minute first, and says why", () => {
    const [first, second] = rankPriorities(
      [
        item({ title: "Lower your phone bill", valueCents: 60_000, minutes: 2 }),
        item({ title: "Refund the double charge", valueCents: 6_420 }),
        item({ title: "Move cash to savings", valueCents: 80_000, minutes: 10 }),
      ],
      AS_OF,
    );
    expect(first.title).toBe("Lower your phone bill");
    expect(first.why).toBe("First because it saves $600.00 a year and takes about 2 minutes.");
    expect(second.title).toBe("Move cash to savings");
    expect(second.why).toBe(
      "Because it saves the most ($800.00 a year) and takes about 10 minutes.",
    );
  });

  it("says 'saves the most and takes one tap' when that's why", () => {
    const [first] = rankPriorities(
      [
        item({ title: "Cancel Hulu", valueCents: 21_588 }),
        item({ title: "Fee", valueCents: 3_400 }),
      ],
      AS_OF,
    );
    expect(first.why).toBe("First because it saves the most ($215.88 a year) and takes one tap.");
  });

  it("lets a deadline in the next few days beat a bigger saving", () => {
    const ranked = rankPriorities(
      [
        item({ title: "Refinance the car", valueCents: 50_000, minutes: 15, confidence: "medium" }),
        item({ title: "Use your FSA money", kind: "deadline", minutes: 5, dueOn: "2026-10-21" }),
      ],
      AS_OF,
    );
    expect(ranked.map((r) => r.title)).toEqual(["Use your FSA money", "Refinance the car"]);
    expect(ranked[0].why).toBe("First because it's due in 2 days and takes about 5 minutes.");
  });

  it("breaks ties by the bigger saving, then the earlier date, then the title", () => {
    const tie = rankPriorities(
      [
        item({ key: "b", title: "B", dueOn: "2026-12-01" }),
        item({ key: "a", title: "A", dueOn: "2026-12-01" }),
        item({ key: "c", title: "C", dueOn: "2026-11-30" }),
      ],
      AS_OF,
    );
    expect(tie.map((r) => r.key)).toEqual(["c", "a", "b"]);
    const sameScore = rankPriorities(
      [
        item({ key: "x", title: "X", valueCents: 0 }),
        item({ key: "y", title: "Y", valueCents: 0 }),
      ],
      AS_OF,
    );
    expect(sameScore.map((r) => r.key)).toEqual(["x", "y"]);
  });

  it("weighs how sure Jane is", () => {
    const ranked = rankPriorities(
      [
        item({ title: "Maybe", valueCents: 10_000, confidence: "low" }),
        item({ title: "Sure", valueCents: 10_000, confidence: "high" }),
      ],
      AS_OF,
    );
    expect(ranked[0].title).toBe("Sure");
  });
});

describe("urgencyOf", () => {
  it("is full within a few days or overdue, and fades to the horizon", () => {
    expect(urgencyOf({ dueOn: "2026-10-18" }, AS_OF)).toBe(1);
    expect(urgencyOf({ dueOn: "2026-10-22" }, AS_OF)).toBe(1);
    const mid = urgencyOf({ dueOn: "2026-11-02" }, AS_OF);
    expect(mid).toBeGreaterThan(0);
    expect(mid).toBeLessThan(1);
    expect(urgencyOf({ dueOn: "2027-01-01" }, AS_OF)).toBe(0);
    expect(urgencyOf({ urgency: 0.6 }, AS_OF)).toBe(0.6);
  });
});
