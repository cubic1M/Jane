import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
// What crossing a share sends at once goes through the app's own sender.
vi.mock("@/lib/email", () => ({ sendEmail: vi.fn(async () => undefined) }));

import { CHAT_MONTHLY_CAP_CENTS_DEFAULT, CLAUDE_MONTH_WARN_SHARE } from "@/config/agent-chat";
import { sendEmail } from "@/lib/email";
import { addMonthlySpend } from "@/lib/jane-agent/claude-limits";
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

  it("tells the team once at the share, once when it runs low, and once more at the cap", async () => {
    await spent(CHAT_MONTHLY_CAP_CENTS_DEFAULT / 2);
    await reportMissedJobs({ client, now: NOW, send });
    await reportMissedJobs({ client, now: NOW, send });
    expect(told()).toHaveLength(1);
    expect(told()[0]).toContain("$4.00 of this month's $8.00");

    // Beta (11-12): at 70%, with time to raise it before everyone loses written answers.
    await spent(CHAT_MONTHLY_CAP_CENTS_DEFAULT * CLAUDE_MONTH_WARN_SHARE);
    await reportMissedJobs({ client, now: NOW, send });
    await reportMissedJobs({ client, now: NOW, send });
    expect(told()).toHaveLength(2);
    expect(told()[1]).toContain("$5.60 of this month's $8.00");
    const low = (send.mock.calls as unknown as [{ text: string }][])
      .map(([m]) => m.text)
      .find((text) => text.includes("$5.60"));
    expect(low).toMatch(/running low: past 70%/);
    expect(low).toMatch(/CHAT_MONTHLY_CAP_CENTS raises the limit/);

    await spent(CHAT_MONTHLY_CAP_CENTS_DEFAULT);
    await reportMissedJobs({ client, now: NOW, send });
    await reportMissedJobs({ client, now: NOW, send });
    expect(told()).toHaveLength(3);
    expect(told()[2]).toContain("$8.00 of this month's $8.00");
  });

  it("tells the team the moment an answer takes the month past 70%, not at the next daily job", async () => {
    const mailed = vi.mocked(sendEmail);
    mailed.mockClear();
    await spent(CHAT_MONTHLY_CAP_CENTS_DEFAULT * 0.65);
    // Under every share's line already passed: nothing new.
    await addMonthlySpend(100, { client, now: NOW });
    expect(mailed).not.toHaveBeenCalled();
    // This one crosses 70%.
    await addMonthlySpend(CHAT_MONTHLY_CAP_CENTS_DEFAULT * 0.06 * 100, { client, now: NOW });
    expect(mailed).toHaveBeenCalledTimes(1);
    expect(mailed.mock.calls[0]![0]).toMatchObject({ to: "team@example.test" });
    expect(mailed.mock.calls[0]![0].subject).toMatch(
      /^Claude: Claude has used \$5\.\d\d of this month's \$8\.00/,
    );
    // And the next answer past it doesn't send it again.
    await addMonthlySpend(100, { client, now: NOW });
    expect(mailed).toHaveBeenCalledTimes(1);
  });
});
