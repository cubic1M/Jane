import {
  MAX_PROJECTION_YEARS,
  PLANNED_EVENT_KINDS,
  type PlannedEventKind,
} from "@/config/tax-years";
import { DEADLINE_MAX_YEARS_AHEAD } from "@/config/deadlines";
import type { PrismaClient } from "@/generated/prisma/client";
import { adviceMode } from "@/lib/advice-mode";
import { track } from "@/lib/analytics";
import { logAudit } from "@/lib/audit";
import { RETIREMENT_AGE } from "@/config/retirement";
import { db as defaultClient } from "@/lib/db";
import { profileOf } from "@/lib/investments/profile";
import { currentAge } from "@/planning/investor-profile";
import { scopedFor } from "@/lib/db-scoped";
import { addDeadline } from "@/lib/deadlines";
import { loadInvestmentTaxes } from "@/lib/investment-taxes";
import { loadTaxEstimate, type TaxEstimateView } from "@/lib/tax-estimate";
import {
  findMoves,
  lifetimeTax,
  project,
  retireYearOf,
  type Move,
  type Plan,
  type YearTax,
} from "@/planning/multi-year";
import { isoDay as iso } from "@/lib/dates";

// Tax moves over several years (spec step 220), loaded from the person's own plan: the
// year's estimate (step 120), the pay and the retirement accounts Jane sees, what they told
// it about retiring and the bonuses and sales they plan. The moves are demo advice: shown
// only where adviceMode is on, each with what it saves over all the years, and "put it on
// my plan" adds a deadline for the person (or the investing side, once there is one) to
// carry out. Jane moves no money.

type Options = { client?: PrismaClient; now?: Date };

export class MultiYearError extends Error {}

// Plaid subtypes of accounts taxed when money comes out (employer plans and traditional
// IRAs); Roth accounts aren't in it.
const TRADITIONAL_SUBTYPES: readonly string[] = [
  "401a",
  "401k",
  "403b",
  "457b",
  "ira",
  "sep ira",
  "simple ira",
  "thrift savings plan",
  "profit sharing plan",
  "keogh",
];

export type MultiYearView = {
  year: number;
  advice: boolean;
  retireYear: number;
  retireAssumed: boolean;
  traditionalCents: number;
  unrealisedLongTermCents: number;
  events: { id: string; kind: PlannedEventKind; year: number; amountCents: number }[];
  rows: YearTax[];
  lifetimeTaxCents: number;
  // Moves worth making that aren't already on the person's deadlines; empty unless advice.
  moves: Move[];
  handled: string[];
  assumptions: string[];
};

export async function loadMultiYear(
  userId: string,
  {
    client = defaultClient,
    now = new Date(),
    loaded,
  }: Options & { loaded?: { estimate: TaxEstimateView; advice: boolean } } = {},
): Promise<MultiYearView> {
  const estimate = loaded?.estimate ?? (await loadTaxEstimate(userId, { client, now }));
  const year = estimate.year;
  const db = scopedFor(userId, client);
  const [advice, accounts, investments, profile, events, answers] = await Promise.all([
    loaded ? loaded.advice : adviceMode(userId, { client }),
    db.accounts.findMany({
      where: { type: "investment" },
      select: { subtype: true, currentBalanceCents: true },
    }),
    loadInvestmentTaxes(userId, year, { client, now }),
    db.taxProfiles.findFirst({ select: { retireYear: true, multiYearHandled: true } }),
    db.taxPlanEvents.findMany({ orderBy: [{ year: "asc" }, { createdAt: "asc" }, { id: "asc" }] }),
    profileOf(userId, { client }),
  ]);
  // Not told when they'll retire: at RETIREMENT_AGE from the age on their investor profile, as
  // the long view assumes (docs/feature-audit.md, cluster 12); without an age, the default.
  const age = currentAge(answers, now.toISOString().slice(0, 10));
  const assumedRetireYear = age === null ? null : year + Math.max(0, RETIREMENT_AGE - age);
  const traditionalCents = accounts
    .filter((a) => TRADITIONAL_SUBTYPES.includes(a.subtype ?? ""))
    .reduce((s, a) => s + (a.currentBalanceCents ?? 0), 0);
  const plan: Plan = {
    startYear: year,
    base: estimate.input,
    retireYear: profile?.retireYear ?? assumedRetireYear,
    traditionalCents,
    unrealisedLongTermCents: Math.max(0, investments.unrealisedCents.longTerm),
    events: events.map((e) => ({
      id: e.id,
      kind: e.kind as PlannedEventKind,
      year: e.year,
      amountCents: e.amountCents,
    })),
  };
  const rows = project(plan);
  const handled = profile?.multiYearHandled ?? [];
  const moves = advice ? findMoves(plan, rows).filter((m) => !handled.includes(m.key)) : [];
  const retireYear = retireYearOf(plan);
  return {
    year,
    advice,
    retireYear,
    retireAssumed: profile?.retireYear == null,
    traditionalCents,
    unrealisedLongTermCents: plan.unrealisedLongTermCents,
    events: plan.events,
    rows,
    lifetimeTaxCents: lifetimeTax(rows),
    moves,
    handled,
    assumptions: [
      `Federal tax only. ${year}'s figures are your estimate; later years use ${year}'s brackets raised each year for inflation, which is an assumption.`,
      profile?.retireYear == null
        ? `You haven't told me when you plan to retire, so I assumed ${retireYear}.`
        : `You plan to retire in ${retireYear}.`,
      "Pay grows with raises until then, and a traditional retirement account is taken out evenly over 20 years from then.",
    ],
  };
}

export async function setRetireYear(
  userId: string,
  retireYear: number | null,
  { client = defaultClient, now = new Date(), via }: Options & { via: "chat" | "page" },
): Promise<void> {
  const thisYear = now.getUTCFullYear();
  if (
    retireYear !== null &&
    (!Number.isInteger(retireYear) ||
      retireYear < thisYear ||
      retireYear > thisYear + MAX_PROJECTION_YEARS - 1)
  ) {
    throw new MultiYearError(
      `Give a year from ${thisYear} to ${thisYear + MAX_PROJECTION_YEARS - 1}.`,
    );
  }
  await scopedFor(userId, client).taxProfiles.upsert({
    where: { userId },
    create: { userId, retireYear },
    update: { retireYear },
  });
  await logAudit(
    { type: "user", id: userId },
    "tax_profile_changed",
    { type: "user", id: userId },
    { fields: "retire_year", via },
  );
  await track(userId, "tax_profile_answered", { fields: "retire_year", via });
}

const MAX_EVENTS = 10;
const isKind = (k: string): k is PlannedEventKind => Object.hasOwn(PLANNED_EVENT_KINDS, k);

export async function addPlanEvent(
  userId: string,
  input: { kind: string; year: number; amountCents: number },
  { client = defaultClient, now = new Date(), via }: Options & { via: "chat" | "page" },
): Promise<void> {
  const thisYear = now.getUTCFullYear();
  if (!isKind(input.kind)) throw new MultiYearError("Pick a bonus, a sale or a withdrawal.");
  if (!Number.isInteger(input.year) || input.year < thisYear || input.year > thisYear + 30) {
    throw new MultiYearError(`Give a year from ${thisYear} to ${thisYear + 30}.`);
  }
  if (!Number.isInteger(input.amountCents) || input.amountCents <= 0) {
    throw new MultiYearError("Give an amount above zero, in dollars.");
  }
  const db = scopedFor(userId, client);
  if ((await db.taxPlanEvents.count()) >= MAX_EVENTS) {
    throw new MultiYearError("That's enough planned events for now; remove one first.");
  }
  await db.taxPlanEvents.create({
    data: { userId, kind: input.kind, year: input.year, amountCents: input.amountCents },
  });
  await track(userId, "tax_plan_event_added", { kind: input.kind, via });
}

export async function removePlanEvent(
  userId: string,
  id: string,
  { client = defaultClient }: Options = {},
): Promise<void> {
  const { count } = await scopedFor(userId, client).taxPlanEvents.deleteMany({ where: { id } });
  if (count === 0) throw new MultiYearError("That planned event isn't on your list.");
}

// "Put it on my plan": a deadline for the move, in the year it is for. Demo advice, so only
// where advice is on; Jane doesn't convert, sell or give anything itself.
export async function putMoveOnPlan(
  userId: string,
  key: string,
  {
    client = defaultClient,
    now = new Date(),
    via,
  }: Options & { via: "chat" | "page" | "autopilot" },
): Promise<Move> {
  const view = await loadMultiYear(userId, { client, now });
  if (!view.advice) {
    throw new MultiYearError("Moves like this come once Jane works with a tax professional.");
  }
  const move = view.moves.find((m) => m.key === key);
  if (!move) throw new MultiYearError("That move isn't on your list any more.");
  const today = iso(now);
  const december = `${move.year}-12-01`;
  // Deadlines only go so far ahead; a move for a later year is reminded as far ahead as they
  // go, and its title says the year.
  const latest = `${now.getUTCFullYear() + DEADLINE_MAX_YEARS_AHEAD - 1}-12-01`;
  const dueOn = december < today ? today : december > latest ? latest : december;
  await addDeadline(
    userId,
    {
      title: move.title,
      dueOn,
      kind: "other",
      note: `${move.why} Saves about ${Math.round(move.effectCents / 100).toLocaleString("en-US")} dollars of tax over the years. Jane moves no money; this one is yours (or your adviser's) to carry out.`,
    },
    { client, now },
  );
  const db = scopedFor(userId, client);
  const multiYearHandled = [...new Set([...view.handled, key])];
  await db.taxProfiles.upsert({
    where: { userId },
    create: { userId, multiYearHandled },
    update: { multiYearHandled },
  });
  await track(userId, "multi_year_move_planned", { kind: move.kind, via });
  return move;
}
