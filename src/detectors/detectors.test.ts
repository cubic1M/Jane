import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));

import { DETECTOR_EXEMPT } from "@/config/detector-exempt";
import { PEOPLE } from "@/config/people";
import { CAPABILITIES } from "@/lib/jane-agent/capabilities";
import { buildProfile } from "@/profile/build";
import { inputFor } from "@/profile/sample";
import { weakest } from "./helpers";
import { formatReport, reportFor, runHarness } from "./harness";
import { DETECTORS, detectorsFor, runDetectors } from "./index";

// Spec step 254: every capability has a detector (or a written reason it doesn't), every
// detector is tried on the eight people against their written lists, and every suggestion
// carries a percentage worked out from the evidence.

describe("the detector contract", () => {
  it("has a detector for every registry capability, or a reason it has none", () => {
    const missing = CAPABILITIES.filter(
      (c) => detectorsFor(c.id).length === 0 && !DETECTOR_EXEMPT[c.id],
    ).map((c) => c.id);
    expect(missing, `capabilities with no detector: ${missing.join(", ")}`).toEqual([]);
  });

  it("keeps the exempt list and the detectors honest", () => {
    const ids = new Set(CAPABILITIES.map((c) => c.id));
    for (const id of Object.keys(DETECTOR_EXEMPT)) {
      expect(ids.has(id), `${id} is exempt but not a capability`).toBe(true);
      expect(detectorsFor(id), `${id} has a detector now: remove it from the exempt list`).toEqual(
        [],
      );
    }
    for (const d of DETECTORS) expect(ids.has(d.capability), d.capability).toBe(true);
    const keys = DETECTORS.map((d) => `${d.capability}:${d.topic}`);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe("the harness on the eight people", () => {
  const reports = runHarness();

  it("never makes a suggestion a person's written list forbids", () => {
    for (const r of reports) {
      expect(
        r.wrong.map((s) => s.topic),
        `${r.person.id} was wrongly told`,
      ).toEqual([]);
    }
  });

  it("makes every suggestion a person should have, wherever a detector exists", () => {
    for (const r of reports) {
      expect(
        r.missed.filter((m) => m.covered).map((m) => m.topic),
        `${r.person.id} missed a suggestion\n${formatReport([r])}`,
      ).toEqual([]);
    }
  });

  it("reports per person what fired and what should have", () => {
    expect(reports).toHaveLength(PEOPLE.length);
    const text = formatReport(reports);
    for (const p of PEOPLE) expect(text).toContain(p.id);
    expect(text).toMatch(/fired:/);
    expect(text).toMatch(/missed:/);
    // Every one of them is told something.
    for (const r of reports) expect(r.fired.length, r.person.id).toBeGreaterThan(0);
  });

  it("gives every suggestion a percentage, its reason, a worth, a why and a button", () => {
    for (const r of reports) {
      for (const s of r.fired) {
        expect(Number.isInteger(s.confidence.percent), s.id).toBe(true);
        expect(s.confidence.percent).toBeGreaterThan(0);
        expect(s.confidence.percent).toBeLessThanOrEqual(100);
        expect(s.confidence.reason.length, s.id).toBeGreaterThan(3);
        expect(s.worthCents, s.id).toBeGreaterThan(0);
        expect(s.why, s.id).toMatch(/\$|\d/);
        expect(s.action.href, s.id).toMatch(/^\//);
        expect(s.id).toBe(`${s.capability}:${s.topic}`);
      }
    }
  });

  it("gives the same percentage for the same evidence, every time", () => {
    const first = reportFor(PEOPLE[0]).fired.map((s) => [s.id, s.confidence]);
    expect(reportFor(PEOPLE[0]).fired.map((s) => [s.id, s.confidence])).toEqual(first);
    const profile = buildProfile(inputFor("debt"));
    const data = inputFor("debt");
    expect(runDetectors({ profile, data })).toEqual(runDetectors({ profile, data }));
  });

  it("is never surer than the weakest thing it rests on", () => {
    expect(
      weakest([
        { percent: 90, reason: "a" },
        { percent: 61, reason: "b" },
        { percent: 80, reason: "c" },
      ]),
    ).toEqual({ percent: 61, reason: "b" });
    // A guess about children caps the life insurance suggestion below a sure fact.
    const family = reportFor(PEOPLE.find((p) => p.id === "family")!).fired.find(
      (s) => s.topic === "life_insurance",
    )!;
    const profile = buildProfile(inputFor("family"));
    expect(family.confidence.percent).toBeLessThanOrEqual(profile.facts.has_children.confidence);
  });

  it("skips a detector that throws and says so", () => {
    const broken = {
      capability: "cost",
      topic: "bank_fees",
      needs: [],
      detect: () => {
        throw new Error("boom");
      },
    } as const;
    const errors: string[] = [];
    const data = inputFor("renter");
    const out = runDetectors({ profile: buildProfile(data), data }, [broken, ...DETECTORS], (d) =>
      errors.push(d.topic),
    );
    expect(errors).toEqual(["bank_fees"]);
    expect(out.length).toBeGreaterThan(0);
  });
});
