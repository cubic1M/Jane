import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));

import { alertsThatHold } from "./still-true";

// Weekly email QA 10-30: a reminder "Avalon Bay Rent, about $1,725.00, due Nov 1", raised on
// Oct 30, still held on Nov 2 (and went out in that Monday's email). A dated alert holds until
// the end of its day, the person's day.

const url = process.env.TEST_DATABASE_URL;

describe.runIf(url)("dated alerts", () => {
  let client: PrismaClient;
  let userId: string;
  const rows = [
    { type: "bill_due", key: "Avalon Bay Rent:2026-11-01", title: "Rent due Nov 1" },
    { type: "renews_soon", key: "stream:costco:2026-11-03", title: "Costco renews Nov 3" },
    { type: "fee_charged", key: "tx-1", title: "A $35 overdraft fee" },
  ] as const;

  beforeAll(async () => {
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
    const user = await client.user.create({
      data: { email: `dated-${crypto.randomUUID()}@example.com`, timezone: "America/Los_Angeles" },
    });
    userId = user.id;
    await client.alert.createMany({
      data: rows.map((r) => ({
        ...r,
        userId,
        body: "",
        createdAt: new Date("2026-10-30T20:00:00Z"),
      })),
    });
  });
  afterAll(async () => {
    await client.user.deleteMany({ where: { id: userId } });
    await client.$disconnect();
  });

  const holdOn = async (now: string) => {
    const alerts = await client.alert.findMany({
      where: { userId },
      select: { id: true, type: true, key: true, title: true },
    });
    return (await alertsThatHold(userId, alerts, { client, now: new Date(now) }))
      .map((a) => a.title)
      .sort();
  };

  it("hold through their day, in the person's timezone", async () => {
    // 9pm Nov 1 in Los Angeles is Nov 2 in UTC: the rent is still due today.
    expect(await holdOn("2026-11-02T04:00:00Z")).toEqual([
      "A $35 overdraft fee",
      "Costco renews Nov 3",
      "Rent due Nov 1",
    ]);
  });

  it("are put away once the day has passed; an event that happened stays", async () => {
    expect(await holdOn("2026-11-02T17:00:00Z")).toEqual([
      "A $35 overdraft fee",
      "Costco renews Nov 3",
    ]);
    expect(await holdOn("2026-11-04T17:00:00Z")).toEqual(["A $35 overdraft fee"]);
  });
});
