import {
  DEFAULT_FED_RATE,
  DEFAULT_STATE_RATE,
  EMERGENCY_FLOOR_MONTHS,
  SHORT_TERM_MONTHS,
} from "@/config/short-term";
import type { PrismaClient } from "@/generated/prisma/client";
import { adviceMode } from "@/lib/advice-mode";
import { track } from "@/lib/analytics";
import { logAudit } from "@/lib/audit";
import { db as defaultClient } from "@/lib/db";
import { scopedFor } from "@/lib/db-scoped";
import { listGoals } from "@/lib/goals";
import { loadTaxEstimate } from "@/lib/tax-estimate";
import { loadWorkingProfile } from "@/lib/tax-profile";
import { stateRate } from "@/planning/college";
import {
  addMonths,
  compare,
  ladder,
  monthsBetween,
  neverPastGoal,
  type Option,
  type Rung,
} from "@/planning/short-term";
import { loadCash } from "./cash";

// Short-term money, placed safely (spec step 234, demo advice), for its page, Jane's answers
// and its buttons. Money needed within three years is compared after tax in the person's own
// state; a Treasury bill ladder matures when the money is needed and, through a stand-in,
// rolls itself over until then. Nothing is ever locked past the goal date. The emergency
// fund's floor stays in high-yield savings; only what's above it can go in bills, which can
// be sold any business day.

type Options = { client?: PrismaClient; now?: Date };

export class ShortTermError extends Error {}

const iso = (d: Date) => d.toISOString().slice(0, 10);

export type Candidate = {
  key: string;
  purpose: "goal" | "emergency";
  goalId: string | null;
  name: string;
  amountCents: number;
  months: number;
  endsOn: string;
  options: Option[];
  best: Option;
  // A ladder of bills, when bills win; otherwise null (savings or a CD does better).
  ladder: Rung[] | null;
  // What the best option earns over savings after tax a year, in cents.
  gainCents: number;
  hasLadder: boolean;
};

export type LadderView = {
  id: string;
  name: string;
  amountCents: number;
  endsOn: string;
  rungs: Rung[];
  events: { on: string; rung: number; term: number; amountCents: number }[];
  status: string;
  // Each rung's bill now and when it matures, as of `now`.
  now: { rung: number; term: number; maturesOn: string }[];
};

export type ShortTermView = {
  advice: boolean;
  fed: number;
  state: number;
  stateCode: string | null;
  fromProfile: boolean;
  candidates: Candidate[];
  ladders: LadderView[];
};

function onDate(startOn: string, endMonth: number) {
  return addMonths(startOn, endMonth);
}

export async function loadShortTerm(
  userId: string,
  { client = defaultClient, now = new Date() }: Options = {},
): Promise<ShortTermView> {
  const db = scopedFor(userId, client);
  const today = iso(now);
  const [advice, goals, ladders, estimate, working, cash] = await Promise.all([
    adviceMode(userId, { client }),
    listGoals(userId, { client, now }),
    db.billLadders.findMany({ orderBy: { createdAt: "desc" } }),
    loadTaxEstimate(userId, { client, now }).catch(() => null),
    loadWorkingProfile(userId, { client }).catch(() => null),
    loadCash(userId, { client, now }).catch(() => null),
  ]);
  const fed = estimate?.estimate.marginalRate ?? DEFAULT_FED_RATE;
  const code = working?.profile.state ?? null;
  const state = working ? stateRate(code, working.profile.filingStatus) : DEFAULT_STATE_RATE;
  const active = ladders.filter((l) => l.status === "active");
  const build = (
    key: string,
    purpose: "goal" | "emergency",
    goalId: string | null,
    name: string,
    amountCents: number,
    months: number,
    only?: (o: Option) => boolean,
  ): Candidate | null => {
    if (amountCents < 100_000 || months < 1) return null;
    const options = compare({ amountCents, months, fed, state }).filter((o) => !only || only(o));
    if (options.length === 0) return null;
    const best = options[0];
    const hysa = options.find((o) => o.product.key === "hysa") ?? best;
    const bills =
      best.product.key.startsWith("tbill_") || (months >= 3 && best.product.stateTaxed === false);
    const rungs = bills && months >= 3 ? ladder(amountCents, months) : null;
    return {
      key,
      purpose,
      goalId,
      name,
      amountCents,
      months,
      endsOn: addMonths(today, months),
      options,
      best,
      ladder: rungs && neverPastGoal(rungs, months) ? rungs : null,
      gainCents: best.yearlyCents - hysa.yearlyCents,
      hasLadder: active.some((l) => (goalId ? l.goalId === goalId : l.purpose === purpose)),
    };
  };
  const candidates: Candidate[] = [];
  for (const g of goals) {
    const months = monthsBetween(today, g.targetDate);
    const saved =
      g.progress.status === "date_passed" || g.progress.status === "reached"
        ? 0
        : g.progress.savedCents;
    if (months > SHORT_TERM_MONTHS) continue;
    const c = build(`goal:${g.id}`, "goal", g.id, g.name, saved, months);
    if (c) candidates.push(c);
  }
  // The emergency fund above its floor: savings or bills only (both reachable in days).
  if (cash?.plan) {
    const emergency = cash.plan.buckets.find((b) => b.key === "emergency")?.cents ?? 0;
    const floor = cash.monthlySpendingCents * EMERGENCY_FLOOR_MONTHS;
    const c = build(
      "emergency",
      "emergency",
      null,
      "Emergency fund above its floor",
      Math.max(0, emergency - floor),
      12,
      (o) => o.product.key === "hysa" || o.product.key.startsWith("tbill_"),
    );
    if (c) candidates.push(c);
  }
  return {
    advice,
    fed,
    state,
    stateCode: code,
    fromProfile: estimate !== null && working !== null,
    candidates,
    ladders: ladders.map((l): LadderView => {
      const rungs = l.rungs as unknown as Rung[];
      const start = iso(l.startOn);
      return {
        id: l.id,
        name: l.name,
        amountCents: l.amountCents,
        endsOn: iso(l.endsOn),
        rungs,
        events: l.events as never,
        status: l.status,
        now: rungs.map((r, i) => {
          const elapsed = monthsBetween(start, today);
          const bill =
            r.bills.find(
              (b) =>
                b.endMonth > elapsed ||
                (b.endMonth === elapsed && onDate(start, b.endMonth) > today),
            ) ?? r.bills.at(-1);
          return {
            rung: i,
            term: bill?.term ?? 0,
            maturesOn: bill ? onDate(start, bill.endMonth) : iso(l.endsOn),
          };
        }),
      };
    }),
  };
}

// Tap: start the ladder the page showed. Every bill must mature by the goal date.
export async function startLadder(
  userId: string,
  key: string,
  { client = defaultClient, now = new Date() }: Options = {},
) {
  const view = await loadShortTerm(userId, { client, now });
  if (!view.advice) throw new ShortTermError("This is only in demo advice mode for now.");
  const c = view.candidates.find((x) => x.key === key);
  if (!c?.ladder) throw new ShortTermError("There's no ladder to build for that any more.");
  if (c.hasLadder) throw new ShortTermError("That already has a ladder.");
  if (!neverPastGoal(c.ladder, c.months))
    throw new ShortTermError("A bill would run past the date, so I won't buy it.");
  const row = await scopedFor(userId, client).billLadders.create({
    data: {
      userId,
      purpose: c.purpose,
      goalId: c.goalId,
      name: c.name,
      amountCents: c.amountCents,
      startOn: new Date(`${iso(now)}T00:00:00Z`),
      endsOn: new Date(`${c.endsOn}T00:00:00Z`),
      rungs: c.ladder as never,
    },
    select: { id: true },
  });
  await logAudit(
    { type: "user", id: userId },
    "ladder_started",
    { type: "bill_ladder", id: row.id },
    { simulated: true },
  );
  await track(userId, "ladder_started", { purpose: c.purpose });
  return { name: c.name, rungs: c.ladder.length, endsOn: c.endsOn };
}

// The stand-in rolls every bill that matured before the goal date into the next one, once
// each, and closes a ladder when its date comes (the money is cash again). Idempotent.
export async function settleLadders(
  userId: string,
  { client = defaultClient, now = new Date() }: Options = {},
) {
  const db = scopedFor(userId, client);
  const today = iso(now);
  const rows = await db.billLadders.findMany({ where: { status: "active" } });
  let rolled = 0;
  for (const l of rows) {
    const rungs = l.rungs as unknown as Rung[];
    const start = iso(l.startOn);
    const events = (l.events as unknown as LadderView["events"]) ?? [];
    const seen = new Set(events.map((e) => `${e.rung}:${e.on}`));
    const add: LadderView["events"] = [];
    rungs.forEach((r, i) =>
      r.bills.slice(0, -1).forEach((b, j) => {
        const on = onDate(start, b.endMonth);
        const next = r.bills[j + 1];
        if (on <= today && !seen.has(`${i}:${on}`)) {
          add.push({ on, rung: i, term: next.term, amountCents: r.amountCents });
        }
      }),
    );
    const done = iso(l.endsOn) <= today;
    if (add.length === 0 && !done) continue;
    await db.billLadders.updateMany({
      where: { id: l.id },
      data: { events: [...events, ...add] as never, ...(done ? { status: "closed" } : {}) },
    });
    for (const e of add) {
      await logAudit(
        { type: "system", id: null },
        "ladder_rolled",
        { type: "bill_ladder", id: l.id },
        { term: e.term, amount_cents: e.amountCents },
      );
      rolled += 1;
    }
  }
  return rolled;
}

export async function settleAllLadders({ client = defaultClient, now = new Date() }: Options = {}) {
  const people = await client.billLadder.findMany({
    where: { status: "active" },
    select: { userId: true },
    distinct: ["userId"],
    take: 500,
  });
  let rolled = 0;
  for (const { userId } of people) rolled += await settleLadders(userId, { client, now });
  return { people: people.length, rolled };
}
