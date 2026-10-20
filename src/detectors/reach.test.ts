import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));

import { DETECTOR_EXEMPT } from "@/config/detector-exempt";
import { UNREACHABLE } from "@/config/reach";
import { CAPABILITIES } from "@/lib/jane-agent/capabilities";
import { BASELINE } from "./baseline";
import { runHarness } from "./harness";

// Spec step 258: the nightly CI run fails on a new wrong suggestion or a person losing a
// right one, and every capability reaches someone or says why not.

describe("reach on the eight sample people", () => {
  const reports = runHarness();

  it("fails on a new wrong suggestion or a person losing a right one", () => {
    for (const r of reports) {
      const fired = r.fired.map((s) => s.topic).sort();
      const baseline = [...BASELINE[r.person.id as keyof typeof BASELINE]].sort();
      expect(
        r.wrong.map((s) => s.topic),
        `${r.person.id}: a wrong suggestion`,
      ).toEqual([]);
      expect(
        baseline.filter((t) => !fired.includes(t as never)),
        `${r.person.id} lost a suggestion; if on purpose, update src/detectors/baseline.ts`,
      ).toEqual([]);
      expect(
        fired.filter((t) => !baseline.includes(t)),
        `${r.person.id} has a new suggestion; add it to src/detectors/baseline.ts once checked against their list`,
      ).toEqual([]);
    }
  });

  it("reaches at least one sample person with every capability, or says why not", () => {
    const reached = new Set(reports.flatMap((r) => r.fired.map((s) => s.capability)));
    for (const c of CAPABILITIES) {
      if (DETECTOR_EXEMPT[c.id]) continue;
      expect(
        reached.has(c.id) || Boolean(UNREACHABLE[c.id]),
        `${c.id} reaches no sample person and isn't listed as unreachable`,
      ).toBe(true);
    }
    for (const id of Object.keys(UNREACHABLE)) {
      expect(reached.has(id), `${id} is listed unreachable but reaches someone`).toBe(false);
    }
  });
});
