import { randomBytes } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import type { PlaidApi } from "plaid";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient, type Prisma } from "@/generated/prisma/client";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn(), SYSTEM_ACTOR: { type: "system", id: null } }));

import {
  CHAT_EMAILS_PER_DAY,
  CHAT_LINK_HOURS,
  CHAT_NOTIFY_DAILY_LIMIT,
} from "@/config/chat-notify";
import { logAudit } from "@/lib/audit";
import { findingOfType } from "@/lib/__fixtures__/findings";
import { linkDemoBank } from "@/lib/plaid/demo";
import { syncItem } from "@/lib/plaid/sync";
import type { sendEmail } from "@/lib/email";
import type { sendPush } from "@/lib/push";
import { ChatActionError } from "./actions";
import { markChatRead } from "./messages";
import { AS_THEY_COME } from "./preferences";
import { deliverChatNotifications, queueChatNotifications } from "./notify";
import { createReplyLink, redeemReplyLink, ReplyLinkError, viewReplyLink } from "./reply-links";
import { runJaneAgent } from "./run";

// Spec step 85 against a real, migrated Postgres (see
// src/lib/jane-agent/agent.integration.test.ts): Jane's brain posts, a notification job is
// queued and sent with fake push and email senders, and a one-tap link from the email
// answers the message once, through the chat's own checks.

const url = process.env.TEST_DATABASE_URL;
// 8am in Los Angeles (the default timezone): after quiet hours.
const LINKED = new Date("2026-10-18T15:00:00Z");
const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const at = (ms: number) => new Date(LINKED.getTime() + ms);

type Email = Parameters<typeof sendEmail>[0];

describe.runIf(url)("Jane's messages as notifications, against a real database", () => {
  let client: PrismaClient;
  const created: string[] = [];
  const plaid = new Proxy(
    {},
    {
      get: () => () => {
        throw new Error("The demo bank must never call Plaid");
      },
    },
  ) as PlaidApi;

  // Each message on its own (spec step 184's "as they come"): these tests are about how
  // single messages go out. The day's agenda has its own test below.
  async function person(
    prefix: string,
    chatNotifyPrefs: Prisma.InputJsonObject = {},
    { agenda = false }: { agenda?: boolean } = {},
  ) {
    const user = await client.user.create({
      data: { email: `${prefix}-${crypto.randomUUID()}@example.com`, chatNotifyPrefs },
    });
    created.push(user.id);
    if (!agenda) {
      await client.janePreference.create({
        data: { userId: user.id, ...AS_THEY_COME, value: AS_THEY_COME.value },
      });
    }
    return user.id;
  }

  // Someone with a couple of findings, and Jane's first messages to them, posted at 8am.
  async function withMessages(
    prefix: string,
    prefs: Prisma.InputJsonObject = {},
    options: { agenda?: boolean } = {},
  ) {
    const userId = await person(prefix, prefs, options);
    await client.account.create({
      data: { userId, source: "csv", name: "Checking", type: "depository", subtype: "checking" },
    });
    // Two kinds, so each is its own message (spec step 92 bundles a kind together).
    for (const type of ["bank_fees", "card_interest"] as const) {
      const f = findingOfType(type);
      await client.finding.create({
        data: {
          userId,
          type: f.type,
          key: `${f.key}-${crypto.randomUUID()}`,
          title: f.title,
          annualSavingsCents: f.annualSavingsCents,
          amountCents: f.amountCents,
          confidence: f.confidence,
          evidence: f.evidence as Prisma.InputJsonObject,
        },
      });
    }
    await runJaneAgent(userId, { client, now: LINKED, trigger: "sync" });
    return userId;
  }

  const device = (userId: string) =>
    client.pushSubscription.create({
      data: {
        userId,
        endpoint: `https://push.example.com/${crypto.randomUUID()}`,
        p256dh: "test-p256dh",
        auth: "test-auth",
      },
    });

  const messagesOf = (userId: string) =>
    client.janeMessage.findMany({ where: { userId }, orderBy: { createdAt: "asc" } });

  const fakes = (pushResult = 1) => ({
    push: vi.fn<typeof sendPush>(async () => pushResult),
    send: vi.fn<(email: Email) => Promise<void>>(async () => {}),
  });

  const tokenOf = (link: string) => new URL(link).searchParams.get("token") ?? "";
  // "[ Yes ] https://…/chat/reply?token=…" in the email's text.
  const linksIn = (email: Email) =>
    [...email.text.matchAll(/^\[ (.+) \] (\S+)$/gm)].map((m) => ({ label: m[1], url: m[2] }));

  beforeAll(() => {
    vi.stubEnv("TOKEN_ENCRYPTION_KEY", randomBytes(32).toString("base64"));
    vi.stubEnv("AUTH_SECRET", "test-secret-for-unsubscribe-links");
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    vi.stubEnv("PLAID_CLIENT_ID", "");
    vi.stubEnv("PLAID_SECRET", "");
    vi.stubEnv("RESEND_API_KEY", "");
    vi.stubEnv("VAPID_PUBLIC_KEY", "test-public");
    vi.stubEnv("VAPID_PRIVATE_KEY", "test-private");
    vi.stubEnv("VAPID_SUBJECT", "mailto:team@example.com");
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
  });
  afterAll(async () => {
    await client.job.deleteMany({
      where: {
        kind: "chat_notify",
        OR: created.map((id) => ({ payload: { equals: { userId: id } } })),
      },
    });
    await client.user.deleteMany({ where: { id: { in: created } } });
    await client.$disconnect();
    vi.unstubAllEnvs();
  });

  describe("with the demo bank", () => {
    let userId: string;

    beforeAll(async () => {
      userId = await person("notify-demo");
      const { itemId } = await linkDemoBank(userId, { client, now: LINKED });
      await syncItem(itemId, { client, api: plaid, now: LINKED });
    }, 120_000);

    it("queues a notification job when the brain posts; with no device and no email set up, nothing goes", async () => {
      const jobs = await client.job.findMany({
        where: { kind: "chat_notify", payload: { equals: { userId } } },
      });
      expect(jobs.length).toBeGreaterThanOrEqual(1);
      expect(jobs.every((j) => j.status === "done")).toBe(true);
      expect((await messagesOf(userId)).every((m) => m.notifiedAt === null)).toBe(true);
    });

    it("emails what's waiting from the daily run, and a one-tap link answers its message once", async () => {
      const { push, send } = fakes();
      const now = at(2 * HOUR);
      const jobId = await queueChatNotifications(userId, {
        client,
        now,
        trigger: "cron",
        deliver: (id, options) => deliverChatNotifications(id, { ...options, push, send }),
      });
      expect((await client.job.findUniqueOrThrow({ where: { id: jobId! } })).status).toBe("done");

      // One email for the whole batch; no phone, so no push.
      expect(push).not.toHaveBeenCalled();
      expect(send).toHaveBeenCalledTimes(1);
      const email = send.mock.calls[0][0];
      const user = await client.user.findUniqueOrThrow({ where: { id: userId } });
      expect(email.to).toBe(user.email);
      expect(email.headers?.["List-Unsubscribe"]).toContain("what=chat");
      const emailed = (await messagesOf(userId)).filter((m) => m.notifiedVia === "email");
      expect(emailed.length).toBeGreaterThan(0);
      // The brief is opt-in.
      expect(emailed.some((m) => m.kind === "brief")).toBe(false);
      expect(logAudit).toHaveBeenCalledWith(
        { type: "system", id: null },
        "chat_notification_sent",
        { type: "jane_message", id: emailed[0].id },
        { channel: "email", kind: emailed[0].kind },
      );

      // The next run sends nothing twice.
      await queueChatNotifications(userId, {
        client,
        now: at(3 * HOUR),
        trigger: "cron",
        deliver: (id, options) => deliverChatNotifications(id, { ...options, push, send }),
      });
      expect(send).toHaveBeenCalledTimes(1);
    });

    // A finding's Yes, as a one-tap link: opening it changes nothing. The demo bank's morning
    // leads with what outranks findings (deadlines, the plan, a cover change), so the link is
    // tried on someone whose waiting messages are findings.
    it("a one-tap link in the email answers a finding's message once", async () => {
      const userId = await withMessages("notify-link");
      const { push, send } = fakes();
      const now = at(2 * HOUR);
      expect(await deliverChatNotifications(userId, { client, now, push, send })).toMatchObject({
        emailed: expect.any(Number),
      });
      expect(send).toHaveBeenCalledTimes(1);
      const links = linksIn(send.mock.calls[0][0]);
      const yesAt = links.findIndex((l) => l.label === "Yes");
      const yes = links[yesAt];
      // The same message's No comes after its Yes (and Jane's pick, if any).
      const no = links.slice(yesAt).find((l) => l.label === "No")!;
      expect(yes.url).toMatch(/\/chat\/reply\?token=/);
      // Only the hash is stored.
      expect(await client.chatReplyLink.count({ where: { tokenHash: tokenOf(yes.url) } })).toBe(0);
      expect(await viewReplyLink(tokenOf(yes.url), { client, now })).toMatchObject({
        state: "ready",
        label: "Yes",
      });
      expect(await viewReplyLink(tokenOf(yes.url), { client, now })).toMatchObject({
        state: "ready",
      });

      // The confirm button: the same answer as the chat's, once.
      const { message } = await redeemReplyLink(tokenOf(yes.url), { client, now });
      expect(message).toMatchObject({ kind: "decision", status: "answered", answeredWith: "Yes" });
      const { findingId } = message.refs;
      expect(
        await client.decision.findFirstOrThrow({ where: { userId, findingId } }),
      ).toMatchObject({ choice: "yes", source: "chat" });
      await expect(redeemReplyLink(tokenOf(yes.url), { client, now })).rejects.toBeInstanceOf(
        ReplyLinkError,
      );
      expect(await viewReplyLink(tokenOf(yes.url), { client, now })).toMatchObject({
        state: "used",
      });
      // The same message's No no longer works: it's answered.
      expect(await viewReplyLink(tokenOf(no.url), { client, now })).toMatchObject({
        state: "answered",
        messageId: message.id,
      });
      await expect(redeemReplyLink(tokenOf(no.url), { client, now })).rejects.toMatchObject({
        code: "not_open",
      });
      expect(await client.decision.count({ where: { userId, findingId } })).toBe(1);
    });
  });

  describe("which messages go out", () => {
    it("pushes decisions straight away with their first buttons, not the brief, and never twice", async () => {
      const userId = await withMessages("notify-push");
      await device(userId);
      const { push, send } = fakes();
      const result = await deliverChatNotifications(userId, {
        client,
        now: at(MINUTE),
        push,
        send,
      });
      const decisions = (await messagesOf(userId)).filter((m) => m.kind === "decision");
      expect(result).toEqual({ pushed: decisions.length, emailed: 0 });
      const [, payload] = push.mock.calls[0];
      expect(payload).toMatchObject({ title: "Jane", url: expect.stringMatching(/^\/chat#/) });
      expect(payload.actions?.length).toBeGreaterThan(0);
      expect(payload.actions?.length).toBeLessThanOrEqual(2);
      expect(push.mock.calls.some(([, p]) => p.body.startsWith("Good morning"))).toBe(false);
      expect(send).not.toHaveBeenCalled();

      expect(
        await deliverChatNotifications(userId, { client, now: at(2 * MINUTE), push, send }),
      ).toEqual({ pushed: 0, emailed: 0 });
    });

    it("sends the morning brief to people who turned it on", async () => {
      const userId = await withMessages("notify-brief", { kinds: { brief: true } });
      await device(userId);
      const { push, send } = fakes();
      await deliverChatNotifications(userId, { client, now: at(MINUTE), push, send });
      expect(push.mock.calls.some(([, p]) => p.body.startsWith("Good morning"))).toBe(true);
    });

    // Spec step 184: by default the day is one agenda message, and what it lists is hidden
    // behind it; the agenda goes out once, like a decision, when something needs a yes.
    it("pushes the day's agenda once when something on it needs a yes", async () => {
      const userId = await withMessages("notify-agenda", {}, { agenda: true });
      await device(userId);
      const { push, send } = fakes();
      // The agenda, and what shows besides it (the one-time autopilot question); never the
      // findings hidden behind it.
      const shown = (await messagesOf(userId)).filter(
        (m) => m.kind === "decision" && m.readAt === null,
      );
      expect(
        await deliverChatNotifications(userId, { client, now: at(MINUTE), push, send }),
      ).toEqual({ pushed: shown.length + 1, emailed: 0 });
      const agenda = push.mock.calls.find(([, p]) => p.body.startsWith("Good morning!"));
      expect(agenda?.[1].actions?.length).toBeGreaterThan(0);
      expect(
        await deliverChatNotifications(userId, { client, now: at(2 * MINUTE), push, send }),
      ).toEqual({ pushed: 0, emailed: 0 });
    });

    it("stops a kind turned off at once, and everything when off", async () => {
      const userId = await withMessages("notify-off");
      await device(userId);
      await client.user.update({
        where: { id: userId },
        data: { chatNotifyPrefs: { kinds: { decision: false } } },
      });
      const { push, send } = fakes();
      await deliverChatNotifications(userId, { client, now: at(MINUTE), push, send });
      expect(push).not.toHaveBeenCalled();
      await client.user.update({
        where: { id: userId },
        data: { chatNotifyPrefs: { channel: "off" } },
      });
      expect(
        await deliverChatNotifications(userId, { client, now: at(2 * HOUR), push, send }),
      ).toEqual({ pushed: 0, emailed: 0 });
      expect(send).not.toHaveBeenCalled();
    });

    it("sends nothing in quiet hours", async () => {
      const userId = await withMessages("notify-quiet");
      await device(userId);
      const { push, send } = fakes();
      // 10pm in Los Angeles, the same day.
      expect(
        await deliverChatNotifications(userId, { client, now: at(14 * HOUR), push, send }),
      ).toEqual({ pushed: 0, emailed: 0 });
      expect(push).not.toHaveBeenCalled();
      // Out of quiet hours, they go.
      expect(
        (await deliverChatNotifications(userId, { client, now: at(MINUTE), push, send })).pushed,
      ).toBeGreaterThan(0);
    });

    it("sends nothing the person already read in the app", async () => {
      const userId = await withMessages("notify-read");
      await device(userId);
      await markChatRead(userId, { client, now: at(MINUTE) });
      const { push, send } = fakes();
      expect(
        await deliverChatNotifications(userId, { client, now: at(2 * HOUR), push, send }),
      ).toEqual({ pushed: 0, emailed: 0 });
    });

    it("keeps to the daily cap", async () => {
      const userId = await withMessages("notify-cap");
      await device(userId);
      await client.janeMessage.createMany({
        data: Array.from({ length: CHAT_NOTIFY_DAILY_LIMIT }, (_, i) => ({
          userId,
          kind: "decision",
          body: "Earlier",
          dedupeKey: `test:earlier-${i}`,
          status: "answered",
          createdAt: at(-3 * HOUR),
          notifiedAt: at(-2 * HOUR),
          notifiedVia: "push",
        })),
      });
      const { push, send } = fakes();
      expect(
        await deliverChatNotifications(userId, { client, now: at(MINUTE), push, send }),
      ).toEqual({ pushed: 0, emailed: 0 });
      // A day later the cap has room again.
      await client.janeMessage.updateMany({
        where: { userId, dedupeKey: { startsWith: "test:" } },
        data: { notifiedAt: at(-25 * HOUR) },
      });
      expect(
        (await deliverChatNotifications(userId, { client, now: at(2 * MINUTE), push, send }))
          .pushed,
      ).toBeGreaterThan(0);
    });
  });

  describe("email", () => {
    it("waits until messages sat unread, then sends one email for the batch, within the email cap", async () => {
      const userId = await withMessages("notify-email", { channel: "email" });
      const { push, send } = fakes();
      expect(
        await deliverChatNotifications(userId, { client, now: at(5 * MINUTE), push, send }),
      ).toEqual({ pushed: 0, emailed: 0 });

      const result = await deliverChatNotifications(userId, {
        client,
        now: at(61 * MINUTE),
        push,
        send,
      });
      const decisions = (await messagesOf(userId)).filter((m) => m.kind === "decision");
      expect(result).toEqual({ pushed: 0, emailed: decisions.length });
      expect(send).toHaveBeenCalledTimes(1);
      expect(push).not.toHaveBeenCalled();
      const buttons = linksIn(send.mock.calls[0][0]);
      expect(buttons.length).toBeGreaterThan(0);
      expect(await client.chatReplyLink.count({ where: { userId } })).toBe(buttons.length);

      // Past the email cap, nothing more today.
      await client.janeMessage.createMany({
        data: Array.from({ length: CHAT_EMAILS_PER_DAY + 1 }, (_, i) => ({
          userId,
          kind: "decision",
          body: "New",
          dedupeKey: `test:new-${i}`,
          createdAt: at(62 * MINUTE),
          ...(i < CHAT_EMAILS_PER_DAY - 1
            ? { notifiedAt: at(i * MINUTE), notifiedVia: "email", status: "answered" }
            : {}),
        })),
      });
      expect(
        (await deliverChatNotifications(userId, { client, now: at(3 * HOUR), push, send })).emailed,
      ).toBe(0);
      expect(send).toHaveBeenCalledTimes(1);
    });

    it("emails when no phone takes the push", async () => {
      const userId = await withMessages("notify-fallback");
      await device(userId);
      const { push, send } = fakes(0);
      const result = await deliverChatNotifications(userId, {
        client,
        now: at(2 * HOUR),
        push,
        send,
      });
      expect(push).toHaveBeenCalledTimes(1);
      expect(result.pushed).toBe(0);
      expect(result.emailed).toBeGreaterThan(0);
      expect(send).toHaveBeenCalledTimes(1);
    });

    it("with both, pushes now and emails the same messages later, counted once", async () => {
      const userId = await withMessages("notify-both", { channel: "both" });
      await device(userId);
      const { push, send } = fakes();
      const first = await deliverChatNotifications(userId, { client, now: at(MINUTE), push, send });
      expect(first.pushed).toBeGreaterThan(0);
      expect(first.emailed).toBe(0);
      const later = await deliverChatNotifications(userId, {
        client,
        now: at(2 * HOUR),
        push,
        send,
      });
      expect(later).toEqual({ pushed: 0, emailed: first.pushed });
      const sent = (await messagesOf(userId)).filter((m) => m.notifiedVia !== null);
      expect(sent.every((m) => m.notifiedVia === "both")).toBe(true);
    });

    it("gives the messages back when the email fails, so the retry sends them", async () => {
      const userId = await withMessages("notify-fail", { channel: "email" });
      const { push, send } = fakes();
      send.mockRejectedValueOnce(new Error("Resend is down"));
      await expect(
        deliverChatNotifications(userId, { client, now: at(2 * HOUR), push, send }),
      ).rejects.toThrow("Resend is down");
      expect((await messagesOf(userId)).every((m) => m.notifiedAt === null)).toBe(true);
      expect(
        (await deliverChatNotifications(userId, { client, now: at(2 * HOUR), push, send })).emailed,
      ).toBeGreaterThan(0);
    });
  });

  describe("one-tap links", () => {
    async function linkFor(prefix: string) {
      const userId = await withMessages(prefix);
      const message = (await messagesOf(userId)).find(
        (m) => m.kind === "decision" && m.dedupeKey.startsWith("findings:"),
      )!;
      const link = await createReplyLink(userId, message.id, "finding.no", { client, now: LINKED });
      return { userId, message, token: tokenOf(link) };
    }

    it("expires", async () => {
      const { token } = await linkFor("link-expired");
      const late = at((CHAT_LINK_HOURS + 1) * HOUR);
      expect(await viewReplyLink(token, { client, now: late })).toEqual({ state: "expired" });
      await expect(redeemReplyLink(token, { client, now: late })).rejects.toThrow(
        "This link has expired.",
      );
    });

    it("refuses someone else signed in, and leaves the link unused", async () => {
      const { token, message } = await linkFor("link-owner");
      const stranger = await person("link-stranger");
      expect(await viewReplyLink(token, { client, now: LINKED, signedInAs: stranger })).toEqual({
        state: "wrong_user",
      });
      await expect(
        redeemReplyLink(token, { client, now: LINKED, signedInAs: stranger }),
      ).rejects.toThrow("This link is for a different account.");
      expect(
        (await client.janeMessage.findUniqueOrThrow({ where: { id: message.id } })).status,
      ).toBe("open");
      expect(await viewReplyLink(token, { client, now: LINKED })).toMatchObject({ state: "ready" });
    });

    it("never answers another person's message, whatever the link row says", async () => {
      const { message } = await linkFor("link-victim");
      const stranger = await person("link-forger");
      const forged = await createReplyLink(stranger, message.id, "finding.no", {
        client,
        now: LINKED,
      });
      expect(await viewReplyLink(tokenOf(forged), { client, now: LINKED })).toEqual({
        state: "invalid",
      });
      await expect(
        redeemReplyLink(tokenOf(forged), { client, now: LINKED }),
      ).rejects.toBeInstanceOf(ChatActionError);
      expect(
        (await client.janeMessage.findUniqueOrThrow({ where: { id: message.id } })).status,
      ).toBe("open");
    });

    it("refuses a token that isn't one", async () => {
      expect(await viewReplyLink("nope", { client })).toEqual({ state: "invalid" });
      await expect(redeemReplyLink("x".repeat(43), { client })).rejects.toThrow(
        "This link doesn't work.",
      );
    });
  });
});
