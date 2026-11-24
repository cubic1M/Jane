import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn(), SYSTEM_ACTOR: { type: "system", id: null } }));

import { runDailyReports } from "@/lib/daily-report/send";
import type { sendEmail } from "@/lib/email";
import { deliverChatNotifications } from "./notify";

// One email a day of this kind: while the daily report is reaching someone, the chat's morning brief
// isn't also emailed to them (it stays in the app), and the report says how many decisions wait for
// an answer there. Against a real, migrated Postgres.

const url = process.env.TEST_DATABASE_URL;
// 10am in Los Angeles, outside quiet hours; the messages were posted at 8am.
const NOW = new Date("2026-11-23T18:00:00Z");
const POSTED = new Date("2026-11-23T16:00:00Z");
const LATER = new Date("2026-11-23T20:00:00Z");

type Email = Parameters<typeof sendEmail>[0];

describe.runIf(url)("the morning brief and the daily report, against a real database", () => {
  let client: PrismaClient;
  const created: string[] = [];

  async function person({
    daily,
    reached = false,
    decision = false,
  }: {
    daily: boolean;
    // A daily report went out to them lately.
    reached?: boolean;
    // The brief carries a decision waiting for an answer in the chat.
    decision?: boolean;
  }) {
    const user = await client.user.create({
      data: {
        email: `brief-${crypto.randomUUID()}@example.com`,
        dailyReportEnabled: daily,
        timezone: "America/Los_Angeles",
        // Email only, with the brief turned on.
        chatNotifyPrefs: { channel: "email", kinds: { brief: true } },
      },
    });
    created.push(user.id);
    await client.account.create({
      data: { userId: user.id, source: "csv", name: "Card", type: "credit" },
    });
    if (reached) {
      await client.dailyReport.create({
        data: {
          userId: user.id,
          day: new Date("2026-11-22"),
          sentAt: new Date(NOW.getTime() - 20 * 3_600_000),
        },
      });
    }
    const item = `finding:${crypto.randomUUID()}`;
    for (const [kind, key] of [
      ["brief", "brief:2026-11-23"],
      ["heads_up", "deadline:1"],
    ] as const) {
      await client.janeMessage.create({
        data: {
          userId: user.id,
          kind,
          body:
            kind === "brief"
              ? decision
                ? "Your day: one thing needs your yes."
                : "Your day: nothing due."
              : "A deadline is close.",
          dedupeKey: key,
          priority: 10,
          createdAt: POSTED,
          ...(kind === "brief" && decision
            ? {
                refs: {
                  items: [{ dedupeKey: item, label: "Review the fee", action: "decision.yes" }],
                },
              }
            : {}),
        },
      });
    }
    if (decision) {
      // The decision itself, bundled behind the brief: open, and hidden from the chat's list.
      await client.janeMessage.create({
        data: {
          userId: user.id,
          kind: "decision",
          body: "A fee to review.",
          dedupeKey: item,
          createdAt: POSTED,
          readAt: POSTED,
          snoozedUntil: new Date("2099-01-01T00:00:00Z"),
        },
      });
    }
    return user.id;
  }

  beforeAll(() => {
    vi.stubEnv("AUTH_SECRET", "test-secret");
    vi.stubEnv("APP_URL", "https://app.example.com");
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
  });

  afterAll(async () => {
    await client.user.deleteMany({ where: { id: { in: created } } });
    await client.$disconnect();
    vi.unstubAllEnvs();
  });

  const emailsFor = async (userId: string, now = NOW) => {
    const sent: Email[] = [];
    await deliverChatNotifications(userId, {
      client,
      now,
      send: async (email) => void sent.push(email),
    });
    return sent.map((e) => e.text).join("\n");
  };

  it("emails the brief to someone without the daily report, as before", async () => {
    const text = await emailsFor(await person({ daily: false }));
    expect(text).toContain("Your day: nothing due.");
  });

  it("doesn't email the brief while the daily report reaches them, and still emails what else is waiting", async () => {
    const userId = await person({ daily: true, reached: true });
    const text = await emailsFor(userId);
    expect(text).not.toContain("Your day: nothing due.");
    expect(text).toContain("A deadline is close.");
    // The brief is still there, unread, in the chat.
    const brief = await client.janeMessage.findFirstOrThrow({ where: { userId, kind: "brief" } });
    expect(brief.readAt).toBeNull();
    expect(brief.status).toBe("open");
  });

  // Someone the report hasn't reached (the first day, or outside its 7am to 8pm window, like Hawaii at
  // the 15:00 UTC run) would otherwise hear from neither.
  it("still emails the brief to someone whose daily report hasn't gone out", async () => {
    const text = await emailsFor(await person({ daily: true, reached: false }));
    expect(text).toContain("Your day: nothing due.");
  });

  // An email-only person with a decision waiting: the brief's email doesn't go, so the report is what
  // tells them, and says how many wait and where. One email of this kind a day.
  it("tells an email-only person with a decision waiting through the report, not the brief's email", async () => {
    const userId = await person({ daily: true, decision: true });
    const reports: Email[] = [];
    const run = (now: Date) =>
      runDailyReports({
        client,
        userIds: [userId],
        now,
        send: async (email) => void reports.push(email),
      });

    // Before a report has gone out, the brief with its decision is emailed, so they are never silent.
    const before = await emailsFor(userId);
    expect(before).toContain("Your day: one thing needs your yes.");

    // The report names what waits, with a link to the chat.
    await run(NOW);
    expect(reports).toHaveLength(1);
    expect(reports[0].text).toContain("Waiting for you");
    expect(reports[0].text).toContain("1 thing is waiting for your answer in your chat.");
    expect(reports[0].text).toContain("https://app.example.com/chat?utm_source=digest");

    // From then on the brief isn't emailed as well: a new brief the next morning stays in the chat.
    await client.janeMessage.create({
      data: {
        userId,
        kind: "brief",
        body: "Your day: still one thing needs your yes.",
        dedupeKey: "brief:2026-11-23:again",
        priority: 10,
        createdAt: POSTED,
        refs: {
          items: [
            {
              dedupeKey: (
                await client.janeMessage.findFirstOrThrow({ where: { userId, kind: "decision" } })
              ).dedupeKey,
              label: "Review the fee",
              action: "decision.yes",
            },
          ],
        },
      },
    });
    const after = await emailsFor(userId, LATER);
    expect(after).not.toContain("still one thing needs your yes");

    // Answered in the chat, nothing waits any more, so the report doesn't say so.
    await client.janeMessage.updateMany({
      where: { userId, kind: "decision" },
      data: { status: "answered" },
    });
    reports.length = 0;
    await run(new Date(NOW.getTime() + 24 * 3_600_000));
    expect(reports[0].text).not.toContain("waiting for your answer");
  });
});
