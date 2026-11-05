import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));

import { CHAT_MONTHLY_CAP_CENTS_DEFAULT } from "@/config/agent-chat";
import { reportMissedJobs } from "./health";

// A read of what's shared between people: sample people can take half of Claude's month from
// anywhere, and past the rest everyone gets answers from their data alone until the 1st. Nothing
// told the team.
const url = process.env.TEST_DATABASE_URL;
// Past every other test file's clock: the month's counter is shared.
const NOW = new Date("2037-03-15T12:00:00Z");
const MONTH = new Date("2037-03-01T00:00:00Z");
const KEY = "chatmonth:total";

describe.runIf(url)("Claude's month", () => {
  let client: PrismaClient;
  const send = vi.fn(async () => undefined);
  const spent = (cents: number) =>
    client.rateLimit.upsert({
      where: { key_windowStart: { key: KEY, windowStart: MONTH } },
      create: { key: KEY, windowStart: MONTH, count: cents * 100 },
      update: { count: cents * 100 },
    });
  const told = () =>
    (send.mock.calls as unknown as [{ subject: string }][])
      .map(([m]) => m.subject)
      .filter((subject) => subject.startsWith("Claude:"));

  beforeAll(() => {
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
    vi.stubEnv("ADMIN_EMAILS", "team@example.test");
    vi.stubEnv("CHAT_MONTHLY_CAP_CENTS", "");
  });
  beforeEach(async () => {
    send.mockClear();
    await client.healthNotice.deleteMany({ where: { key: { startsWith: "claude-month:2037" } } });
  });
  afterAll(async () => {
    await client.healthNotice.deleteMany({ where: { key: { startsWith: "claude-month:2037" } } });
    await client.rateLimit.deleteMany({ where: { key: KEY, windowStart: MONTH } });
    vi.unstubAllEnvs();
    await client.$disconnect();
  });

  it("says nothing while there's plenty left", async () => {
    await spent(CHAT_MONTHLY_CAP_CENTS_DEFAULT / 4);
    await reportMissedJobs({ client, now: NOW, send });
    expect(told()).toEqual([]);
  });

  it("tells the team once at the share, and once more at the cap", async () => {
    await spent(CHAT_MONTHLY_CAP_CENTS_DEFAULT / 2);
    await reportMissedJobs({ client, now: NOW, send });
    await reportMissedJobs({ client, now: NOW, send });
    expect(told()).toHaveLength(1);
    expect(told()[0]).toContain("$4.00 of this month's $8.00");

    await spent(CHAT_MONTHLY_CAP_CENTS_DEFAULT);
    await reportMissedJobs({ client, now: NOW, send });
    await reportMissedJobs({ client, now: NOW, send });
    expect(told()).toHaveLength(2);
    expect(told()[1]).toContain("$8.00 of this month's $8.00");
  });
});
