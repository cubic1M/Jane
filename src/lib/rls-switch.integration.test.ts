import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";
import { scopedFor } from "./db-scoped";
import { resetRlsForTests, rlsStatus, systemRoleStatus } from "./rls";
import { systemDb } from "./system-db";

// A query's error can repeat what a person sent. On a local production build, a sample person
// sending { 'role "jane_rls"': 1 } as an id through a server action turned row-level security off
// for the whole process: Prisma's "Unknown argument" error named the role.

const url = process.env.TEST_DATABASE_URL;

describe.runIf(url)("an error that names the role", () => {
  let client: PrismaClient;
  let userId: string;

  beforeAll(async () => {
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
    userId = (
      await client.user.create({ data: { email: `rls-switch-${crypto.randomUUID()}@example.com` } })
    ).id;
  });
  beforeEach(() => {
    vi.stubEnv("RLS_REQUIRED", "");
    vi.spyOn(console, "error").mockImplementation(() => {});
    resetRlsForTests();
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    resetRlsForTests();
  });
  afterAll(async () => {
    await client.user.deleteMany({ where: { id: userId } });
    await client.$disconnect();
  });

  it("doesn't turn row-level security off when a person's own words name it", async () => {
    await expect(
      scopedFor(userId, client).importRuns.updateMany({
        where: { id: { 'role "jane_rls"': 1 } as never },
        data: { seenAt: new Date() },
      }),
    ).rejects.toThrow();
    expect(rlsStatus()).not.toBe("off");

    await scopedFor(userId, client).importRuns.count();
    expect(rlsStatus()).toBe("on");
  });

  it("doesn't turn the system's role off either", async () => {
    await expect(
      systemDb("A test sending what a person could", client).user.findFirst({
        where: { id: { 'role "jane_system"': 1 } as never },
      }),
    ).rejects.toThrow();
    expect(systemRoleStatus()).not.toBe("off");
  });
});
