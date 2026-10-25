import {
  ACT_PRIOR_RATE,
  PAYOFF_PRIOR_RATE,
  PEOPLE_LINE_MIN_SHOWN,
  PRIOR_WEIGHT,
} from "@/config/suggestions";
import { TRIAL_ID_PREFIX } from "@/config/trial";
import type { PrismaClient } from "@/generated/prisma/client";
import { db as defaultClient } from "@/lib/db";
import { kindFactor, type KindStat, type KindStats } from "@/planning/suggestion-rank";

// The learning loop: per kind of suggestion, how often people act on it when it's shown and how
// often what they acted on then showed up in their transactions (the verified savings record).
// Rebuilt each night from suggestion_outcomes across everyone but trial people (sample data never
// counts, CLAUDE.md); ranking (src/planning/suggestion-rank.ts kindFactor) and the card's More
// details ("People acted on this 7 of 10 times") read it. Counts only, never a person.

type Options = { client?: PrismaClient };

// Statuses that mean the person acted on it (a yes or a Mark done), and what was checked to the end.
const ACTED = ["open", "unverifiable", "confirmed", "partial", "not_seen"];
const DECIDED = ["confirmed", "partial", "not_seen"];
const PAID_OFF = ["confirmed", "partial"];

// Each night. A do-it-yourself finding card (capability "finding") is only on the record once it
// was done, so it would read as always acted on: it isn't counted.
export async function refreshKindStats({ client = defaultClient }: Options = {}): Promise<number> {
  // A system job across everyone, counts only.
  const rows = await client.suggestionOutcome.groupBy({
    by: ["topic", "status"],
    where: {
      userId: { not: { startsWith: TRIAL_ID_PREFIX } },
      capability: { not: "finding" },
    },
    _count: { _all: true },
    _sum: { confirmedCents: true },
  });
  const byTopic = new Map<string, KindStat & { declined: number; confirmedCents: number }>();
  for (const r of rows) {
    const k = byTopic.get(r.topic) ?? {
      topic: r.topic,
      shown: 0,
      acted: 0,
      declined: 0,
      decided: 0,
      paidOff: 0,
      confirmedCents: 0,
    };
    const n = r._count._all;
    k.shown += n;
    if (ACTED.includes(r.status)) k.acted += n;
    if (r.status === "declined") k.declined += n;
    if (DECIDED.includes(r.status)) k.decided += n;
    if (PAID_OFF.includes(r.status)) {
      k.paidOff += n;
      k.confirmedCents += r._sum.confirmedCents ?? 0;
    }
    byTopic.set(r.topic, k);
  }
  for (const k of byTopic.values()) {
    const data = {
      shown: k.shown,
      acted: k.acted,
      declined: k.declined,
      decided: k.decided,
      paidOff: k.paidOff,
      confirmedCents: k.confirmedCents,
    };
    await client.suggestionKindStat.upsert({
      where: { topic: k.topic },
      create: { topic: k.topic, ...data },
      update: data,
    });
  }
  await client.suggestionKindStat.deleteMany({ where: { topic: { notIn: [...byTopic.keys()] } } });
  return byTopic.size;
}

// For ranking and the cards: every kind's counts, in one query.
export async function loadKindStats({ client = defaultClient }: Options = {}): Promise<KindStats> {
  const rows = await client.suggestionKindStat.findMany();
  return new Map(rows.map((r) => [r.topic, r]));
}

export type KindReportRow = {
  topic: string;
  shown: number;
  acted: number;
  declined: number;
  decided: number;
  paidOff: number;
  confirmedCents: number;
  // The rates with their priors, as ranking uses them (0 to 1).
  actRate: number;
  payoffRate: number;
  factor: number;
  // Whether the card says "People acted on this…" yet.
  saysPeople: boolean;
};

// For the admin page: each kind, most shown first.
export async function kindReport({ client = defaultClient }: Options = {}): Promise<{
  rows: KindReportRow[];
  updatedAt: Date | null;
}> {
  const rows = await client.suggestionKindStat.findMany({
    orderBy: [{ shown: "desc" }, { topic: "asc" }],
  });
  const stats: KindStats = new Map(rows.map((r) => [r.topic, r]));
  return {
    rows: rows.map((r) => ({
      topic: r.topic,
      shown: r.shown,
      acted: r.acted,
      declined: r.declined,
      decided: r.decided,
      paidOff: r.paidOff,
      confirmedCents: r.confirmedCents,
      actRate: (r.acted + ACT_PRIOR_RATE * PRIOR_WEIGHT) / (r.shown + PRIOR_WEIGHT),
      payoffRate: (r.paidOff + PAYOFF_PRIOR_RATE * PRIOR_WEIGHT) / (r.decided + PRIOR_WEIGHT),
      factor: kindFactor(r.topic, stats),
      saysPeople: r.shown >= PEOPLE_LINE_MIN_SHOWN,
    })),
    updatedAt: rows.reduce<Date | null>(
      (latest, r) => (!latest || r.updatedAt > latest ? r.updatedAt : latest),
      null,
    ),
  };
}
