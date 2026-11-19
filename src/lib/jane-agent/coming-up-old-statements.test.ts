import { describe, expect, it } from "vitest";
import { comingUpReply } from "./replies";

// Debug 3, 11-19 (class 5, debug3-invariants.md): someone whose statements ended in September
// asked in November what's coming up and heard "Nothing is coming up that I can see.": nothing is
// known about now, which isn't the same as nothing due.

const all = { kind: "coming_up", days: null } as const;

describe("what's coming up, from statements that ended long ago", () => {
  it("says when the statements end instead of saying nothing is due", () => {
    const answer = comingUpReply(all, [], { statementsEnd: "2026-09-11" });
    expect(answer.body).toBe(
      "Your statements end Sep 11, 2026, so I can't say what's coming up now. Upload newer statements and I'll check.",
    );
    expect(answer.actions).toEqual([
      expect.objectContaining({ label: "Upload newer statements", href: "/import" }),
    ]);
  });

  it("still says nothing is due for statements that reach today", () => {
    expect(comingUpReply(all, []).body).toBe("Nothing is coming up that I can see.");
  });
});
