import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));

import { loadAuditRecords } from "@/lib/audit-records";
import { loadTaxEstimate } from "@/lib/tax-estimate";

const url = process.env.TEST_DATABASE_URL;
const NOW = new Date("2026-10-18T15:00:00Z");

// Gifts in the audit pack claim what the estimate counts: under the standard deduction that is
// the estimate's own cash-gift figure, never the whole of what was given.
describe.runIf(url)("gifts in a person's audit pack", () => {
  let client: PrismaClient;
  const created: string[] = [];

  beforeAll(() => {
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
  });
  afterAll(async () => {
    await client.user.deleteMany({ where: { id: { in: created } } });
    await client.$disconnect();
  });

  it("claims what the estimate counts under the standard deduction, and says it is larger", async () => {
    const user = await client.user.create({
      data: { email: `records-gift-${crypto.randomUUID()}@example.com`, timezone: "UTC" },
    });
    created.push(user.id);
    const account = await client.account.create({
      data: { userId: user.id, name: "Checking", type: "depository", source: "csv" },
    });
    await client.transaction.create({
      data: {
        userId: user.id,
        accountId: account.id,
        source: "csv",
        dedupeKey: crypto.randomUUID(),
        date: new Date("2026-03-02T00:00:00Z"),
        amountCents: 120_000,
        description: "RED CROSS",
        merchantName: "Red Cross",
        pfcDetailed: "GOVERNMENT_AND_NON_PROFIT_DONATIONS",
      },
    });
    const { estimate } = await loadTaxEstimate(user.id, { client, now: NOW, year: 2026 });
    expect(estimate.deduction.kind).toBe("standard");

    const pack = await loadAuditRecords(user.id, 2026, { client, now: NOW });

    const gifts = pack.items.find((i) => i.key === "charity")!;
    expect(gifts.claimedCents).toBe(estimate.deduction.nonItemizerCharityCents);
    expect(gifts.claimedCents).toBeLessThan(120_000 + 1);
    expect(gifts.gross).toMatchObject({ cents: 120_000 });
    expect(gifts.gross!.label).toContain("the standard deduction is larger");
  });
});
