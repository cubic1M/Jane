import { describe, expect, it } from "vitest";
import type { Snapshot } from "../snapshot";
import { safeLine } from "./brief";

// Coming back to Jane weeks after one upload (debug 3, 11-16): a statement ending Oct 14 gave
// "Good morning! You have $5,468.72 safe to spend this month." on Nov 16, every morning, while the
// chat says the same figures "may be out of date". The brief and the day's agenda say it too now.
const line = (dataEnded: string | null) =>
  safeLine(
    { safeToSpend: { safeCents: 546_872, payday: null }, dataEnded } as Snapshot,
    "2026-11-16",
  );

describe("the brief's safe to spend after old statements", () => {
  it("says first that the data ends weeks ago", () => {
    expect(line("2026-10-14")).toBe(
      "What I have ends on Oct 14, so this may be out of date. You have $5,468.72 safe to spend this month.",
    );
  });

  it("is as before while the data is current", () => {
    expect(line(null)).toBe("You have $5,468.72 safe to spend this month.");
  });

  it("says nothing of dates when there's no safe to spend to say", () => {
    expect(safeLine({ safeToSpend: null, dataEnded: "2026-10-14" } as Snapshot, "2026-11-16")).toBe(
      null,
    );
  });
});
