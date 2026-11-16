import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));

import { loadDetectionInput } from "@/detection/input";
import { dataReach } from "./data-reach";
import { scopedFor } from "./db-scoped";
import { loadProfileInput } from "./profile";

// Gate C's calendar sweep (src/sweep/), 11-15: the profile and detection loaded a year counted back
// from today, so an upload whose statements ended in October lost a day of history every day it
// sat. "11 gym payments in 11 months of data" became 10, pay crept up, and everything built on it
// moved with nothing new in the data. Once the data is old the year counts back from where it
// reaches, and two days later it's the same history.

const url = process.env.TEST_DATABASE_URL;
// Gym on the 2nd of every month, Dec 2025 to Oct 2026; the statements end Oct 24.
const GYM = Array.from({ length: 11 }, (_, i) => {
  const month = new Date(Date.UTC(2025, 11 + i, 2));
  return month.toISOString().slice(0, 10);
});
// 3pm on Dec 10 and on Dec 12 in Los Angeles: well past the data's end.
const DEC_10 = new Date("2026-12-10T23:00:00Z");
const DEC_12 = new Date("2026-12-12T23:00:00Z");

describe.runIf(url)("a year of data counted back from where it reaches", () => {
  let client: PrismaClient;
  let userId = "";
  beforeAll(async () => {
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url! }) });
    const user = await client.user.create({
      data: {
        email: `data-reach-${crypto.randomUUID()}@example.com`,
        timezone: "America/Los_Angeles",
      },
    });
    userId = user.id;
    const account = await client.account.create({
      data: { userId, source: "csv", name: "Checking", type: "depository" },
    });
    const line = (date: string, description: string, amountCents: number) => ({
      userId,
      accountId: account.id,
      date: new Date(`${date}T00:00:00Z`),
      description,
      amountCents,
      source: "csv" as const,
    });
    await client.transaction.createMany({
      data: [
        ...GYM.map((d) => line(d, "PLANET FITNESS", 2_499)),
        line("2026-10-24", "TRADER JOES", 6_120),
      ],
    });
  });
  afterAll(async () => {
    await client.user.deleteMany({ where: { id: userId } });
    await client.$disconnect();
  });

  it("reaches a week past an old upload's newest line, and today for current data", async () => {
    const db = scopedFor(userId, client);
    expect(await dataReach(db, "2026-12-10")).toBe("2026-10-31");
    expect(await dataReach(db, "2026-11-20")).toBe("2026-11-20");
  });

  it("keeps the same history on Dec 12 as on Dec 10", async () => {
    const profileDays = async (now: Date) =>
      (await loadProfileInput(userId, { client, now })).transactions.map((t) => t.date).sort();
    const detectionDays = async (now: Date) =>
      (await loadDetectionInput(userId, { client, now })).transactions.map((t) => t.date).sort();
    const profile = await profileDays(DEC_10);
    expect(profile).toContain("2025-12-02");
    expect(await profileDays(DEC_12)).toEqual(profile);
    const detection = await detectionDays(DEC_10);
    expect(detection).toContain("2025-12-02");
    expect(await detectionDays(DEC_12)).toEqual(detection);
  });
});
