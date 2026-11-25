import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";
import { db as appDb } from "@/lib/db";

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
vi.mock("@/lib/insurance/health-year", async (original) => {
  const actual = await original<typeof import("@/lib/insurance/health-year")>();
  return { ...actual, loadHealthYear: vi.fn(actual.loadHealthYear) };
});
vi.mock("@/lib/insurance/family", async (original) => {
  const actual = await original<typeof import("@/lib/insurance/family")>();
  return { ...actual, loadFamily: vi.fn(actual.loadFamily) };
});

import { stubTestKeys } from "@/lib/__fixtures__/env";
import { loadFamily } from "@/lib/insurance/family";
import { loadHealthYear } from "@/lib/insurance/health-year";
import { loadInsuranceArea } from "./insurance-load";

// CodeRabbit sweep 1c, area-01: the Insurance page took its date from `now`, but the health year
// and the household were read on the wall clock. On Dec 31 (Los Angeles) with the clock past New
// Year in UTC, the health year was a different year from the page's own day.

const url = process.env.TEST_DATABASE_URL;
const NOW = new Date("2026-12-31T23:00:00Z");

describe.runIf(url)("the Insurance page's loaders", { timeout: 120_000 }, () => {
  let client: PrismaClient;
  let userId: string;
  beforeAll(async () => {
    stubTestKeys();
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url! }) });
    userId = (
      await client.user.create({
        data: { email: "insurance-load-now@example.test", timezone: "America/Los_Angeles" },
      })
    ).id;
  });
  afterAll(async () => {
    await client.user.deleteMany({ where: { id: userId } });
    await client.$disconnect();
    await appDb.$disconnect();
    vi.unstubAllEnvs();
  });

  it("read the health year and the household on the page's own clock", async () => {
    const page = await loadInsuranceArea(userId, { now: NOW });
    expect(page.asOf).toBe("2026-12-31");
    for (const loader of [loadHealthYear, loadFamily]) {
      const options = vi.mocked(loader).mock.calls.at(-1)![1] as { now?: Date };
      expect(options?.now).toBe(NOW);
    }
  });
});
