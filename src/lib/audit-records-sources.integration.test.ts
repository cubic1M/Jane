import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn(), SYSTEM_ACTOR: { type: "system", id: null } }));

import { loadAuditRecords, remindRetention } from "@/lib/audit-records";

// Runs against a real, migrated Postgres (see src/detection/engine.integration.test.ts).
const url = process.env.TEST_DATABASE_URL;
const NOW = new Date("2026-10-18T15:00:00Z");

describe.runIf(url)("audit records and their sources", () => {
  let client: PrismaClient;
  const created: string[] = [];

  // A person with a checking account and one old charge, so 2022 is on their list.
  async function person(timezone = "UTC") {
    const user = await client.user.create({
      data: { email: `records-${crypto.randomUUID()}@example.com`, timezone },
    });
    created.push(user.id);
    const account = await client.account.create({
      data: { userId: user.id, name: "Checking", type: "depository", source: "csv" },
    });
    await spend(user.id, account.id, "2022-06-01", 1_000, "OLD CHARGE");
    return { userId: user.id, accountId: account.id };
  }
  async function spend(
    userId: string,
    accountId: string,
    date: string,
    amountCents: number,
    payee: string,
    pfcDetailed = "GENERAL_MERCHANDISE_OTHER_GENERAL_MERCHANDISE",
  ) {
    return client.transaction.create({
      data: {
        userId,
        accountId,
        source: "csv",
        dedupeKey: crypto.randomUUID(),
        date: new Date(`${date}T00:00:00Z`),
        amountCents,
        description: payee.toUpperCase(),
        merchantName: payee,
        pfcDetailed,
      },
    });
  }
  const gift = (userId: string, accountId: string, date: string, payee: string) =>
    spend(userId, accountId, date, 30_000, payee, "GOVERNMENT_AND_NON_PROFIT_DONATIONS");
  const dueOn = async (userId: string) =>
    (await client.deadline.findFirstOrThrow({ where: { userId } })).dueOn
      .toISOString()
      .slice(0, 10);

  beforeAll(() => {
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
  });
  afterAll(async () => {
    await client.user.deleteMany({ where: { id: { in: created } } });
    await client.$disconnect();
  });

  it("sets a reminder asked for early on the day it was promised", async () => {
    const { userId } = await person();
    // 2022's records can go after 2026-04-15, with a reminder from 30 days before.
    await remindRetention(userId, 2022, {
      client,
      now: new Date("2026-03-01T12:00:00Z"),
      via: "page",
    });
    expect(await dueOn(userId)).toBe("2026-03-16");
  });

  it("dates a reminder by the person's own day", async () => {
    const { userId } = await person("Pacific/Auckland");
    // 20:00 UTC on May 1 is already May 2 in Auckland.
    await remindRetention(userId, 2022, {
      client,
      now: new Date("2026-05-01T20:00:00Z"),
      via: "page",
    });
    expect(await dueOn(userId)).toBe("2026-05-02");
  });

  it("doesn't let one receipt stand for two gifts", async () => {
    const { userId, accountId } = await person();
    await gift(userId, accountId, "2026-09-12", "First Charity");
    await gift(userId, accountId, "2026-09-12", "Second Charity");
    await client.document.create({
      data: {
        userId,
        kind: "receipt",
        fileName: "receipt.pdf",
        contentType: "application/pdf",
        sizeBytes: 3,
        encryptedBytes: Buffer.from("abc"),
        purchaseDate: new Date("2026-09-13T00:00:00Z"),
        purchaseAmountCents: 30_000,
      },
    });
    const pack = await loadAuditRecords(userId, 2026, { client, now: NOW });
    expect(pack.items.find((i) => i.key === "charity")!.needs).toHaveLength(2);
  });

  it("reads the receipts ticked for the year asked about, not this year's", async () => {
    const { userId, accountId } = await person();
    const last = await gift(userId, accountId, "2025-09-12", "First Charity");
    await client.taxProfile.create({ data: { userId, givingReceipts: [last.id] } });
    const pack = await loadAuditRecords(userId, 2025, { client, now: NOW });
    expect(pack.items.find((i) => i.key === "charity")!.needs).toEqual([]);
  });
});
