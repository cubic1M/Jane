import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));

import { PEOPLE } from "@/config/people";
import { addDays } from "@/lib/dates";
import { buildProfile, type ProfileInput } from "@/profile/build";
import { inputFor } from "@/profile/sample";
import { DETECTORS, runDetectors } from "./index";

// Debugger 11-18 (r351, Upload S7: Capital One 360 statements ending Sep 28, uploaded Nov 18, on a
// phone): the report said it was too long ago to say what's paid now, and the dock said "You pay
// Xfinity about $55.00 a month for internet" and "You keep $1,950.16 in cash". Cards about what's
// paid or held now wait for newer statements, by the report's own rule (STALE_UPLOAD_DAYS).

const NOW_TOPICS = ["emergency_fund", "low_cost_internet"];
const topics = (data: ProfileInput) =>
  runDetectors({ profile: buildProfile(data), data }, DETECTORS).map((s) => s.topic);
const newest = (data: ProfileInput) =>
  data.transactions.reduce((m, t) => (t.date > m ? t.date : m), "0000-00-00");

describe("cards about now, from statements that ended long ago", () => {
  it("fire from statements that reach today, and not from the same ones 60 days on", () => {
    const fired = PEOPLE.map((p) => inputFor(p.id)).filter((d) =>
      topics(d).some((t) => NOW_TOPICS.includes(t)),
    );
    expect(fired.length).toBeGreaterThan(0);
    for (const data of fired) {
      const later = { ...data, today: addDays(newest(data), 60) };
      expect(topics(later).filter((t) => NOW_TOPICS.includes(t))).toEqual([]);
    }
  });
});
