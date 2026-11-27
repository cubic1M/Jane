import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));

import { loadAuditRecords } from "@/lib/audit-records";
import { loadTaxEstimate } from "@/lib/tax-estimate";
import { recordsReply } from "@/lib/jane-agent/audit-records-message";

const url = process.env.TEST_DATABASE_URL;
const NOW = new Date("2026-10-18T15:00:00Z");

describe.runIf(url)("medical costs in a person's audit pack", () => {
  let client: PrismaClient;
  const created: string[] = [];

  async function paid(amountCents: number) {
    const user = await client.user.create({
      data: { email: `records-med-${crypto.randomUUID()}@example.com`, timezone: "UTC" },
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
        amountCents,
        description: "LAKESIDE CLINIC",
        merchantName: "Lakeside Clinic",
        pfcDetailed: "MEDICAL_PRIMARY_CARE",
      },
    });
    return user.id;
  }

  beforeAll(() => {
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
  });
  afterAll(async () => {
    await client.user.deleteMany({ where: { id: { in: created } } });
    await client.$disconnect();
  });

  it.each([
    ["under the standard deduction", 200_000, "standard"],
    ["over it", 3_000_000, "itemized"],
  ] as const)("claims what the estimate counts, %s", async (_, cents, kind) => {
    const userId = await paid(cents);
    const { estimate } = await loadTaxEstimate(userId, { client, now: NOW, year: 2026 });
    expect(estimate.deduction.kind).toBe(kind);

    const pack = await loadAuditRecords(userId, 2026, { client, now: NOW });

    const item = pack.items.find((i) => i.key === "medical")!;
    expect(item.claimedCents).toBe(
      kind === "standard" ? 0 : estimate.deduction.itemized.medicalCents,
    );
    expect(item.gross?.cents).toBe(cents);
    const said = recordsReply(pack).body;
    expect(said).toContain("Medical: claimed ");
    expect(said).toContain(item.gross!.label);
  });
});
