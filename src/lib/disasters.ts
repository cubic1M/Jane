import { DEADLINE_NOTE_MAX } from "@/config/deadlines";
import type { Relief } from "@/config/disasters";
import type { PrismaClient } from "@/generated/prisma/client";
import { track } from "@/lib/analytics";
import { logAudit } from "@/lib/audit";
import { db as defaultClient } from "@/lib/db";
import { scopedFor } from "@/lib/db-scoped";
import { disasterFeedFor } from "@/lib/disaster-feed";
import { loadProfileInput } from "@/lib/profile";
import { recordAct } from "@/lib/sector-autopilot";
import { loadTaxEstimate, type TaxEstimateView } from "@/lib/tax-estimate";
import {
  casualtyLoss,
  computedMoves,
  countyFromPayments,
  damageSince,
  deadlineMoves,
  reliefFor,
  type CasualtyLoss,
  type Move,
} from "@/planning/disasters";

// Disasters and losses (spec step 270). A disaster declared for the person's county (from the
// disaster feed: the stand-in for demo-bank people, nobody else until a real feed) postpones
// their federal tax deadlines: Jane moves each one on their list (by herself at the levels that
// let her act, on a tap at "ask first"), and shows the dates she works out herself moved too.
// Repairs since the disaster, less what insurance and FEMA paid back, are the casualty loss,
// recorded once with the insurance claim, so it is never claimed twice.

type Options = { client?: PrismaClient; now?: Date };

export class DisasterError extends Error {}

const iso = (d: Date) => d.toISOString().slice(0, 10);

export type ReliefView = {
  relief: Relief;
  applied: boolean;
  // Tax deadlines on the person's list it moves (not yet moved), and the dates Jane works out.
  moves: Move[];
  computed: Move[];
  damage: { repairs: number; repairsCents: number; reimbursedCents: number };
  loss: CasualtyLoss;
  // The insurance claim the loss is kept with, when there is one for this disaster.
  claim: { id: string; carrier: string | null; payoutCents: number | null } | null;
  recorded: { key: string; claimId: string | null; deductibleCents: number } | null;
};

export type DisasterView = {
  year: number;
  county: string | null;
  countySource: "told" | "seen" | null;
  state: string | null;
  feed: string | null;
  relief: ReliefView[];
};

export async function loadDisasterRelief(
  userId: string,
  {
    client = defaultClient,
    now = new Date(),
    loaded,
  }: Options & { loaded?: { estimate: TaxEstimateView } } = {},
): Promise<DisasterView> {
  const db = scopedFor(userId, client);
  const today = iso(now);
  const year = now.getUTCFullYear();
  const [input, feed, profile] = await Promise.all([
    loadProfileInput(userId, { client, now }),
    disasterFeedFor(userId, { client }),
    db.taxProfiles.findFirst({ select: { state: true, disasterApplied: true } }),
  ]);
  const told = typeof input.told.county === "string" ? input.told.county : null;
  const seen = countyFromPayments(input.transactions);
  const county = told ?? seen;
  const state = profile?.state ?? null;
  const base = {
    year,
    county,
    countySource: told ? ("told" as const) : seen ? ("seen" as const) : null,
    state,
    feed: feed?.name ?? null,
  };
  if (!feed || !county) return { ...base, relief: [] };
  const matches = reliefFor(await feed.declarations(), { county, state }, today);
  if (matches.length === 0) return { ...base, relief: [] };

  const [deadlines, claims, recorded, estimate] = await Promise.all([
    db.deadlines.findMany({
      select: { id: true, title: true, dueOn: true, doneAt: true },
      orderBy: [{ dueOn: "asc" }, { id: "asc" }],
    }),
    db.insuranceClaims.findMany({
      select: { id: true, carrier: true, happenedOn: true, payoutCents: true },
      orderBy: [{ happenedOn: "asc" }, { id: "asc" }],
    }),
    db.disasterLosses.findMany({
      select: { key: true, reliefId: true, claimId: true, deductibleCents: true },
    }),
    loaded ? Promise.resolve(loaded.estimate) : loadTaxEstimate(userId, { client, now }),
  ]);
  const rows = deadlines.map((d) => ({
    id: d.id,
    title: d.title,
    dueOn: iso(d.dueOn),
    done: d.doneAt !== null,
  }));
  const applied = new Set(profile?.disasterApplied ?? []);
  const relief = matches.map((r): ReliefView => {
    const damage = damageSince(input.transactions, r.incidentFrom);
    const claim = claims.find((c) => iso(c.happenedOn) >= r.incidentFrom) ?? null;
    const reimbursed = Math.max(damage.reimbursedCents, claim?.payoutCents ?? 0);
    const mine = recorded.find((x) => x.reliefId === r.id) ?? null;
    return {
      relief: r,
      applied: applied.has(r.id),
      moves: deadlineMoves(r, rows),
      computed: computedMoves(r, [year - 1, year, year + 1]),
      damage: { ...damage, reimbursedCents: reimbursed },
      loss: casualtyLoss({
        repairsCents: damage.repairsCents,
        reimbursedCents: reimbursed,
        agiCents: estimate.estimate.agiCents,
        relief: r,
      }),
      claim: claim && { id: claim.id, carrier: claim.carrier, payoutCents: claim.payoutCents },
      recorded: mine && {
        key: mine.key,
        claimId: mine.claimId,
        deductibleCents: mine.deductibleCents,
      },
    };
  });
  return { ...base, relief };
}

const findRelief = (view: DisasterView, reliefId: string) => {
  const r = view.relief.find((x) => x.relief.id === reliefId);
  if (!r) throw new DisasterError("That disaster relief doesn't cover your county.");
  return r;
};

// Moves every tax deadline on the person's list that the postponement covers to its new date,
// with a note saying why. Once per disaster: a deadline already moved isn't moved again.
export async function applyRelief(
  userId: string,
  reliefId: string,
  { client = defaultClient, now = new Date(), via }: Options & { via: "chat" | "autopilot" },
): Promise<Move[]> {
  const view = await loadDisasterRelief(userId, { client, now });
  const r = findRelief(view, reliefId);
  if (r.applied) throw new DisasterError("Your tax deadlines are already moved for this one.");
  const db = scopedFor(userId, client);
  for (const m of r.moves) {
    const row = await db.deadlines.findFirst({ where: { id: m.id }, select: { note: true } });
    const why = `Moved from ${m.from} by the IRS disaster postponement for ${view.county} County (${r.relief.title}).`;
    await db.deadlines.updateMany({
      where: { id: m.id },
      data: {
        dueOn: new Date(`${m.to}T00:00:00Z`),
        note: [row?.note, why].filter(Boolean).join(" ").slice(0, DEADLINE_NOTE_MAX),
      },
    });
  }
  await db.taxProfiles.upsert({
    where: { userId },
    create: { userId, disasterApplied: [reliefId] },
    update: { disasterApplied: { push: reliefId } },
  });
  await logAudit(
    { type: via === "autopilot" ? "system" : "user", id: via === "autopilot" ? null : userId },
    "tax_deadlines_postponed",
    { type: "user", id: userId },
    { relief: reliefId, moved: r.moves.length },
  );
  await track(userId, "tax_deadlines_postponed", { relief: reliefId, moved: r.moves.length, via });
  if (via === "autopilot") {
    await recordAct(
      userId,
      "taxes",
      0,
      `Moved ${r.moves.length} tax deadline${r.moves.length === 1 ? "" : "s"} to ${r.relief.postponedTo} for disaster relief`,
      { client, now },
    );
  }
  return r.moves;
}

// At the levels that let Jane act: each new postponement is applied by itself.
export async function applyReliefWhenDeclared(
  userId: string,
  { client = defaultClient, now = new Date() }: Options = {},
): Promise<number> {
  const view = await loadDisasterRelief(userId, { client, now });
  let moved = 0;
  for (const r of view.relief) {
    if (r.applied) continue;
    moved += (await applyRelief(userId, r.relief.id, { client, now, via: "autopilot" })).length;
  }
  return moved;
}

// Records the disaster's loss with its insurance claim, once. A second time for the same
// disaster and claim is refused, so the loss is never counted twice.
export async function recordDisasterLoss(
  userId: string,
  reliefId: string,
  { client = defaultClient, now = new Date() }: Options = {},
) {
  const view = await loadDisasterRelief(userId, { client, now });
  const r = findRelief(view, reliefId);
  if (r.loss.repairsCents <= 0) throw new DisasterError("I don't see repair costs since then.");
  const key = `${reliefId}:${r.claim?.id ?? "none"}`;
  const db = scopedFor(userId, client);
  if (r.recorded || (await db.disasterLosses.count({ where: { key } })) > 0)
    throw new DisasterError("That loss is already recorded with your claim.");
  const row = await db.disasterLosses.create({
    data: {
      userId,
      key,
      reliefId,
      claimId: r.claim?.id ?? null,
      taxYear: Number(r.relief.incidentFrom.slice(0, 4)),
      lossCents: r.loss.lossCents,
      reimbursedCents: r.loss.reimbursedCents,
      deductibleCents: r.loss.deductibleCents,
    },
    select: { id: true, deductibleCents: true, claimId: true },
  });
  await logAudit(
    { type: "user", id: userId },
    "disaster_loss_recorded",
    { type: "user", id: userId },
    { relief: reliefId, withClaim: row.claimId !== null },
  );
  await track(userId, "disaster_loss_recorded", { relief: reliefId });
  return row;
}
