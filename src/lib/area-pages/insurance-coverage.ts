import { insuranceCard } from "@/lib/insurance/need/card";
import { coverEvents } from "@/lib/insurance/cover-changes";
import { openedGaps } from "@/lib/insurance/need/rework";
import { loadNeeds, optionsForNeed } from "@/lib/insurance/need/load";
import type { Need } from "@/lib/insurance/need/types";

// Your perfect coverage (spec step 279): the needs, which of them a life event opened, and the
// options card for the one asked for. Shown by src/app/insurance/perfect-coverage.tsx.

export const needKey = (n: Pick<Need, "kind" | "policyId">) =>
  `${n.kind}${n.policyId ? `-${n.policyId}` : ""}`;

export const isShort = (n: Need) => (n.direction ? n.direction !== "ok" : n.gapCents > 0);

export type Coverage = Awaited<ReturnType<typeof loadCoverage>>;

// The needs, which of them a life event opened, and the options card for the one asked for.
export async function loadCoverage(
  userId: string,
  { advice, selected, policyId }: { advice: boolean; selected: string; policyId: string },
) {
  const needs = (await loadNeeds(userId)) ?? [];
  if (needs.length === 0) return { needs, opened: new Set<string>(), card: null, open: null };
  const events = (await coverEvents(userId)).map((e) => e.event);
  const opened = new Set(openedGaps(needs, events).map((g) => needKey(g.need)));
  const open = needs.find((n) => n.kind === selected && (!policyId || n.policyId === policyId));
  const found =
    open && advice
      ? await optionsForNeed(userId, open.kind, { policyId: policyId || undefined })
      : null;
  const card = found ? insuranceCard(found.set, found.need, advice) : null;
  return { needs, opened, card, open: open ?? null };
}
