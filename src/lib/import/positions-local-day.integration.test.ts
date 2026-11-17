import { readFileSync } from "node:fs";
import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn() }));

import { scopedFor } from "@/lib/db-scoped";
import { importPositionsFiles } from "./positions";

// Gate C: a holdings download that doesn't say its own date (Vanguard's) is as of the person's
// day. On UTC's, a student in Los Angeles uploading at 10pm had holdings priced, and a balance
// dated, tomorrow (debug 3, 11-17).

const url = process.env.TEST_DATABASE_URL;
// 7pm on Nov 16 in Los Angeles.
const NOW = new Date("2026-11-17T03:00:00Z");

const vanguard = readFileSync(
  new URL("../../data-sources/csv/__fixtures__/positions/vanguard.csv", import.meta.url),
  "utf8",
);

describe.runIf(url)("a holdings download with no date of its own, in the evening", () => {
  let client: PrismaClient;
  let userId: string;

  beforeAll(async () => {
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url! }) });
    const user = await client.user.create({
      data: {
        email: `positions-day-${crypto.randomUUID()}@example.com`,
        timezone: "America/Los_Angeles",
      },
    });
    userId = user.id;
  });
  afterAll(async () => {
    await client.user.deleteMany({ where: { id: userId } });
    await client.$disconnect();
  });

  it("is as of the person's day, not tomorrow", async () => {
    const result = await importPositionsFiles(
      scopedFor(userId, client),
      [{ name: "vanguard.csv", text: vanguard }],
      { now: NOW },
    );
    expect(result.ok).toBe(true);
    const days = (rows: { day: Date | null }[]) => [
      ...new Set(rows.map((r) => r.day?.toISOString().slice(0, 10))),
    ];
    const holdings = await client.holding.findMany({
      where: { userId },
      select: { priceAsOf: true },
    });
    const snapshots = await client.balanceSnapshot.findMany({
      where: { userId },
      select: { date: true },
    });
    expect(days(holdings.map((h) => ({ day: h.priceAsOf })))).toEqual(["2026-11-16"]);
    expect(days(snapshots.map((s) => ({ day: s.date })))).toEqual(["2026-11-16"]);
  });
});
