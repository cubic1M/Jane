import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn(), SYSTEM_ACTOR: { type: "system", id: null } }));

import type { sendEmail } from "@/lib/email";
import { deliverChatNotifications } from "./notify";

// One email a day of this kind: someone with the daily report on doesn't also get the chat's
// morning brief by email (it stays in the app). Against a real, migrated Postgres.

const url = process.env.TEST_DATABASE_URL;
// 10am in Los Angeles, outside quiet hours; the messages were posted at 8am.
const NOW = new Date("2026-11-23T18:00:00Z");
const POSTED = new Date("2026-11-23T16:00:00Z");

type Email = Parameters<typeof sendEmail>[0];

describe.runIf(url)("the morning brief and the daily report, against a real database", () => {
  let client: PrismaClient;
  const created: string[] = [];

  async function person(dailyReportEnabled: boolean) {
    const user = await client.user.create({
      data: {
        email: `brief-${crypto.randomUUID()}@example.com`,
        dailyReportEnabled,
        timezone: "America/Los_Angeles",
        chatNotifyPrefs: { channel: "email", kinds: { brief: true } },
      },
    });
    created.push(user.id);
    for (const [kind, key] of [
      ["brief", "brief:2026-11-23"],
      ["heads_up", "deadline:1"],
    ] as const) {
      await client.janeMessage.create({
        data: {
          userId: user.id,
          kind,
          body: kind === "brief" ? "Your day: nothing due." : "A deadline is close.",
          dedupeKey: key,
          priority: 10,
          createdAt: POSTED,
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

  const emailsFor = async (userId: string) => {
    const sent: Email[] = [];
    await deliverChatNotifications(userId, {
      client,
      now: NOW,
      send: async (email) => void sent.push(email),
    });
    return sent.map((e) => e.text).join("\n");
  };

  it("emails the brief to someone without the daily report, as before", async () => {
    const text = await emailsFor(await person(false));
    expect(text).toContain("Your day: nothing due.");
  });

  it("doesn't email the brief when the daily report is on, and still emails what else is waiting", async () => {
    const userId = await person(true);
    const text = await emailsFor(userId);
    expect(text).not.toContain("Your day: nothing due.");
    expect(text).toContain("A deadline is close.");
    // The brief is still there, unread, in the chat.
    const brief = await client.janeMessage.findFirstOrThrow({ where: { userId, kind: "brief" } });
    expect(brief.readAt).toBeNull();
    expect(brief.status).toBe("open");
  });
});
