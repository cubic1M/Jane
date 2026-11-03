import { describe, expect, it } from "vitest";
import {
  COMEBACK_MAX,
  NUDGE_AFTER_DAYS,
  NUDGE_EVERY_DAYS,
  NUDGE_MAX,
} from "@/config/follow-through";
import {
  comebackDue,
  comebackWords,
  comesBack,
  nextStepOf,
  nudgeDue,
  nudgeWords,
  type FollowRow,
} from "./follow-through";

const day = (n: number) => new Date(Date.UTC(2026, 8, 1 + n, 15));
const row = (over: Partial<FollowRow> = {}): FollowRow => ({
  answer: "yes",
  status: "open",
  answeredAt: day(0),
  doneAt: null,
  nudgeCount: 0,
  lastNudgedAt: null,
  failedAt: null,
  comebacks: 0,
  comebackAt: null,
  ...over,
});

describe("nudgeDue", () => {
  it("waits, then nudges a Yes with nothing done", () => {
    expect(nudgeDue(row(), day(NUDGE_AFTER_DAYS - 1))).toBe(false);
    expect(nudgeDue(row(), day(NUDGE_AFTER_DAYS))).toBe(true);
    expect(nudgeDue(row({ status: "unverifiable" }), day(NUDGE_AFTER_DAYS))).toBe(true);
  });

  it("spaces the nudges and stops at the cap", () => {
    const after = row({ nudgeCount: 1, lastNudgedAt: day(NUDGE_AFTER_DAYS) });
    expect(nudgeDue(after, day(NUDGE_AFTER_DAYS + NUDGE_EVERY_DAYS - 1))).toBe(false);
    expect(nudgeDue(after, day(NUDGE_AFTER_DAYS + NUDGE_EVERY_DAYS))).toBe(true);
    expect(nudgeDue(row({ nudgeCount: NUDGE_MAX }), day(300))).toBe(false);
  });

  it("stops when they act, say no, or the data settles it", () => {
    const late = day(60);
    expect(nudgeDue(row({ doneAt: day(1) }), late)).toBe(false);
    expect(nudgeDue(row({ answer: "no", status: "declined" }), late)).toBe(false);
    for (const status of ["confirmed", "partial", "not_seen", "lapsed", "no_longer_found"]) {
      expect(nudgeDue(row({ status }), late)).toBe(false);
    }
  });
});

describe("a fix that failed", () => {
  const failed = row({ status: "not_seen", failedAt: day(70) });

  it("is due once per failure, under the cap", () => {
    expect(comebackDue(failed)).toBe(true);
    expect(comebackDue({ ...failed, comebacks: 1, comebackAt: day(71) })).toBe(false);
    // Tried again and failed again: due again.
    expect(comebackDue({ ...failed, comebacks: 1, comebackAt: day(71), failedAt: day(150) })).toBe(
      true,
    );
    expect(comebackDue({ ...failed, comebacks: COMEBACK_MAX, failedAt: day(300) })).toBe(false);
  });

  it("never brings back a clean no, an open Yes or a verified fix", () => {
    expect(comebackDue(row({ answer: "no", status: "declined", failedAt: day(70) }))).toBe(false);
    expect(comebackDue(row({ status: "open", failedAt: day(70) }))).toBe(false);
    expect(comebackDue(row({ status: "confirmed", failedAt: day(70) }))).toBe(false);
  });

  it("may come back as a suggestion only once it was told, for this failure", () => {
    expect(comesBack(failed)).toBe(false);
    expect(comesBack({ ...failed, comebacks: 1, comebackAt: day(71) })).toBe(true);
    // Failed again at the cap: not told, so it stays where it is.
    expect(comesBack({ ...failed, comebacks: 2, comebackAt: day(71), failedAt: day(150) })).toBe(
      false,
    );
    expect(comesBack({ ...failed, answer: "no", comebackAt: day(71) })).toBe(false);
  });

  it("says what the data showed and the next step", () => {
    const words = comebackWords({
      actedOn: "2026-09-03",
      doneAt: day(2),
      status: "not_seen",
      proof: "Still charged: $15.99 on Oct 30.",
      heldProof: null,
      watch: { kind: "charge_stops", payees: [] },
    });
    expect(words).toMatch(/^You did it on Sep 3, and it didn't hold\./);
    expect(words).toContain("Still charged: $15.99 on Oct 30.");
    expect(words).toContain("Next: Check your account with them");
  });

  it("reads what came back from the Held proof", () => {
    const words = comebackWords({
      actedOn: "2026-09-01",
      doneAt: null,
      status: "lapsed",
      proof: "Stopped.",
      heldProof: "Charged again: $9.99 on Dec 1.",
      watch: { kind: "charge_stops", payees: [] },
    });
    expect(words).toContain("You said yes on Sep 1");
    expect(words).toContain("Charged again: $9.99 on Dec 1.");
    expect(words).not.toContain("Stopped.");
  });

  it("has a next step for every kind of watch, and none without one", () => {
    expect(nextStepOf(null)).toBeNull();
    for (const watch of [
      { kind: "charge_stops", payees: [] },
      { kind: "bill_drops", payees: [] },
      { kind: "refund", payees: [] },
      { kind: "fee_stops", pfcs: [], monthlyCents: 0 },
      { kind: "funds_left", funds: [] },
      { kind: "cash_invested", beforeCents: 0, excessCents: 0, yearlyCents: 0 },
    ] as const) {
      expect(nextStepOf(watch as never)).toBeTruthy();
    }
  });
});

it("the nudge says what they said yes to, and when", () => {
  expect(nudgeWords("Cancel Hulu.", "2026-09-01")).toMatch(
    /^You said yes to "Cancel Hulu" on Sep 1\./,
  );
});
