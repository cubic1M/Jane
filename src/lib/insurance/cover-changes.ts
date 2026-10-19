import {
  CARRIER_CHANGES,
  COVER_CHANGES_DAILY_LIMIT,
  COVER_EVENT_WINDOW_DAYS,
  NO_PRICE_CHANGES,
  type CoverChangeKind,
  type CoverEvent,
} from "@/config/insurance";
import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import { track } from "@/lib/analytics";
import { SYSTEM_ACTOR, logAudit } from "@/lib/audit";
import { db as defaultClient } from "@/lib/db";
import { scopedFor } from "@/lib/db-scoped";
import { mayAct, recordAct } from "@/lib/sector-autopilot";
import { changesFor } from "./cover-change-rules";
import { sizeLife } from "./life";
import { partnerFor, type InsurancePartner } from "./partner";
import { listPolicies, type Policy } from "./policies";

// Cover changes with life events (spec step 154). When the person buys a car, moves, has a
// baby, marries or starts a new job (from step 100's life events, their accounts, or what
// they tell Jane), Jane prepares the cover changes it needs and asks once. Each change is
// made with the carrier through the insurance partner on the person's tap. The one change
// that never moves the price, an address, Jane makes herself when Insurance is set to
// "Everything allowed". Without a partner, the person makes the changes with their insurer
// and taps Done.

type Options = { client?: PrismaClient; now?: Date; partner?: InsurancePartner | null };

export class CoverChangeError extends Error {}

export type CoverChange = {
  id: string;
  event: CoverEvent;
  eventKey: string;
  change: CoverChangeKind;
  policyId: string | null;
  detail: Record<string, string | number>;
  status: "prepared" | "done" | "dismissed";
  newPremiumCents: number | null;
  confirmation: string | null;
  doneBy: string | null;
};

const SELECT = {
  id: true,
  event: true,
  eventKey: true,
  change: true,
  policyId: true,
  detail: true,
  status: true,
  newPremiumCents: true,
  confirmation: true,
  doneBy: true,
} as const;

function toChange(row: Prisma.CoverChangeGetPayload<{ select: typeof SELECT }>): CoverChange {
  return {
    ...row,
    event: row.event as CoverEvent,
    change: row.change as CoverChangeKind,
    detail: (row.detail ?? {}) as CoverChange["detail"],
    status: row.status as CoverChange["status"],
  };
}

const DAY = 86_400_000;

export type CoverEventFound = {
  event: CoverEvent;
  eventKey: string;
  detail: Record<string, string | number>;
};

// The life events of the last COVER_EVENT_WINDOW_DAYS: step 100's checklists (a move, a new
// job, a baby), a car added to what they own or a new car loan, and what they told Jane.
export async function coverEvents(
  userId: string,
  { client = defaultClient, now = new Date() }: Options = {},
): Promise<CoverEventFound[]> {
  const db = scopedFor(userId, client);
  const since = new Date(now.getTime() - COVER_EVENT_WINDOW_DAYS * DAY);
  const [lifeEvents, cars, carLoans] = await Promise.all([
    db.lifeEvents.findMany({
      where: { startedOn: { gte: since } },
      select: { id: true, kind: true },
    }),
    db.ownedAssets.findMany({
      where: { kind: "vehicle", createdAt: { gte: since } },
      select: { id: true, name: true, loanAccountId: true },
    }),
    db.liabilities.findMany({
      where: { kind: "loan", originationDate: { gte: since }, account: { subtype: "auto" } },
      select: { accountId: true, account: { select: { name: true } } },
    }),
  ]);
  const KINDS: Record<string, CoverEvent> = {
    moving: "moving",
    new_job: "new_job",
    new_baby: "new_baby",
  };
  const linkedLoans = new Set(cars.map((c) => c.loanAccountId).filter(Boolean));
  return [
    ...lifeEvents.flatMap((e) =>
      KINDS[e.kind] ? [{ event: KINDS[e.kind], eventKey: e.id, detail: {} }] : [],
    ),
    ...cars.map((c) => ({
      event: "car_bought" as const,
      eventKey: c.id,
      detail: { vehicle: c.name },
    })),
    ...carLoans
      .filter((l) => !linkedLoans.has(l.accountId))
      .map((l) => ({
        event: "car_bought" as const,
        eventKey: l.accountId,
        detail: { vehicle: "the new car" },
      })),
  ];
}

export async function listCoverChanges(
  userId: string,
  { client = defaultClient, status }: Options & { status?: CoverChange["status"] } = {},
): Promise<CoverChange[]> {
  const rows = await scopedFor(userId, client).coverChanges.findMany({
    where: status ? { status } : {},
    select: SELECT,
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });
  return rows.map(toChange);
}

// Prepares the changes for each event, once: an event already prepared, made or dismissed
// isn't prepared again. Then, at "Everything allowed", Jane makes the no-price ones herself.
export async function prepareCoverChanges(
  userId: string,
  {
    client = defaultClient,
    now = new Date(),
    partner,
    events,
  }: Options & {
    events?: CoverEventFound[];
  } = {},
): Promise<number> {
  const db = scopedFor(userId, client);
  const found = events ?? (await coverEvents(userId, { client, now }));
  if (found.length === 0) return 0;
  const [policies, known] = await Promise.all([
    listPolicies(userId, { client }),
    db.coverChanges.findMany({ select: { event: true, eventKey: true } }),
  ]);
  const seen = new Set(known.map((k) => `${k.event}:${k.eventKey}`));
  let prepared = 0;
  for (const e of found.filter((e) => !seen.has(`${e.event}:${e.eventKey}`))) {
    const planned = changesFor(e.event, policies, e.detail);
    if (planned.length === 0) continue;
    const { count } = await db.coverChanges.createMany({
      data: planned.map((p) => ({
        userId,
        event: e.event,
        eventKey: e.eventKey,
        change: p.change,
        policyId: p.policyId,
        detail: p.detail,
        createdAt: now,
      })),
      skipDuplicates: true,
    });
    prepared += count;
    await track(userId, "cover_changes_prepared", { event: e.event, changes: count });
    await byAutopilot(userId, e.event, e.eventKey, { client, now, partner });
  }
  return prepared;
}

// At "Everything allowed": the changes that never move the price, made by Jane.
async function byAutopilot(
  userId: string,
  event: CoverEvent,
  eventKey: string,
  options: Options & { client: PrismaClient; now: Date },
) {
  const allowed = await mayAct(userId, "insurance", { needs: "all", cents: 0 }, options);
  if (!allowed.ok) return;
  const done = await applyCoverEvent(userId, event, eventKey, {
    ...options,
    only: NO_PRICE_CHANGES,
    by: "autopilot",
  });
  if (done.length > 0) {
    await recordAct(
      userId,
      "insurance",
      0,
      `Updated the address on ${done.length === 1 ? "a policy" : `${done.length} policies`} after your move`,
      options,
    );
  }
}

// Makes the event's prepared changes: with the carrier through the partner, or, without one,
// marked done by the person who made them. A review of life cover runs the sizing (demo
// advice); a baby is added to the household. Returns what was made.
export async function applyCoverEvent(
  userId: string,
  event: CoverEvent,
  eventKey: string,
  {
    client = defaultClient,
    now = new Date(),
    partner,
    only,
    by = "you",
  }: Options & { only?: readonly CoverChangeKind[]; by?: "you" | "autopilot" } = {},
): Promise<CoverChange[]> {
  const db = scopedFor(userId, client);
  const prepared = (await listCoverChanges(userId, { client, status: "prepared" })).filter(
    (c) => c.event === event && c.eventKey === eventKey && (!only || only.includes(c.change)),
  );
  if (prepared.length === 0) return [];
  const carrier = partner === undefined ? await partnerFor(userId, { client }) : partner;
  const policies = new Map<string, Policy>(
    (await listPolicies(userId, { client })).map((p) => [p.id, p]),
  );
  const made: CoverChange[] = [];
  for (const change of prepared) {
    const policy = change.policyId ? policies.get(change.policyId) : undefined;
    let update: Prisma.CoverChangeUpdateManyMutationInput = {
      status: "done",
      doneAt: now,
      doneBy: by,
    };
    if (CARRIER_CHANGES.includes(change.change)) {
      // Without a partner Jane can't make it with the carrier: only the person can.
      if (!carrier && by === "autopilot") continue;
      if (carrier && policy) {
        const endorsed = await carrier.endorse(
          { carrier: policy.carrier, kind: policy.kind, premiumCents: policy.premiumCents },
          { kind: change.change, detail: change.detail },
          { now },
        );
        update = {
          ...update,
          newPremiumCents: endorsed.premiumCents,
          confirmation: endorsed.confirmation,
        };
        if (endorsed.premiumCents !== null && endorsed.premiumCents !== policy.premiumCents) {
          await db.insurancePolicies.updateMany({
            where: { id: policy.id },
            data: { premiumCents: endorsed.premiumCents },
          });
        }
      }
    }
    if (change.change === "review_life") await sizeLife(userId, { client, now, asked: true });
    const { count } = await db.coverChanges.updateMany({
      where: { id: change.id, status: "prepared" },
      data: update,
    });
    if (count > 0) {
      made.push({
        ...change,
        status: "done",
        newPremiumCents: (update.newPremiumCents as number | null | undefined) ?? null,
        confirmation: (update.confirmation as string | null | undefined) ?? null,
        doneBy: by,
      });
    }
  }
  if (
    event === "new_baby" &&
    made.some((c) => c.change === "add_dependant" || c.change === "review_life")
  ) {
    const profile = await db.insuranceProfiles.findFirst({ select: { dependants: true } });
    const dependants = (profile?.dependants ?? 0) + 1;
    await db.insuranceProfiles.upsert({
      where: { userId },
      create: { userId, dependants },
      update: { dependants },
    });
  }
  if (made.length > 0) {
    await logAudit(
      by === "autopilot" ? SYSTEM_ACTOR : { type: "user", id: userId },
      "insurance_cover_changed",
      { type: "user", id: userId },
      { event, changes: made.map((c) => c.change).join(","), by },
    );
    await track(userId, "cover_changes_made", { event, changes: made.length, by });
  }
  return made;
}

// Not now: nothing changes, and the event isn't asked about again.
export async function dismissCoverEvent(
  userId: string,
  event: CoverEvent,
  eventKey: string,
  { client = defaultClient, now = new Date() }: Options = {},
): Promise<number> {
  const { count } = await scopedFor(userId, client).coverChanges.updateMany({
    where: { event, eventKey, status: "prepared" },
    data: { status: "dismissed", doneAt: now },
  });
  if (count === 0) throw new CoverChangeError("That one's already been answered.");
  await track(userId, "cover_changes_dismissed", { event });
  return count;
}

// "I got married", "I bought a car": told to Jane, prepared now. Returns the event's key.
export async function tellCoverEvent(
  userId: string,
  event: CoverEvent,
  { client = defaultClient, now = new Date(), partner }: Options = {},
): Promise<string> {
  const eventKey = `told:${now.toISOString().slice(0, 10)}`;
  await prepareCoverChanges(userId, {
    client,
    now,
    partner,
    events: [{ event, eventKey, detail: event === "car_bought" ? { vehicle: "the new car" } : {} }],
  });
  return eventKey;
}

// The daily run: everyone with an active policy.
export async function coverChangesAll({
  client = defaultClient,
  now = new Date(),
}: Options = {}): Promise<{ people: number; prepared: number }> {
  // A system job across users: ids only; everything after is scoped to the person.
  const people = await client.insurancePolicy.findMany({
    where: { status: "active" },
    select: { userId: true },
    distinct: ["userId"],
    take: COVER_CHANGES_DAILY_LIMIT,
  });
  let prepared = 0;
  for (const { userId } of people) {
    try {
      prepared += await prepareCoverChanges(userId, { client, now });
    } catch (error) {
      console.error("Cover changes failed", { userId, error: String(error) });
    }
  }
  return { people: people.length, prepared };
}
