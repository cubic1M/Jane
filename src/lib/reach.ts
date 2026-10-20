import { TOOL_EXEMPT } from "@/config/detector-exempt";
import { UNREACHABLE } from "@/config/reach";
import { TRIAL_ID_PREFIX } from "@/config/trial";
import { DETECTORS } from "@/detectors";
import { runHarness } from "@/detectors/harness";
import { MISSING_DETECTOR } from "@/detectors/missing";
import type { PrismaClient } from "@/generated/prisma/client";
import { db as defaultClient } from "@/lib/db";
import { CHAT_TOOLS } from "@/lib/jane-agent/claude-tools";
import { worthOnce } from "@/planning/suggestion-rank";
import { type Answered, bandsOf, offDetectors } from "@/planning/calibration";

// The reach scoreboard (spec step 258): which capabilities fired for whom, the dollars shown,
// the yes rate, the wrong suggestions and the capabilities that never reach anyone. The eight
// sample people come from the detector harness (per person); the people actually using Jane
// are in totals only, sample (trial) people apart from real ones. Confidence is checked for
// honesty from the suggestions people answered.

export type Totals = {
  offered: number;
  yes: number;
  no: number;
  dollarsCents: number;
  byCapability: {
    capability: string;
    offered: number;
    yes: number;
    no: number;
    dollarsCents: number;
  }[];
};

const empty = (): Totals => ({ offered: 0, yes: 0, no: 0, dollarsCents: 0, byCapability: [] });

export async function reachReport({ client = defaultClient }: { client?: PrismaClient } = {}) {
  const reports = runHarness();
  const people = reports.map((r) => ({
    id: r.person.id,
    label: r.person.label,
    fired: r.fired.map((s) => ({
      capability: s.capability,
      topic: s.topic,
      percent: s.confidence.percent,
      reason: s.confidence.reason,
      worthCents: s.worthCents,
    })),
    // Each piece of money counted once, even when two suggestions touch it.
    dollarsCents: worthOnce(r.fired),
    missed: r.missed,
    wrong: r.wrong.map((s) => s.topic),
  }));
  const reached = new Map<string, string[]>();
  for (const r of reports) {
    for (const s of r.fired)
      reached.set(s.capability, [...new Set([...(reached.get(s.capability) ?? []), r.person.id])]);
  }

  const rows = await client.suggestion.findMany({
    where: { selectedOn: { not: null } },
    select: {
      userId: true,
      capability: true,
      topic: true,
      worthCents: true,
      confidencePercent: true,
      status: true,
    },
  });
  const sample = empty();
  const real = empty();
  const answered: Answered[] = [];
  const per = {
    sample: new Map<string, Totals["byCapability"][number]>(),
    real: new Map<string, Totals["byCapability"][number]>(),
  };
  for (const r of rows) {
    const isSample = r.userId.startsWith(TRIAL_ID_PREFIX);
    const totals = isSample ? sample : real;
    const map = isSample ? per.sample : per.real;
    const cap = map.get(r.capability) ?? {
      capability: r.capability,
      offered: 0,
      yes: 0,
      no: 0,
      dollarsCents: 0,
    };
    totals.offered += 1;
    cap.offered += 1;
    totals.dollarsCents += r.worthCents;
    cap.dollarsCents += r.worthCents;
    if (r.status === "yes") ((totals.yes += 1), (cap.yes += 1));
    if (r.status === "no") ((totals.no += 1), (cap.no += 1));
    map.set(r.capability, cap);
    // Real people's answers are what confidence is checked against; sample people's too, as
    // they are the ones testers answer for.
    if (r.status === "yes" || r.status === "no") {
      answered.push({
        detector: r.capability === "strategist" ? "strategist" : `${r.capability}:${r.topic}`,
        percent: r.confidencePercent,
        right: r.status === "yes",
      });
    }
  }
  sample.byCapability = [...per.sample.values()].sort((a, b) =>
    a.capability.localeCompare(b.capability),
  );
  real.byCapability = [...per.real.values()].sort((a, b) =>
    a.capability.localeCompare(b.capability),
  );

  // Coverage per feature: which registry tools a detector brings to people unasked.
  const tools = CHAT_TOOLS.map((t) => t.name);
  const by = new Map<string, string[]>();
  for (const d of DETECTORS) {
    for (const t of d.covers) by.set(t, [...(by.get(t) ?? []), `${d.capability}:${d.topic}`]);
  }
  const coverage = {
    total: tools.length,
    covered: tools.filter((t) => by.has(t)).map((tool) => ({ tool, detectors: by.get(tool)! })),
    exempt: tools
      .filter((t) => TOOL_EXEMPT[t])
      .map((tool) => ({ tool, reason: TOOL_EXEMPT[tool] })),
    missing: tools.filter((t) => MISSING_DETECTOR.includes(t)),
  };

  return {
    coverage,
    people,
    capabilities: [...reached.entries()]
      .map(([capability, who]) => ({ capability, people: who }))
      .sort((a, b) => a.capability.localeCompare(b.capability)),
    unreachable: Object.entries(UNREACHABLE).map(([capability, reason]) => ({
      capability,
      reason,
    })),
    sample,
    real,
    bands: bandsOf(answered),
    off: offDetectors(answered),
  };
}
