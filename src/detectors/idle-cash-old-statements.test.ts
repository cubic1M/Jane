import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));

import { PEOPLE } from "@/config/people";
import { addDays } from "@/lib/dates";
import { buildProfile, type ProfileInput } from "@/profile/build";
import { inputFor } from "@/profile/sample";
import { DETECTORS, runDetectors } from "./index";

// Debug 3's invariants (11-19, the "now from old statements" class over every sweep person): a
// statement that ended Sep 11, read on Nov 12, still gave "You keep $8,450.00 in cash; about
// $2,046.29 is more than you need." The cushion card already waits for newer statements (#2095);
// idle cash says the same thing about now, so it waits too.

const topics = (data: ProfileInput) =>
  runDetectors({ profile: buildProfile(data), data }, DETECTORS).map((s) => s.topic);
const newest = (data: ProfileInput) =>
  data.transactions.reduce((m, t) => (t.date > m ? t.date : m), "0000-00-00");

describe("idle cash, from statements that ended long ago", () => {
  it("is offered from statements that reach today, and not from the same ones 60 days on", () => {
    const fired = PEOPLE.map((p) => inputFor(p.id)).filter((d) => topics(d).includes("idle_cash"));
    expect(fired.length).toBeGreaterThan(0);
    for (const data of fired) {
      expect(topics({ ...data, today: addDays(newest(data), 60) })).not.toContain("idle_cash");
    }
  });
});
