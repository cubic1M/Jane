import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));

import { loadHousehold } from "./household";

// Gate C's calendar sweep (src/sweep/), 11-15: the household's look backs (rent, pay, trips, care,
// side work) counted back from the moment. For the renter sample person the renters-cover gap
// went at 7pm on Dec 30 (UTC's Dec 31), and for an upload that had stopped, the rent fell out a
// day at a time. They count the person's days back from where the data reaches.

const url = process.env.TEST_DATABASE_URL;
// Rent on the 1st, Nov 2025 to Oct 2026; the statements end Oct 24.
const RENT_DAYS = Array.from({ length: 12 }, (_, i) =>
  new Date(Date.UTC(2025, 10 + i, 1)).toISOString().slice(0, 10),
);
// 3pm and 7pm on Dec 30 in Los Angeles (7pm is Dec 31 in UTC), and 3pm on Dec 31.
const MOMENTS = ["2026-12-30T23:00:00Z", "2026-12-31T03:00:00Z", "2026-12-31T23:00:00Z"];

describe.runIf(url)("the household on the person's own calendar", () => {
  let client: PrismaClient;
  let userId = "";
  beforeAll(async () => {
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url! }) });
    const user = await client.user.create({
      data: {
        email: `household-day-${crypto.randomUUID()}@example.com`,
        timezone: "America/Los_Angeles",
      },
    });
    userId = user.id;
    const account = await client.account.create({
      data: { userId, source: "csv", name: "Checking", type: "depository" },
    });
    const line = (date: string, description: string, amountCents: number, pfc?: string) => ({
      userId,
      accountId: account.id,
      source: "csv" as const,
      date: new Date(`${date}T00:00:00Z`),
      description,
      amountCents,
      ...(pfc ? { pfcDetailed: pfc } : {}),
    });
    await client.transaction.createMany({
      data: [
        ...RENT_DAYS.map((d) =>
          line(d, "OAKWOOD APARTMENTS RENT", 180_000, "RENT_AND_UTILITIES_RENT"),
        ),
        line("2026-10-24", "TRADER JOES", 6_120),
      ],
    });
  });
  afterAll(async () => {
    await client.user.deleteMany({ where: { id: userId } });
    await client.$disconnect();
  });

  it("still sees the rent at 3pm and 7pm on Dec 30 and on Dec 31", async () => {
    for (const at of MOMENTS) {
      const household = await loadHousehold(userId, { client, now: new Date(at) });
      expect(household.housing.value, at).toBe("rent");
    }
  });
});
