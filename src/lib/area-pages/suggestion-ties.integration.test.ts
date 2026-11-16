import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn(), SYSTEM_ACTOR: { type: "system", id: null } }));

import { stubTestKeys } from "@/lib/__fixtures__/env";
import { loadMoneyArea } from "./money-load";

// Gate C's calendar sweep (src/sweep/), 11-16: an area's suggestions were ordered by score alone.
// Scores are whole numbers and tie often, and a tie came back in the index's order, which
// follows the status ("selected" before "waiting"), so two ideas on the same tree swapped places
// when today's pick changed, overnight or at 4pm. Ties go by key.

const url = process.env.TEST_DATABASE_URL;
const NOW = new Date("2026-11-16T23:00:00Z");

describe.runIf(url)("an area's suggestions with the same score", { timeout: 120_000 }, () => {
  let client: PrismaClient;
  let userId: string;
  beforeAll(async () => {
    stubTestKeys();
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url! }) });
    await client.user.deleteMany({ where: { email: "suggestion-ties@example.test" } });
    userId = (
      await client.user.create({
        data: { email: "suggestion-ties@example.test", timezone: "America/Los_Angeles" },
      })
    ).id;
  });
  afterAll(async () => {
    await client.user.deleteMany({ where: { id: userId } });
    await client.$disconnect();
    vi.unstubAllEnvs();
  });

  const suggestion = (key: string, status: string) =>
    client.suggestion.create({
      data: {
        userId,
        key,
        status,
        score: 40,
        capability: "subscriptions",
        topic: key,
        title: key,
        short: key,
        worthCents: 1_000,
        worthKind: "yearly",
        confidencePercent: 80,
        confidenceReason: "test",
        urgency: "low",
        why: "test",
        actionLabel: "Look",
        actionHref: "/money",
      },
    });

  it("keeps the same order whichever is today's pick", async () => {
    // Today's pick is written first, so both the table's and the index's order put it first.
    await suggestion("b-second", "selected");
    await suggestion("a-first", "waiting");
    const topics = async () =>
      (await loadMoneyArea(userId, { client, now: NOW }))!.suggestions.map((s) => s.topic);
    expect(await topics()).toEqual(["a-first", "b-second"]);
    await client.suggestion.updateMany({ where: { userId }, data: { status: "waiting" } });
    await client.suggestion.updateMany({
      where: { userId, key: "a-first" },
      data: { status: "selected" },
    });
    expect(await topics()).toEqual(["a-first", "b-second"]);
  });
});
