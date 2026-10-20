import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));

import { DETECTOR_EXEMPT, TOOL_EXEMPT } from "@/config/detector-exempt";
import { PEOPLE } from "@/config/people";
import { CAPABILITIES } from "@/lib/jane-agent/capabilities";
import { CHAT_TOOLS } from "@/lib/jane-agent/claude-tools";
import { buildProfile } from "@/profile/build";
import { inputFor } from "@/profile/sample";
import { weakest } from "./helpers";
import { MISSING_DETECTOR } from "./missing";
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

  // A capability is a whole sector (taxes holds dozens of tools), so the unit is the feature:
  // every registry tool is covered by a detector, exempt with a reason, or on the list that
  // only shrinks.
  it("covers every registry tool, or lists it as missing, or says why it is exempt", () => {
    const tools = CHAT_TOOLS.map((t) => t.name);
    const covered = new Set(DETECTORS.flatMap((d) => d.covers));
    const uncovered = tools.filter(
      (t) => !covered.has(t) && !TOOL_EXEMPT[t] && !MISSING_DETECTOR.includes(t),
    );
    expect(
      uncovered,
      `tools with no detector, exemption or place on missing.ts: ${uncovered.join(", ")}. A new tool arrives with its detector.`,
    ).toEqual([]);
  });

  it("only ever shrinks the list of tools still missing a detector", () => {
    const tools = new Set(CHAT_TOOLS.map((t) => t.name));
    const covered = new Set(DETECTORS.flatMap((d) => d.covers));
    for (const t of MISSING_DETECTOR) {
      expect(tools.has(t), `${t} is on the missing list but is not a tool`).toBe(true);
      expect(covered.has(t), `${t} is covered now: remove it from src/detectors/missing.ts`).toBe(
        false,
      );
      expect(TOOL_EXEMPT[t], `${t} is both missing and exempt`).toBeUndefined();
    }
    for (const d of DETECTORS) {
      for (const t of d.covers)
        expect(tools.has(t), `${d.capability}:${d.topic} covers unknown tool ${t}`).toBe(true);
    }
    for (const t of Object.keys(TOOL_EXEMPT)) {
      expect(tools.has(t), `${t} is exempt but is not a tool`).toBe(true);
      expect(covered.has(t), `${t} is covered; drop its exemption`).toBe(false);
    }
  });

  it("keeps the exempt capability list and the detectors honest", () => {
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
      covers: [],
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
