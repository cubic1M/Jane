import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));

import { loadFiling } from "@/lib/filing-status";

// The tax profile row's updatedAt moves with every field (a state, a pay stub), so it says nothing
// about when the person last answered how they file: the audit log's "tax_profile_changed" does.
const url = process.env.TEST_DATABASE_URL;

describe.runIf(url)("when the tax profile's filing status was answered", () => {
  let client: PrismaClient;
  let id: string;

  beforeAll(async () => {
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url! }) });
    id = (
      await client.user.create({
        data: { email: `filing-audit-${crypto.randomUUID()}@example.com` },
      })
    ).id;
  });
  afterAll(async () => {
    await client.auditLog.deleteMany({ where: { targetId: id } });
    await client.user.delete({ where: { id } }).catch(() => {});
    await client.$disconnect();
  });

  it("reads the save that named it, not a later save of the state", async () => {
    // Profile said married filing jointly on Sep 1; the card said single on Oct 1; the state was
    // saved on Nov 1, which moved the row's updatedAt past the card's answer.
    await client.taxProfile.create({
      data: {
        userId: id,
        filingStatus: "married_joint",
        state: "CA",
        answered: ["filingStatus", "state"],
        updatedAt: new Date("2026-11-01T12:00:00Z"),
      },
    });
    const log = (fields: string, createdAt: string) =>
      client.auditLog.create({
        data: {
          actorType: "user",
          actorId: id,
          event: "tax_profile_changed",
          targetType: "user",
          targetId: id,
          metadata: { fields, via: "page" },
          createdAt: new Date(createdAt),
        },
      });
    await log("filingStatus", "2026-09-01T12:00:00Z");
    await log("state", "2026-11-01T12:00:00Z");
    await client.janePreference.create({
      data: {
        userId: id,
        kind: "fact",
        key: "profile:filing_status",
        value: { value: "single" },
        label: "How you file taxes: single",
        createdAt: new Date("2026-10-01T12:00:00Z"),
      },
    });
    const { read, stored } = await loadFiling(id, { client });
    expect(stored?.at?.toISOString()).toBe("2026-09-01T12:00:00.000Z");
    expect(read).toMatchObject({ status: "single", source: "told", replaced: "married_joint" });
  });
});
