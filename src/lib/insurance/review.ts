import { KEEP_COVERED_SAVING_KINDS } from "@/config/insurance";
import type { PrismaClient } from "@/generated/prisma/client";
import { track } from "@/lib/analytics";
import { db as defaultClient } from "@/lib/db";
import { scopedFor } from "@/lib/db-scoped";
import { formatCents } from "@/lib/money";
import { autopilotFor, mayAct, recordAct } from "@/lib/sector-autopilot";
import type { Checkup } from "./checkups";
import { loadHealthYear } from "./health-year";
import { coverEvents, listCoverChanges } from "./cover-changes";
import { loadNeeds } from "./need/load";
import { openedGaps } from "./need/rework";
import { callCarrier, listNegotiations, NegotiationError } from "./negotiate";
import { listClaims } from "./claims";
import { listRisks } from "./risks";
import type { ReviewInput } from "./review-rules";
import { lowersCover } from "./saving-rules";
import { applySaving, listSavings, SavingError } from "./savings";

// The yearly insurance review (spec step 202). "Keep me covered" does what leaves the cover
// as it is: pays less for the same cover (a payment plan, autopay, paperless, a bundle) and
// calls the insurer about a renewal that's going up. At "Everything allowed" Jane does it by
// itself, within the person's caps; below that it takes their tap on "Keep me covered".
// Nothing that lowers the cover (a higher deductible) and nothing that changes cover is ever
// done without a tap.

type Options = { client?: PrismaClient; now?: Date };

export type KeepCovered = { savings: number; calls: number; yearlySavingCents: number };

export async function keepCovered(
  userId: string,
  {
    client = defaultClient,
    now = new Date(),
    by = "you",
  }: Options & { by?: "you" | "autopilot" } = {},
): Promise<KeepCovered> {
  const done: KeepCovered = { savings: 0, calls: 0, yearlySavingCents: 0 };
  const offered = (await listSavings(userId, { client, status: "offered" })).filter(
    (s) => !lowersCover(s.kind) && KEEP_COVERED_SAVING_KINDS.includes(s.kind),
  );
  for (const saving of offered) {
    if (by === "autopilot") {
      // Paying a year up front commits that much; the rest cost nothing.
      const cents = saving.kind === "pay_in_full" ? (saving.detail.payNowCents ?? 0) : 0;
      if (!(await mayAct(userId, "insurance", { needs: "all", cents }, { client, now })).ok) {
        continue;
      }
    }
    try {
      const applied = await applySaving(userId, saving.id, { client, now });
      done.savings += 1;
      done.yearlySavingCents += applied.yearlySavingCents;
      if (by === "autopilot") {
        const cents = saving.kind === "pay_in_full" ? (saving.detail.payNowCents ?? 0) : 0;
        await recordAct(
          userId,
          "insurance",
          cents,
          `Applied a ${saving.kind.replaceAll("_", " ")} saving worth about ${formatCents(applied.yearlySavingCents)} a year`,
          { client, now },
        );
      }
    } catch (error) {
      if (error instanceof SavingError) continue;
      throw error;
    }
  }
  for (const n of await listNegotiations(userId, { client, status: "asked" })) {
    if (by === "autopilot") {
      const monthlyRise = Math.round((n.renewalAnnualCents - n.currentAnnualCents) / 12);
      if (
        !(await mayAct(userId, "insurance", { needs: "all", cents: monthlyRise }, { client, now }))
          .ok
      ) {
        continue;
      }
    }
    try {
      await callCarrier(userId, n.id, { client, now, by });
      done.calls += 1;
    } catch (error) {
      if (error instanceof NegotiationError) continue;
      throw error;
    }
  }
  if (done.savings + done.calls > 0) {
    await track(userId, "insurance_keep_covered", { by, savings: done.savings, calls: done.calls });
  }
  return done;
}

// What the yearly review says, from the records: Jane's own acts since the last review, and
// everything still waiting.
export async function loadReview(
  userId: string,
  checkup: Pick<Checkup, "recommendations" | "createdAt">,
  gaps: number,
  { client = defaultClient, now = new Date() }: Options = {},
): Promise<ReviewInput> {
  const db = scopedFor(userId, client);
  const since = new Date(checkup.createdAt.getTime() - 30 * 86_400_000);
  const [
    setting,
    acts,
    savings,
    negotiations,
    risks,
    changes,
    claims,
    health,
    applied,
    needs,
    events,
  ] = await Promise.all([
    autopilotFor(userId, "insurance", { client, now }),
    db.autopilotActs.findMany({
      where: { sector: "insurance", createdAt: { gte: since } },
      select: { what: true },
      orderBy: { createdAt: "asc" },
    }),
    listSavings(userId, { client, status: "offered" }),
    listNegotiations(userId, { client, status: "asked" }),
    listRisks(userId, { client, status: "asked" }),
    listCoverChanges(userId, { client, status: "prepared" }),
    listClaims(userId, { client }),
    loadHealthYear(userId, { client, now }),
    db.insuranceSavings.findMany({
      where: { status: "applied", answeredAt: { gte: since } },
      select: { yearlySavingCents: true },
    }),
    // Spec step 280: the needs, fresh, and the life events that can have opened a gap.
    loadNeeds(userId, { client, now }),
    coverEvents(userId, { client, now }),
  ]);
  const opened = openedGaps(
    needs ?? [],
    events.map((e) => e.event),
  );
  return {
    level: setting.level,
    did: acts.map((a) => a.what),
    savedYearlyCents: applied.reduce((n, a) => n + a.yearlySavingCents, 0),
    savings: savings.map((s) => ({ kind: s.kind, yearlySavingCents: s.yearlySavingCents })),
    calls: negotiations.length,
    risks: risks.length,
    coverChanges: changes.length,
    gaps,
    recommendations: checkup.recommendations.map((r) => ({
      title: r.title,
      cost: r.cost,
      costCents: r.costCents,
      cents: r.cents,
    })),
    claimDrafts: claims.filter((c) => c.status === "open" && c.filing === "draft").length,
    opened: opened.map((o) => ({
      kind: o.need.kind,
      policyId: o.need.policyId,
      because: o.because,
      summary: o.need.summary,
      cents: [
        o.need.needCents,
        o.need.haveCents,
        o.need.gapCents,
        ...o.need.lines.map((l) => l.cents),
      ],
    })),
    health: health
      ? {
          fsaLeftCents: health.fsa?.warn ? health.fsa.leftCents : 0,
          fsaDeadline: health.fsa?.deadline ?? null,
          disputes: health.disputes.length,
        }
      : null,
  };
}
