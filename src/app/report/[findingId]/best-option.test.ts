import { describe, expect, it } from "vitest";
import type { Scored } from "@/planning/compare";
import { checkedLine } from "./best-option";

// Every market figure says when and where it was checked (24/7 engine, phase 4): an option the
// offers catalog read says the hour, one the team checked by hand says the day.

const option = (extra: Partial<Scored["option"]>) =>
  ({
    checkedAt: "2026-11-03",
    sourceUrl: "https://example.com/rates",
    ...extra,
  }) as Scored["option"];

describe("when an option's figure was checked", () => {
  it("gives the hour for one the catalog read", () => {
    expect(
      checkedLine(option({ checkedAt: "2026-11-12", checkedTime: "2026-11-12T18:05:00.000Z" })),
    ).toMatch(/^Checked .+, \d{1,2}:05\s?[AP]M from$/);
  });

  it("gives the day for one the team checked", () => {
    expect(checkedLine(option({}))).toMatch(/^Price checked .*2026 ·$/);
  });
});
