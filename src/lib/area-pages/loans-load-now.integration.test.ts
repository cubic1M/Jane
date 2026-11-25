import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
// The loaders use the app's own client; here it's the test database's (as push.integration.test.ts).
vi.mock("@/lib/db", async () => {
  const { PrismaClient: Client } = await import("@/generated/prisma/client");
  const { PrismaPg: Adapter } = await import("@prisma/adapter-pg");
  return {
    db: new Client({ adapter: new Adapter({ connectionString: process.env.TEST_DATABASE_URL }) }),
  };
});
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn(), SYSTEM_ACTOR: { type: "system", id: null } }));
// The real loaders, watched: which clock each is given.
vi.mock("@/lib/debt-plan", async (original) => {
  const actual = await original<typeof import("@/lib/debt-plan")>();
  return { ...actual, loadPayoff: vi.fn(actual.loadPayoff) };
});
vi.mock("@/lib/credit", async (original) => {
  const actual = await original<typeof import("@/lib/credit")>();
  return { ...actual, loadCredit: vi.fn(actual.loadCredit) };
});
vi.mock("@/lib/debt-review", async (original) => {
  const actual = await original<typeof import("@/lib/debt-review")>();
  return { ...actual, loadDebtReview: vi.fn(actual.loadDebtReview) };
});

import { stubTestKeys } from "@/lib/__fixtures__/env";
import { loadCredit } from "@/lib/credit";
import { loadPayoff } from "@/lib/debt-plan";
import { loadDebtReview } from "@/lib/debt-review";
import { loadLoansArea } from "./loans-load";

// CodeRabbit sweep 1c, area-01: the Loans tree's debt book and BNPL read the `now` it was given,
// but the payoff, credit and review loaders read the wall clock, so the debt-free month and the
// review could be worked out from another day than the tree's own.

const url = process.env.TEST_DATABASE_URL;
const NOW = new Date("2026-12-31T23:00:00Z");

describe.runIf(url)("the Loans tree's loaders", { timeout: 120_000 }, () => {
  let client: PrismaClient;
  let userId: string;
  beforeAll(async () => {
    stubTestKeys();
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url! }) });
    userId = (
      await client.user.create({
        data: { email: "loans-load-now@example.test", timezone: "America/Los_Angeles" },
      })
    ).id;
  });
  afterAll(async () => {
    await client.user.deleteMany({ where: { id: userId } });
    await client.$disconnect();
    vi.unstubAllEnvs();
  });

  it("are all given the tree's own clock", async () => {
    await loadLoansArea(userId, { now: NOW });
    for (const loader of [loadPayoff, loadCredit, loadDebtReview]) {
      const options = vi.mocked(loader).mock.calls.at(-1)![1] as { now?: Date; book?: unknown };
      expect(options.now).toBe(NOW);
      expect(options.book).toBeDefined();
    }
  });
});
