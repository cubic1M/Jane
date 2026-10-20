import { randomBytes } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient, type Prisma } from "@/generated/prisma/client";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn(), SYSTEM_ACTOR: { type: "system", id: null } }));

import { ATTENTION_STOP_AFTER } from "@/config/attention";
import type { sendEmail } from "@/lib/email";
import type { sendPush } from "@/lib/push";
import { takeChatAction } from "./actions";
import { loadAttention, resumeKind } from "./attention-load";
import { postMessages } from "./messages";
import { deliverChatNotifications } from "./notify";
import { attentionSource } from "./sources/attention";
import { gather } from "./brain";
import { loadSnapshot } from "./snapshot";

// Spec step 147 against a real, migrated Postgres: Jane stops a kind of message the person
// never says yes to and says so, brings it back on a tap, sends several things that aren't
// urgent as one notification (urgent ones on their own), and sends what isn't urgent the
// way the person answers.

const url = process.env.TEST_DATABASE_URL;
// 8am in Los Angeles (the default timezone): after quiet hours.
const NOW = new Date("2026-10-19T15:00:00Z");
const DAY = 24 * 60 * 60 * 1000;
const ago = (days: number) => new Date(NOW.getTime() - days * DAY);
const YES = [
  { id: "finding.yes", label: "Yes", kind: "primary" },
  { id: "finding.no", label: "No", kind: "secondary" },
];

type Email = Parameters<typeof sendEmail>[0];

describe.runIf(url)("asking less, against a real database", { timeout: 60_000 }, () => {
  let client: PrismaClient;
  const created: string[] = [];

  async function person(prefix: string, chatNotifyPrefs: Prisma.InputJsonObject = {}) {
    const user = await client.user.create({
      data: { email: `${prefix}-${crypto.randomUUID()}@example.com`, chatNotifyPrefs },
    });
    created.push(user.id);
    await client.account.create({
      data: {
        userId: user.id,
        source: "csv",
        name: "Checking",
        type: "depository",
        subtype: "checking",
        currentBalanceCents: 100_000,
      },
    });
    return user.id;
  }
  const message = (userId: string, over: Partial<Prisma.JaneMessageCreateManyInput>) => ({
    userId,
    kind: "decision",
    body: "Something to decide.",
    actions: YES,
    dedupeKey: `budgets:${crypto.randomUUID()}`,
    createdAt: ago(5),
    ...over,
  });
  const device = (userId: string) =>
    client.pushSubscription.create({
      data: {
        userId,
        endpoint: `https://push.example.com/${crypto.randomUUID()}`,
        p256dh: "test-p256dh",
        auth: "test-auth",
      },
    });

  beforeAll(() => {
    vi.stubEnv("TOKEN_ENCRYPTION_KEY", randomBytes(32).toString("base64"));
    vi.stubEnv("AUTH_SECRET", "test-secret-for-unsubscribe-links");
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    vi.stubEnv("RESEND_API_KEY", "");
    vi.stubEnv("VAPID_PUBLIC_KEY", "test-public");
    vi.stubEnv("VAPID_PRIVATE_KEY", "test-private");
    vi.stubEnv("VAPID_SUBJECT", "mailto:team@example.com");
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
  });
  afterAll(async () => {
    await client.job.deleteMany({
      where: { OR: created.map((id) => ({ payload: { equals: { userId: id } } })) },
    });
    await client.user.deleteMany({ where: { id: { in: created } } });
    await client.$disconnect();
    vi.unstubAllEnvs();
  });

  it("stops a kind never said yes to, says so once, and brings it back on a tap", async () => {
    const userId = await person("attention-stop");
    await client.janeMessage.createMany({
      data: Array.from({ length: ATTENTION_STOP_AFTER }, (_, i) =>
        message(userId, {
          createdAt: ago(3 + i),
          status: i === 0 ? "answered" : "open",
          answeredWith: i === 0 ? "No" : null,
        }),
      ),
    });
    expect((await loadAttention(userId, { client, now: NOW })).stopped).toEqual([
      expect.objectContaining({ source: "budgets", label: "budget check-ins" }),
    ]);

    const snapshot = await loadSnapshot(userId, { client, now: NOW });
    await postMessages(
      userId,
      gather(snapshot!, NOW, { trigger: "open", sources: [attentionSource] }),
      { client, now: NOW },
    );
    const note = await client.janeMessage.findFirstOrThrow({
      where: { userId, dedupeKey: { startsWith: "attention:" } },
    });
    expect(note.body).toMatch(/^I'll stop bringing up budget check-ins/);
    const { message: answered } = await takeChatAction(userId, note.id, "attention.resume", {
      client,
      now: NOW,
    });
    expect(answered.refs.note).toBe("OK, I'll keep bringing up budget check-ins.");
    expect((await loadAttention(userId, { client, now: NOW })).stopped).toEqual([]);
    await expect(resumeKind(userId, "heads_ups", { client, now: NOW })).rejects.toThrow();
  });

  it("pushes several things that aren't urgent as one, and urgent ones on their own", async () => {
    const userId = await person("attention-bundle");
    await device(userId);
    await client.janeMessage.createMany({
      data: [
        message(userId, { createdAt: NOW, priority: 10 }),
        message(userId, {
          createdAt: NOW,
          priority: 9,
          dedupeKey: `changes:${crypto.randomUUID()}`,
        }),
        message(userId, {
          createdAt: NOW,
          priority: 100,
          kind: "heads_up",
          body: "Coming up tomorrow: rent.",
          dedupeKey: `heads_ups:${crypto.randomUUID()}`,
        }),
      ],
    });
    const push = vi.fn<typeof sendPush>(async () => 1);
    const send = vi.fn<(email: Email) => Promise<void>>(async () => {});
    expect(await deliverChatNotifications(userId, { client, now: NOW, push, send })).toEqual({
      pushed: 3,
      emailed: 0,
    });
    const payloads = push.mock.calls.map(([, p]) => p);
    expect(payloads).toEqual([
      expect.objectContaining({
        body: "Coming up tomorrow: rent.",
        url: expect.stringMatching(/^\/chat#/),
      }),
      expect.objectContaining({
        title: "Jane",
        url: "/chat",
        tag: "jane-bundle",
        body: "2 things for you. Something to decide.",
      }),
    ]);
  });

  it("sends what isn't urgent the way the person answers, when they chose both", async () => {
    const userId = await person("attention-channel", { channel: "both" });
    await device(userId);
    // Pushes went unanswered; emails got answers.
    await client.janeMessage.createMany({
      data: [
        ...[1, 2, 3, 4].map((d) =>
          message(userId, {
            createdAt: ago(d + 2),
            status: "answered",
            answeredWith: "No",
            notifiedAt: ago(d + 2),
            notifiedVia: "push",
          }),
        ),
        ...[1, 2, 3, 4].map((d) =>
          message(userId, {
            createdAt: ago(d + 2),
            status: "answered",
            answeredWith: "Yes",
            answeredAt: ago(d + 2),
            notifiedAt: ago(d + 2),
            notifiedVia: "email",
          }),
        ),
      ],
    });
    expect((await loadAttention(userId, { client, now: NOW })).channel).toBe("email");
    await client.janeMessage.createMany({
      data: [
        message(userId, { createdAt: ago(0.1), body: "A budget to look at." }),
        message(userId, {
          createdAt: ago(0.1),
          kind: "heads_up",
          body: "Coming up tomorrow: rent.",
          dedupeKey: `heads_ups:${crypto.randomUUID()}`,
        }),
      ],
    });
    const push = vi.fn<typeof sendPush>(async () => 1);
    const send = vi.fn<(email: Email) => Promise<void>>(async () => {});
    await deliverChatNotifications(userId, { client, now: NOW, push, send, emailAfterMinutes: 0 });
    expect(push.mock.calls.map(([, p]) => p.body)).toEqual(["Coming up tomorrow: rent."]);
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0][0].text).toContain("A budget to look at.");
  });
});
