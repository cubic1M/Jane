import { randomBytes } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn(), SYSTEM_ACTOR: { type: "system", id: null } }));

import { logAudit } from "@/lib/audit";
import {
  daytimeZone,
  fakePhone,
  nightZone,
  personWithFindings,
  verifiedNumber,
} from "@/lib/__fixtures__/texts";
import { runJob } from "@/lib/jobs";
import { handleInboundText } from "./inbound";
import { phoneHmac } from "./phone";
import {
  TextError,
  confirmVerification,
  deliverText,
  queueText,
  removeTextNumber,
  runPlanTexts,
  saveTextPrefs,
  sendPlanText,
  startVerification,
  textAlert,
  textNeedsYou,
} from "./texts";

// Texts against a real, migrated Postgres (spec step 78; see
// src/detection/engine.integration.test.ts), with the simulated provider.
const url = process.env.TEST_DATABASE_URL;
const HOUR = 60 * 60 * 1000;
const MINUTE = 60 * 1000;

describe.runIf(url)("texts against a real database", () => {
  let client: PrismaClient;
  const created: string[] = [];
  const sent: { to: string; body: string }[] = [];
  const send = vi.fn(async (to: string, body: string) => {
    sent.push({ to, body });
    return { providerId: `test-${randomBytes(8).toString("hex")}`, status: "delivered" };
  });

  async function person(timezone?: string) {
    const userId = await personWithFindings(client, { timezone });
    created.push(userId);
    return userId;
  }
  // The phone texts the person's own number would send.
  const inbound = (phone: string, content: string, handle = randomBytes(8).toString("hex")) =>
    handleInboundText(
      { content, number: phone, is_outbound: false, message_handle: handle, group_id: "" },
      { client },
    );
  const outbound = (userId: string) =>
    client.textMessage.findMany({
      where: { userId, direction: "outbound" },
      orderBy: { createdAt: "asc" },
    });
  const lastBody = async (userId: string) => (await outbound(userId)).at(-1)?.body ?? "";

  beforeAll(() => {
    vi.stubEnv("TOKEN_ENCRYPTION_KEY", randomBytes(32).toString("base64"));
    for (const name of ["SENDBLUE_API_KEY", "SENDBLUE_API_SECRET", "SENDBLUE_FROM_NUMBER"]) {
      vi.stubEnv(name, "");
    }
    vi.spyOn(console, "info").mockImplementation(() => {});
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
  });
  beforeEach(() => {
    sent.length = 0;
    send.mockClear();
    vi.mocked(logAudit).mockClear();
  });
  afterAll(async () => {
    await client.user.deleteMany({ where: { id: { in: created } } });
    await client.$disconnect();
    vi.unstubAllEnvs();
  });

  describe("verifying a number", () => {
    it("texts a code, keeps only its hash, and verifies the right one", async () => {
      const userId = await person();
      const { phone } = await startVerification(
        userId,
        { phone: "(415) 555-0142", consent: true },
        { client, send },
      );
      expect(phone).toBe("(•••) •••-0142");
      expect(sent[0].to).toBe("+14155550142");
      const code = /code is (\d{6})/.exec(sent[0].body)![1];

      const row = await client.textSetting.findUniqueOrThrow({ where: { userId } });
      expect(row.phoneEncrypted).not.toContain("4155550142");
      expect(row.phoneHmac).toBe(phoneHmac("+14155550142"));
      expect(row.codeHash).not.toContain(code);
      expect(row.verifiedAt).toBeNull();
      expect(row.consentVersion).toBeTruthy();
      // The code text is kept without the code.
      const [stored] = await outbound(userId);
      expect(stored.kind).toBe("code");
      expect(stored.body).not.toContain(code);

      await expect(confirmVerification(userId, "000000", { client })).rejects.toThrow(
        /4 tries left/,
      );
      await confirmVerification(userId, code, { client });
      const verified = await client.textSetting.findUniqueOrThrow({ where: { userId } });
      expect(verified.verifiedAt).not.toBeNull();
      expect(verified.codeHash).toBeNull();
      expect(logAudit).toHaveBeenCalledWith({ type: "user", id: userId }, "text_number_verified", {
        type: "user",
        id: userId,
      });
      // A welcome text says how to stop.
      expect(await lastBody(userId)).toMatch(/STOP to stop/);
    });

    it("needs consent and a US number", async () => {
      const userId = await person();
      await expect(
        startVerification(userId, { phone: "(415) 555-0142", consent: false }, { client, send }),
      ).rejects.toBeInstanceOf(TextError);
      await expect(
        startVerification(userId, { phone: "+44 20 7946 0958", consent: true }, { client, send }),
      ).rejects.toBeInstanceOf(TextError);
      expect(send).not.toHaveBeenCalled();
    });

    it("expires after 10 minutes", async () => {
      const userId = await person();
      const now = new Date();
      await startVerification(userId, { phone: fakePhone(), consent: true }, { client, send, now });
      const code = /code is (\d{6})/.exec(sent[0].body)![1];
      await expect(
        confirmVerification(userId, code, { client, now: new Date(now.getTime() + 11 * MINUTE) }),
      ).rejects.toThrow(/expired/);
    });

    it("allows 5 tries, then needs a new code", async () => {
      const userId = await person();
      await startVerification(userId, { phone: fakePhone(), consent: true }, { client, send });
      const code = /code is (\d{6})/.exec(sent[0].body)![1];
      const wrong = code === "111111" ? "222222" : "111111";
      for (let i = 0; i < 5; i++) {
        await expect(confirmVerification(userId, wrong, { client })).rejects.toBeInstanceOf(
          TextError,
        );
      }
      // Even the right code is refused now.
      await expect(confirmVerification(userId, code, { client })).rejects.toThrow(/new code/);
    });

    it("limits how many codes are sent", async () => {
      const userId = await person();
      const phone = fakePhone();
      for (let i = 0; i < 3; i++) {
        await startVerification(userId, { phone, consent: true }, { client, send });
      }
      await expect(
        startVerification(userId, { phone, consent: true }, { client, send }),
      ).rejects.toThrow(/lot of codes/);
      expect(send).toHaveBeenCalledTimes(3);
    });

    it("keeps a number to one account", async () => {
      const first = await person();
      const phone = await verifiedNumber(client, first);
      const second = await person();
      await startVerification(second, { phone, consent: true }, { client, send });
      const code = /code is (\d{6})/.exec(sent[0].body)![1];
      await expect(confirmVerification(second, code, { client })).rejects.toThrow(
        /another Jane account/,
      );
    });
  });

  describe("what gets texted", () => {
    it("sends nothing before the number is verified, or for a kind turned off", async () => {
      const userId = await person();
      expect(await textNeedsYou(userId, "Refund", { client })).toBe(false);
      await verifiedNumber(client, userId);
      await saveTextPrefs(
        userId,
        { enabled: true, alerts: false, weeklyPlan: true, needsYou: true },
        { client },
      );
      expect(await textAlert(userId, { type: "low_balance", title: "Checking" }, { client })).toBe(
        false,
      );
      expect(await textNeedsYou(userId, "Refund from Comcast", { client })).toBe(true);
      expect(await lastBody(userId)).toContain("/actions");
    });

    it("waits for morning in quiet hours, even when the queue runs at night", async () => {
      const userId = await person(nightZone());
      await verifiedNumber(client, userId);
      const now = new Date();
      const id = await textAlert(userId, { type: "low_balance", title: "Checking" }, { client });
      expect(id).toBe(true);
      const [message] = await outbound(userId);
      expect(message.status).toBe("queued");
      expect(message.sendAfter!.getTime()).toBeGreaterThan(now.getTime());
      const job = await client.job.findFirstOrThrow({
        where: { kind: "text_send", payload: { path: ["messageId"], equals: message.id } },
      });
      expect(job.runAt.getTime()).toBe(message.sendAfter!.getTime());
      // Run early (at night) anyway: it waits again rather than sending.
      expect(await deliverText(userId, message.id, { client, send })).toBe("waiting");
      expect(send).not.toHaveBeenCalled();
    });

    it("stops queued texts at once when texts are turned off or the number removed", async () => {
      const userId = await person(nightZone());
      await verifiedNumber(client, userId);
      await textNeedsYou(userId, "Refund", { client });
      const [message] = await outbound(userId);
      await saveTextPrefs(
        userId,
        { enabled: false, alerts: true, weeklyPlan: true, needsYou: true },
        { client },
      );
      expect(await deliverText(userId, message.id, { client, send })).toBe("skipped");
      expect((await outbound(userId))[0].status).toBe("skipped");
      expect(logAudit).toHaveBeenCalledWith(
        { type: "user", id: userId },
        "text_opt_out",
        { type: "user", id: userId },
        { via: "settings" },
      );

      const other = await person(nightZone());
      await verifiedNumber(client, other);
      await textNeedsYou(other, "Refund", { client });
      const [queued] = await outbound(other);
      await removeTextNumber(other, { client });
      expect(await deliverText(other, queued.id, { client, send })).toBe("skipped");
      expect(send).not.toHaveBeenCalled();
    });

    it("plans only no-risk items, numbered, once a week", async () => {
      const userId = await person();
      await verifiedNumber(client, userId);
      expect(await sendPlanText(userId, { client })).toBe("sent");
      const plan = (await outbound(userId)).find((m) => m.kind === "plan")!;
      const items = plan.items as { findingId: string; cardHash: string; title: string }[];
      // The fee refund and the double charge; never the call, the cash move or a cancellation.
      expect(items).toHaveLength(2);
      const types = await client.finding.findMany({
        where: { id: { in: items.map((i) => i.findingId) } },
        select: { type: true },
      });
      expect(types.map((t) => t.type).sort()).toEqual(["bank_fees", "duplicate_charge"]);
      expect(plan.body).toMatch(/^Jane's plan this week:\n1\) .+\n2\) .+\nReply YES for all/);
      expect(plan.expiresAt!.getTime()).toBeGreaterThan(Date.now() + 6 * 24 * HOUR);
      expect(plan.status).toBe("delivered");
      expect(await sendPlanText(userId, { client })).toBe("already");
    });

    it("sends the weekly plan to everyone with plan texts on, and nobody else", async () => {
      const on = await person();
      await verifiedNumber(client, on);
      const off = await person();
      await verifiedNumber(client, off);
      await saveTextPrefs(
        off,
        { enabled: true, alerts: true, weeklyPlan: false, needsYou: true },
        { client },
      );
      await runPlanTexts({ client });
      expect((await outbound(on)).some((m) => m.kind === "plan")).toBe(true);
      expect((await outbound(off)).some((m) => m.kind === "plan")).toBe(false);
    });
  });

  describe("STOP and START", () => {
    it("STOP turns texts off at once and confirms; START turns them back on", async () => {
      const userId = await person();
      const phone = await verifiedNumber(client, userId);
      await sendPlanText(userId, { client });

      expect(await inbound(phone, "STOP")).toBe("stop");
      const stopped = await client.textSetting.findUniqueOrThrow({ where: { userId } });
      expect(stopped.enabled).toBe(false);
      expect(stopped.optedOutAt).not.toBeNull();
      expect(await lastBody(userId)).toMatch(/won't get any more texts/);
      expect(logAudit).toHaveBeenCalledWith(
        { type: "user", id: userId },
        "text_opt_out",
        { type: "user", id: userId },
        { via: "text" },
      );
      // Nothing more is sent, and a YES now does nothing.
      expect(await textNeedsYou(userId, "Refund", { client })).toBe(false);
      expect(await inbound(phone, "YES")).toBe("texts_off");
      expect(await client.decision.count({ where: { userId } })).toBe(0);
      // Only START (not the settings page) turns them back on.
      await expect(
        saveTextPrefs(
          userId,
          { enabled: true, alerts: true, weeklyPlan: true, needsYou: true },
          { client },
        ),
      ).rejects.toThrow(/START/);
      // HELP is still answered.
      expect(await inbound(phone, "HELP")).toBe("help");
      expect(await lastBody(userId)).toMatch(/STOP to stop/);

      expect(await inbound(phone, "START")).toBe("start");
      const started = await client.textSetting.findUniqueOrThrow({ where: { userId } });
      expect(started.enabled).toBe(true);
      expect(started.optedOutAt).toBeNull();
      expect(await textNeedsYou(userId, "Refund", { client })).toBe(true);
    });
  });

  describe("UNDO", () => {
    it("takes back a text approval within the hour, not after", async () => {
      const userId = await person();
      const phone = await verifiedNumber(client, userId);
      await sendPlanText(userId, { client });
      expect(await inbound(phone, "YES")).toBe("yes");
      expect(await lastBody(userId)).toMatch(/start on 2 things in an hour/);
      expect(await inbound(phone, "UNDO")).toBe("undo");
      expect(await lastBody(userId)).toMatch(/Taken back: 2 things/);
      expect(await client.action.count({ where: { userId } })).toBe(0);
      expect(await inbound(phone, "UNDO")).toBe("undo");
      expect(await lastBody(userId)).toMatch(/nothing to take back/);
    });

    it("can't take back after the hour", async () => {
      const userId = await person();
      const phone = await verifiedNumber(client, userId);
      await sendPlanText(userId, { client });
      await inbound(phone, "1");
      // An hour and a bit later.
      await client.decision.updateMany({
        where: { userId },
        data: { createdAt: new Date(Date.now() - 2 * HOUR) },
      });
      expect(await inbound(phone, "UNDO")).toBe("undo");
      expect(await lastBody(userId)).toMatch(/can't be taken back anymore/);
      expect(await client.action.count({ where: { userId } })).toBe(1);
    });
  });

  it("answers anything else with how to reply, and never acts on it", async () => {
    const userId = await person();
    const phone = await verifiedNumber(client, userId);
    await sendPlanText(userId, { client });
    expect(await inbound(phone, "yes please cancel my gym")).toBe("other");
    expect(await lastBody(userId)).toMatch(/^Reply YES, the numbers, or NO\. Questions\?/);
    expect(await client.decision.count({ where: { userId } })).toBe(0);
    // Numbers outside the plan aren't guessed at.
    expect(await inbound(phone, "1 7")).toBe("numbers");
    expect(await lastBody(userId)).toMatch(/numbers from 1 to 2/);
    expect(await client.decision.count({ where: { userId } })).toBe(0);
    // NO closes the plan text without deciding anything.
    expect(await inbound(phone, "NO")).toBe("no");
    expect(await inbound(phone, "YES")).toBe("yes");
    expect(await lastBody(userId)).toMatch(/no plan waiting/);
    expect(await client.decision.count({ where: { userId } })).toBe(0);
  });

  it("runs the whole loop: verify, plan text, reply 1, one held decision, UNDO", async () => {
    const userId = await person(daytimeZone());
    const phone = fakePhone();
    await startVerification(userId, { phone, consent: true }, { client, send });
    const code = /code is (\d{6})/.exec(sent[0].body)![1];
    await confirmVerification(userId, code, { client });

    expect(await sendPlanText(userId, { client })).toBe("sent");
    const plan = (await outbound(userId)).find((m) => m.kind === "plan")!;
    const [first] = plan.items as { findingId: string }[];

    expect(await inbound(phone, "1")).toBe("numbers");
    const decisions = await client.decision.findMany({ where: { userId } });
    expect(decisions).toHaveLength(1);
    expect(decisions[0]).toMatchObject({
      source: "text",
      choice: "yes",
      findingId: first.findingId,
    });
    expect(await lastBody(userId)).toMatch(/start on 1 thing in an hour\. Reply UNDO/);
    expect(logAudit).toHaveBeenCalledWith(
      { type: "user", id: userId },
      "text_approval",
      { type: "user", id: userId },
      { approved: 1, skipped: 0, chosen: 1, offered: 2 },
    );
    // The agent waits out the hour to take it back.
    const job = await client.job.findFirstOrThrow({
      where: { kind: "agent_step", payload: { path: ["userId"], equals: userId } },
    });
    expect(job.runAt.getTime()).toBeGreaterThan(Date.now() + 0.9 * HOUR);
    expect(await runJob(job.id, { client })).toBe("not_due");
    // The plan text works once.
    expect(await inbound(phone, "2")).toBe("numbers");
    expect(await client.decision.count({ where: { userId } })).toBe(1);

    expect(await inbound(phone, "UNDO")).toBe("undo");
    expect(await client.action.count({ where: { userId } })).toBe(0);
    const finding = await client.finding.findUniqueOrThrow({ where: { id: first.findingId } });
    expect(finding.status).toBe("shown");
    // Every text was recorded, both ways.
    const all = await client.textMessage.findMany({ where: { userId } });
    expect(all.filter((m) => m.direction === "inbound").map((m) => m.kind)).toEqual(
      expect.arrayContaining(["numbers", "undo"]),
    );
  });

  it("queues a text through the jobs queue, so a failure is retried", async () => {
    const userId = await person();
    await verifiedNumber(client, userId);
    const failing = vi.fn(async () => {
      throw new Error("Sendblue unreachable");
    });
    const id = await queueText(userId, "needs_you", "Jane needs you", { client, send: failing });
    const message = await client.textMessage.findUniqueOrThrow({ where: { id: id! } });
    expect(message.status).toBe("queued");
    expect(message.lastError).toMatch(/unreachable/);
    const job = await client.job.findFirstOrThrow({
      where: { kind: "text_send", payload: { path: ["messageId"], equals: id! } },
    });
    expect(job.status).toBe("queued");
    expect(job.attempts).toBe(1);
  });
});
