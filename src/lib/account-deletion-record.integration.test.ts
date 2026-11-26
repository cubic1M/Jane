import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn(), SYSTEM_ACTOR: { type: "system", id: null } }));

import { logAudit } from "@/lib/audit";
import { deleteAllData } from "./account-deletion";

// Runs against a real, migrated Postgres (see src/detection/engine.integration.test.ts).
const url = process.env.TEST_DATABASE_URL;

describe.runIf(url)("deleting an account and its record", () => {
  let client: PrismaClient;
  const created: string[] = [];

  beforeAll(() => {
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
  });
  afterAll(async () => {
    await client.user.deleteMany({ where: { id: { in: created } } });
    await client.$disconnect();
  });

  // Gone with no record of it, and nothing to try again.
  it("deletes nothing when the deletion can't be recorded", async () => {
    const user = await client.user.create({
      data: { email: `unrecorded-${crypto.randomUUID()}@example.com` },
    });
    created.push(user.id);
    vi.mocked(logAudit).mockRejectedValueOnce(new Error("audit log down"));
    await expect(deleteAllData(user.id, { client })).rejects.toThrow("audit log down");
    expect(await client.user.count({ where: { id: user.id } })).toBe(1);
    await deleteAllData(user.id, { client });
    expect(await client.user.count({ where: { id: user.id } })).toBe(0);
  });
});
