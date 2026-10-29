import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
import { DAY_MS } from "@/lib/dates";
import { snapshot, loadFounderRows, type FounderRows } from "./founder-numbers";

// Runs against a real, migrated Postgres (see src/detection/engine.integration.test.ts). Other
// tests' rows share the database, so it checks this test's own people in the rows read.
const url = process.env.TEST_DATABASE_URL;

describe.runIf(url)("founder numbers against a real database", () => {
  let client: PrismaClient;
  const suffix = crypto.randomUUID().slice(0, 8);
  const now = new Date();
  const ids: string[] = [];
  let real: string;
  let trial: string;

  beforeAll(async () => {
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
    const person = async (name: string, id?: string, createdAt?: Date) => {
      const user = await client.user.create({
        data: {
          ...(id ? { id } : {}),
          email: `fnum-${name}-${suffix}@example.com`,
          ...(createdAt ? { createdAt } : {}),
        },
      });
      ids.push(user.id);
      return user.id;
    };
    real = await person("real", undefined, new Date(now.getTime() - 3 * DAY_MS));
    trial = await person("trial", `trial_fnum${suffix}`);

    await client.account.create({
      data: { userId: real, source: "csv", name: "Checking", type: "depository" },
    });
    const found = await client.finding.create({
      data: {
        userId: real,
        type: "bank_fees",
        key: "fees",
        title: "Fees",
        annualSavingsCents: 14400,
        confidence: "high",
        createdAt: new Date(now.getTime() - 3 * DAY_MS + 2 * 3.6e6),
      },
    });
    await client.suggestionOutcome.create({
      data: {
        userId: real,
        suggestionKey: `finding:${found.id}`,
        capability: "finding",
        topic: "bank_fees",
        title: "Fees",
        firstShownAt: now,
        lastShownAt: now,
        expectedCents: 14400,
        worthKind: "saves",
        confidencePercent: 0,
        status: "confirmed",
        confirmedCents: 14400,
        doneAt: new Date(now.getTime() - DAY_MS),
        verifiedAt: now,
      },
    });
    for (const userId of [real, real, trial]) {
      await client.activityEvent.create({
        data: { userId, visitId: `v-${suffix}`, kind: "page_view", path: "/home" },
      });
    }
  });

  afterAll(async () => {
    await client.user.deleteMany({ where: { id: { in: ids } } });
    await client.$disconnect();
  });

  it("reads dated rows, activity once per person per hour, and counts trial people apart", async () => {
    const rows = await loadFounderRows({ client, now: new Date(now.getTime() + 60_000) });
    expect(rows.trialPeople).toBeGreaterThanOrEqual(1);
    expect(rows.users.some((u) => u.id === trial)).toBe(false);
    expect(rows.activity.some((a) => a.userId === trial)).toBe(false);
    expect(rows.activity.filter((a) => a.userId === real)).toHaveLength(1);

    const own = <T extends { userId: string }>(list: T[]) => list.filter((r) => r.userId === real);
    const mine: FounderRows = {
      ...rows,
      users: rows.users.filter((u) => u.id === real),
      invited: [],
      accounts: own(rows.accounts),
      findings: own(rows.findings),
      decisions: own(rows.decisions),
      outcomes: own(rows.outcomes),
      activity: own(rows.activity),
    };
    expect(snapshot(mine, new Date(now.getTime() + 60_000))).toEqual({
      signedUp: 1,
      added: 1,
      withFinding: 1,
      foundMedianCents: 14400,
      foundMeanCents: 14400,
      fixesDone: 1,
      verified: { people: 1, cents: 14400 },
      weeklyActive: 1,
      medianMsToFirstFinding: 2 * 3.6e6,
    });
  });
});
