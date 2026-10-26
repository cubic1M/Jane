import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn(), SYSTEM_ACTOR: { type: "system", id: null } }));

import { PEOPLE_LINE_MIN_SHOWN } from "@/config/suggestions";
import { TRIAL_ID_PREFIX } from "@/config/trial";
import { kindFactor } from "@/planning/suggestion-rank";
import { kindReport, loadKindStats, refreshKindStats } from "./learning";

// The learning loop against a real, migrated Postgres: per kind of suggestion, how often people
// act on it and how often it pays off, from the verified savings record; trial people never count.

const url = process.env.TEST_DATABASE_URL;
const NOW = new Date("2026-10-20T15:00:00Z");
// Topics only this test uses, so other tests' outcomes in the same database don't mix in.
const T = `learning_test_${crypto.randomUUID().slice(0, 8)}`;
const QUIET = `${T}_quiet`;

describe.runIf(url)("the learning loop", { timeout: 120_000 }, () => {
  let client: PrismaClient;
  const created: string[] = [];
  beforeAll(() => {
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url! }) });
  });
  afterAll(async () => {
    await client.user.deleteMany({ where: { id: { in: created } } });
    await client.suggestionKindStat.deleteMany({ where: { topic: { in: [T, QUIET] } } });
    await client.$disconnect();
  });

  async function person(id?: string) {
    const user = await client.user.create({
      data: { ...(id ? { id } : {}), email: `learning-${crypto.randomUUID()}@example.com` },
    });
    created.push(user.id);
    return user.id;
  }

  async function outcome(
    userId: string,
    topic: string,
    status: string,
    over: { capability?: string; confirmedCents?: number } = {},
  ) {
    await client.suggestionOutcome.create({
      data: {
        userId,
        suggestionKey: `x:${topic}:${crypto.randomUUID()}`,
        capability: over.capability ?? "subscriptions",
        topic,
        title: "t",
        firstShownAt: NOW,
        lastShownAt: NOW,
        expectedCents: 10_000,
        worthKind: "saves",
        confidencePercent: 80,
        status,
        confirmedCents: over.confirmedCents ?? null,
      },
    });
  }

  it("counts shown, acted, declined, checked and paid off per kind, never trial people", async () => {
    const people = await Promise.all(Array.from({ length: 12 }, () => person()));
    // 12 shown: 7 acted on (4 confirmed, 1 partial, 1 not seen, 1 still open), 3 said no, 2 left.
    const statuses = [
      "confirmed",
      "confirmed",
      "confirmed",
      "confirmed",
      "partial",
      "not_seen",
      "open",
      "declined",
      "declined",
      "declined",
      "shown",
      "shown",
    ];
    for (const [i, status] of statuses.entries()) {
      await outcome(people[i], T, status, {
        confirmedCents: status === "confirmed" ? 12_000 : status === "partial" ? 5_000 : undefined,
      });
    }
    // A trial person and a do-it-yourself finding card: not counted.
    const trial = await person(`${TRIAL_ID_PREFIX}${crypto.randomUUID().slice(0, 12)}`);
    await outcome(trial, T, "confirmed", { confirmedCents: 99_999 });
    await outcome(people[0], T, "confirmed", { capability: "finding", confirmedCents: 99_999 });
    // A kind shown too few times for its card to say anything.
    await outcome(people[1], QUIET, "declined");

    expect(await refreshKindStats({ client })).toBeGreaterThanOrEqual(2);
    const stats = await loadKindStats({ client });
    expect(stats.get(T)).toMatchObject({
      shown: 12,
      acted: 7,
      declined: 3,
      decided: 6,
      paidOff: 5,
      confirmedCents: 4 * 12_000 + 5_000,
    });

    const { rows } = await kindReport({ client });
    const row = rows.find((r) => r.topic === T)!;
    expect(row.actRate).toBeCloseTo((7 + 3) / (12 + 10));
    expect(row.payoffRate).toBeCloseTo((5 + 6) / (6 + 10));
    expect(row.factor).toBe(kindFactor(T, stats));
    expect(row.factor).toBeGreaterThan(1);
    expect(row.saysPeople).toBe(true);
    expect(rows.find((r) => r.topic === QUIET)).toMatchObject({
      shown: 1,
      saysPeople: 1 >= PEOPLE_LINE_MIN_SHOWN,
    });

    // Rebuilt from scratch each night: a kind with no outcomes left goes.
    await client.suggestionOutcome.deleteMany({ where: { topic: QUIET } });
    await refreshKindStats({ client });
    expect((await loadKindStats({ client })).has(QUIET)).toBe(false);
  });
});
