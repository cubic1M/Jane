import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));

import { remindRetention } from "@/lib/audit-records";

// One reminder for a year's records, however many times and ways it is asked for.

const url = process.env.TEST_DATABASE_URL;
// 2022's and 2021's records can both go by now.
const NOW = new Date("2026-05-01T15:00:00Z");

describe.runIf(url)("the reminder to throw records away", () => {
  let client: PrismaClient;
  const created: string[] = [];

  async function person() {
    const user = await client.user.create({
      data: { email: `reminder-${crypto.randomUUID()}@example.com`, timezone: "UTC" },
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
        date: new Date("2021-06-01T00:00:00Z"),
        amountCents: 1_000,
        description: "OLD CHARGE",
        merchantName: "Old Charge",
        pfcDetailed: "GENERAL_MERCHANDISE_OTHER_GENERAL_MERCHANDISE",
      },
    });
    return user.id;
  }
  const remind = (userId: string, year: number) =>
    remindRetention(userId, year, { client, now: NOW, via: "page" });
  const reminders = (userId: string) =>
    client.deadline.findMany({ where: { userId }, orderBy: { title: "asc" } });
  const reminded = async (userId: string) =>
    (await client.taxProfile.findUniqueOrThrow({ where: { userId } })).retentionReminded.toSorted();

  beforeAll(() => {
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
  });
  afterAll(async () => {
    await client.user.deleteMany({ where: { id: { in: created } } });
    await client.$disconnect();
  });

  it("makes one when the same year is asked for at the same moment", async () => {
    const userId = await person();
    await Promise.all([remind(userId, 2022), remind(userId, 2022), remind(userId, 2022)]);
    expect(await reminders(userId)).toHaveLength(1);
    expect(await reminded(userId)).toEqual(["2022"]);
  });

  it("hands back the one there is when asked again", async () => {
    const userId = await person();
    const first = await remind(userId, 2022);
    expect(await remind(userId, 2022)).toEqual(first);
    expect(await reminders(userId)).toHaveLength(1);
  });

  it("keeps both years when two are asked for at the same moment", async () => {
    const userId = await person();
    await Promise.all([remind(userId, 2022), remind(userId, 2021)]);
    expect(await reminders(userId)).toHaveLength(2);
    expect(await reminded(userId)).toEqual(["2021", "2022"]);
  });

  it("makes a new one once the last was marked done", async () => {
    const userId = await person();
    await remind(userId, 2022);
    await client.deadline.updateMany({ where: { userId }, data: { doneAt: NOW } });
    await remind(userId, 2022);
    expect(await reminders(userId)).toHaveLength(2);
  });
});
