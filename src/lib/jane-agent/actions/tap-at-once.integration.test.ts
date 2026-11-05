import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
// The audit row goes through the app's own client, which a test run with no DATABASE_URL lacks.
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn(), SYSTEM_ACTOR: { type: "system", id: null } }));

import { takeChatAction } from ".";

// A button's handler runs before its message is marked answered, so 20 taps at once ran it 20 times.
// goal.start has no unique key behind it, so each run makes a savings goal. Against a real Postgres.

const url = process.env.TEST_DATABASE_URL;

describe.runIf(url)("one button tapped many times at once", { timeout: 60_000 }, () => {
  let client: PrismaClient;
  let userId: string;

  beforeAll(async () => {
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url! }) });
    userId = (
      await client.user.create({ data: { email: `tap-${crypto.randomUUID()}@example.com` } })
    ).id;
  });
  afterAll(async () => {
    await client.user.deleteMany({ where: { id: userId } });
    await client.$disconnect();
  });

  it("runs its handler once", async () => {
    const message = await client.janeMessage.create({
      data: {
        userId,
        kind: "reply",
        dedupeKey: `tap-${crypto.randomUUID()}`,
        body: "You can afford it by March.",
        status: "open",
        actions: [{ id: "goal.start", label: "Start a goal", kind: "primary" }],
        refs: { goal: { name: "Trip", targetCents: 90_000, targetDate: "2031-03-01" } },
      },
    });
    const results = await Promise.allSettled(
      Array.from({ length: 20 }, () =>
        takeChatAction(userId, message.id, "goal.start", { client }),
      ),
    );
    // Each tap's outcome by name, so a failure says why.
    const outcomes = results.map((r) =>
      r.status === "fulfilled" ? "ran" : ((r.reason as { code?: string }).code ?? String(r.reason)),
    );
    expect(outcomes.toSorted()).toEqual([...Array.from({ length: 19 }, () => "not_open"), "ran"]);
    expect(await client.savingsGoal.count({ where: { userId } })).toBe(1);
  });
});
