import { randomBytes } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import type { PlaidApi } from "plaid";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient, type Prisma } from "@/generated/prisma/client";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn(), SYSTEM_ACTOR: { type: "system", id: null } }));

import { CHAT_DAILY_LIMIT } from "@/config/agent-chat";
import { NEVER_BY_RULE } from "@/config/rules";
import { track } from "@/lib/analytics";
import { logAudit } from "@/lib/audit";
import { findingOfType } from "@/lib/__fixtures__/findings";
import { linkDemoBank } from "@/lib/plaid/demo";
import { syncItem } from "@/lib/plaid/sync";
import { applyStandingRules, saveRules } from "@/lib/standing-rules";
import { CARD_SELECT, buildCard, cardHash } from "@/lib/cards";
import { recordDecision } from "@/lib/decisions";
import { ChatActionError, takeChatAction } from "./actions";
import { BUNDLED_UNTIL, closeSettled, messageAboutFinding } from "./messages";
import { openChat } from "./open";
import { runJaneAgent } from "./run";
import { parseActions, parseRefs } from "./types";

// Spec steps 81–82 against a real, migrated Postgres (see
// src/detection/engine.integration.test.ts): the demo bank's first sync posts Jane's
// messages, a second run repeats nothing, and each button works through the app's own code,
// only on the person's own open message.

const url = process.env.TEST_DATABASE_URL;
// 8am in Los Angeles (the default timezone): after quiet hours.
const LINKED = new Date("2026-10-18T15:00:00Z");
const SECOND = 1000;
const HOUR = 60 * 60 * SECOND;

describe.runIf(url)("Jane's chat against a real database", () => {
  let client: PrismaClient;
  const created: string[] = [];
  // Any call to real Plaid fails the test.
  const plaid = new Proxy(
    {},
    {
      get: () => () => {
        throw new Error("The demo bank must never call Plaid");
      },
    },
  ) as PlaidApi;

  async function person(prefix: string) {
    const user = await client.user.create({
      data: { email: `${prefix}-${crypto.randomUUID()}@example.com` },
    });
    created.push(user.id);
    return user.id;
  }

  // Read-only mode leaves real accounts alone: tests of what Jane does for someone make the
  // person's data the demo bank's (a demo item, its accounts the demo bank's).
  async function asDemoBank(userId: string) {
    await client.plaidItem.create({
      data: { userId, plaidItemId: `demo-${crypto.randomUUID()}`, accessTokenEncrypted: "test" },
    });
    await client.account.updateMany({ where: { userId }, data: { source: "plaid" } });
  }

  const messagesOf = (userId: string) =>
    client.janeMessage.findMany({ where: { userId }, orderBy: { createdAt: "asc" } });

  const buttonIds = (m: { actions: unknown }) => parseActions(m.actions).map((a) => a.id);
  // What the chat shows: not what's hidden behind the agenda or a bundle.
  const visible = <T extends { snoozedUntil: Date | null }>(messages: T[]) =>
    messages.filter((m) => m.snoozedUntil?.getTime() !== BUNDLED_UNTIL.getTime());

  beforeAll(() => {
    vi.stubEnv("TOKEN_ENCRYPTION_KEY", randomBytes(32).toString("base64"));
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    vi.stubEnv("PLAID_CLIENT_ID", "");
    vi.stubEnv("PLAID_SECRET", "");
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
  });
  afterAll(async () => {
    await client.user.deleteMany({ where: { id: { in: created } } });
    await client.$disconnect();
    vi.unstubAllEnvs();
  });

  describe("with the demo bank", () => {
    let userId: string;

    beforeAll(async () => {
      userId = await person("chat-demo");
      const { itemId } = await linkDemoBank(userId, { client, now: LINKED });
      await syncItem(itemId, { client, api: plaid, now: LINKED });
    }, 120_000);

    // Spec step 184: the day in one message. The agenda lists the findings and the week's
    // plan, each still posted (hidden behind it) with its own buttons.
    it("posts the day's agenda after the first sync, with the findings and the plan behind it", async () => {
      const messages = await messagesOf(userId);
      // No first-run hello any more (founder, 2026-10-26): the agenda comes first.
      expect(messages.some((m) => m.dedupeKey === "welcome:hello")).toBe(false);
      expect(messages[0]).toMatchObject({ kind: "brief", dedupeKey: "brief:2026-10-18" });
      expect(messages[0].body).toMatch(/^Good morning! You have \$[\d,]+\.\d\d safe to spend/);
      expect(messages[0].body).toContain("need your yes:");
      expect(buttonIds(messages[0])).toEqual(
        expect.arrayContaining(["bundle.1", "plan.approve_safe", "open"]),
      );
      const plan = messages.find((m) => m.dedupeKey.startsWith("plan:"));
      expect(plan?.body).toMatch(/^Your plan for this week is ready: \d+ things, worth up to/);
      expect(buttonIds(plan!)).toEqual(["plan.approve_safe", "open"]);
      const findings = messages.filter((m) => m.dedupeKey.startsWith("findings:"));
      expect(findings.length).toBeGreaterThanOrEqual(1);
      for (const f of findings) {
        expect(buttonIds(f)).toEqual(expect.arrayContaining(["finding.yes", "finding.no", "open"]));
        expect(f.snoozedUntil).toEqual(BUNDLED_UNTIL);
      }
      // What shows: the agenda, the autopilot question (spec step 83), an unusual
      // charge (step 208, uncapped; the demo bank's Apple Store charge is one) and
      // anything urgent; all open.
      expect(visible(messages).length).toBeLessThanOrEqual(CHAT_DAILY_LIMIT + 4);
      expect(messages.every((m) => m.status === "open")).toBe(true);
    });

    it("posts nothing twice: not on a second run the same day, nor the next day", async () => {
      const before = await messagesOf(userId);
      expect(
        await runJaneAgent(userId, { client, now: new Date(LINKED.getTime() + HOUR) }),
      ).toEqual({ posted: 0 });
      // The next morning: a new brief and more findings, never one already posted.
      const nextDay = new Date(LINKED.getTime() + 24 * HOUR);
      const { posted } = await runJaneAgent(userId, { client, now: nextDay });
      expect(posted).toBeGreaterThan(0);
      expect(track).toHaveBeenCalledWith(userId, "chat_message_posted", {
        kind: "brief",
        source: "brief",
      });
      const after = await messagesOf(userId);
      expect(visible(after)).toHaveLength(visible(before).length + posted);
      expect(new Set(after.map((m) => m.dedupeKey)).size).toBe(after.length);
      expect(after.filter((m) => m.kind === "brief").map((m) => m.dedupeKey)).toEqual([
        "brief:2026-10-18",
        "brief:2026-10-19",
      ]);
    });

    it("records a Yes as the person's own decision from the chat, once", async () => {
      const message = (await messagesOf(userId)).find(
        (m) => m.status === "open" && buttonIds(m).includes("finding.yes"),
      )!;
      const { findingId } = parseRefs(message.refs);

      const { message: answered } = await takeChatAction(userId, message.id, "finding.yes", {
        client,
      });
      expect(answered).toMatchObject({ status: "answered", answeredWith: "Yes" });
      expect(answered.actions.every((a) => a.kind === "link")).toBe(true);
      const decision = await client.decision.findFirstOrThrow({ where: { userId, findingId } });
      expect(decision).toMatchObject({ choice: "yes", source: "chat" });
      expect(await client.action.count({ where: { decisionId: decision.id } })).toBe(1);
      expect(logAudit).toHaveBeenCalledWith(
        { type: "user", id: userId },
        "chat_action_taken",
        { type: "jane_message", id: message.id },
        { action: "finding.yes", kind: "decision" },
      );

      // A second tap on a message no longer open is refused.
      await expect(
        takeChatAction(userId, message.id, "finding.yes", { client }),
      ).rejects.toMatchObject({ code: "not_open" });
      expect(await client.decision.count({ where: { userId, findingId } })).toBe(1);
    });

    it("refuses another person's message and buttons a message doesn't offer", async () => {
      const message = (await messagesOf(userId)).find(
        (m) => m.status === "open" && buttonIds(m).includes("finding.no"),
      )!;
      const stranger = await person("chat-stranger");
      await expect(
        takeChatAction(stranger, message.id, "finding.no", { client }),
      ).rejects.toMatchObject({ code: "not_found" });
      await expect(
        takeChatAction(userId, message.id, "plan.approve_safe", { client }),
      ).rejects.toMatchObject({ code: "not_offered" });
      await expect(takeChatAction(userId, message.id, "open", { client })).rejects.toBeInstanceOf(
        ChatActionError,
      );
      await expect(
        takeChatAction(userId, "not a real id!", "finding.no", { client }),
      ).rejects.toMatchObject({ code: "not_found" });
      expect(
        (await client.janeMessage.findUniqueOrThrow({ where: { id: message.id } })).status,
      ).toBe("open");
    });

    it("takes back a No within seconds, and not after", async () => {
      const [first] = (await messagesOf(userId)).filter(
        (m) => m.status === "open" && buttonIds(m).includes("finding.no"),
      );
      const { message: declined } = await takeChatAction(userId, first.id, "finding.no", {
        client,
      });
      expect(declined).toMatchObject({ status: "answered", answeredWith: "No" });
      expect(declined.actions.map((a) => a.id)).toEqual(["undo.no", "open"]);
      const { message: undone } = await takeChatAction(userId, first.id, "undo.no", { client });
      expect(undone).toMatchObject({ status: "open", answeredWith: null });
      expect(undone.actions.map((a) => a.id)).toEqual(buttonIds(first));
      const findingId = parseRefs(first.refs).findingId;
      expect((await client.finding.findUniqueOrThrow({ where: { id: findingId } })).status).toBe(
        "shown",
      );

      // A No again, taken back too late.
      await takeChatAction(userId, first.id, "finding.no", { client });
      await expect(
        takeChatAction(userId, first.id, "undo.no", {
          client,
          now: new Date(Date.now() + 20 * SECOND),
        }),
      ).rejects.toMatchObject({ code: "expired" });
    });

    it("approves only the safe ones from the plan: never cancellations, calls or moving money", async () => {
      const plan = (await messagesOf(userId)).find((m) => m.dedupeKey.startsWith("plan:"))!;
      const before = await client.decision.count({ where: { userId } });
      const { message } = await takeChatAction(userId, plan.id, "plan.approve_safe", { client });
      expect(message.answeredWith).toBe("Approve all safe ones");
      expect(message.refs.note).toMatch(/^Approved \d+ things?\. I'm on it\./);

      const approved = await client.decision.findMany({
        where: { userId, source: "chat", choice: "yes" },
        include: { action: { select: { type: true } } },
        orderBy: { createdAt: "asc" },
      });
      const fromPlan = approved.slice(
        approved.length - ((await client.decision.count({ where: { userId } })) - before),
      );
      expect(fromPlan.length).toBeGreaterThan(0);
      for (const d of fromPlan) expect(NEVER_BY_RULE).not.toContain(d.action!.type);

      // The findings it approved no longer offer Yes in the chat.
      const settled = new Set(fromPlan.map((d) => d.findingId));
      for (const m of await messagesOf(userId)) {
        const findingId = parseRefs(m.refs).findingId;
        if (findingId && settled.has(findingId)) {
          expect(m.status).toBe("answered");
          expect(buttonIds(m)).toEqual(["open"]);
        }
      }
    });

    it("opens the chat without running again once Jane posted today", async () => {
      const count = visible(await messagesOf(userId)).length;
      const chat = await openChat(userId, { client, now: new Date(LINKED.getTime() + 25 * HOUR) });
      expect(chat?.messages).toHaveLength(count);
      expect(chat?.hasEarlier).toBe(false);
    });
  });

  describe("without the demo bank", () => {
    async function withFindings(types: Parameters<typeof findingOfType>[0][]) {
      const userId = await person("chat-plain");
      await client.account.create({
        data: { userId, source: "csv", name: "Checking", type: "depository", subtype: "checking" },
      });
      for (const type of types) {
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
      return userId;
    }

    it("leaves people without accounts alone", async () => {
      const userId = await person("chat-empty");
      expect(await runJaneAgent(userId, { client, trigger: "open" })).toEqual({ posted: 0 });
      expect(await openChat(userId, { client })).toBeNull();
    });

    it("posts on the first visit of the day, even in quiet hours", async () => {
      const userId = await withFindings(["bank_fees"]);
      // 3am in Los Angeles.
      const night = new Date("2026-10-18T10:00:00Z");
      expect(await runJaneAgent(userId, { client, now: night, trigger: "sync" })).toEqual({
        posted: 0,
      });
      const chat = await openChat(userId, { client, now: night });
      // The day's agenda (spec step 184, with the plan and the finding on it); no first-run
      // hello any more, and no autopilot question for a real account, where Jane does nothing
      // on its own (read-only beta).
      expect(chat?.messages.map((m) => m.kind)).toEqual(["brief"]);
      expect(chat?.messages[0].body).toMatch(/needs your yes:/);
    });

    it("refuses a Yes once the finding changed since the message", async () => {
      const userId = await withFindings(["bank_fees"]);
      await runJaneAgent(userId, { client, trigger: "open" });
      const message = (await messagesOf(userId)).find((m) => m.dedupeKey.startsWith("findings:"))!;
      await client.finding.updateMany({
        where: { userId },
        data: { annualSavingsCents: 99_999 },
      });
      await expect(
        takeChatAction(userId, message.id, "finding.yes", { client }),
      ).rejects.toMatchObject({ code: "failed" });
      expect(await client.decision.count({ where: { userId } })).toBe(0);
    });

    // Spec step 86: answering on the page or in the chat shows the same answer in both.
    it("shows an answer given on the finding's page in the chat, and links the page back", async () => {
      const userId = await withFindings(["bank_fees"]);
      await runJaneAgent(userId, { client, trigger: "open" });
      const message = (await messagesOf(userId)).find((m) => m.dedupeKey.startsWith("findings:"))!;
      const findingId = parseRefs(message.refs).findingId!;
      expect(await messageAboutFinding(userId, findingId, { client })).toBe(message.id);
      expect(await messageAboutFinding("someone-else", findingId, { client })).toBeNull();

      const finding = await client.finding.findUniqueOrThrow({
        where: { id: findingId },
        select: CARD_SELECT,
      });
      await recordDecision(
        userId,
        { findingId, choice: "no", cardHash: cardHash(buildCard(finding)), source: "card" },
        { client },
      );
      await closeSettled(userId, { client });
      const after = await client.janeMessage.findUniqueOrThrow({ where: { id: message.id } });
      expect(after).toMatchObject({ status: "answered", answeredWith: "No" });
      expect(parseRefs(after.refs).note).toBe("You answered this on its page.");
      expect(buttonIds(after)).toEqual(["open"]);
    });

    it("says what a standing rule approved, with Undo for a day only", async () => {
      const userId = await withFindings(["bank_fees", "bank_fees"]);
      await asDemoBank(userId);
      await saveRules(
        userId,
        [{ key: "recover_bank_fees", enabled: true, monthlyLimit: 3, maxAnnualCents: null }],
        { client },
      );
      const approvals = await applyStandingRules(userId, { client });
      expect(approvals).toHaveLength(2);
      await runJaneAgent(userId, { client, trigger: "open" });
      const done = (await messagesOf(userId)).filter((m) => m.kind === "done");
      expect(done).toHaveLength(2);
      expect(done.every((m) => buttonIds(m).includes("undo.rule"))).toBe(true);

      const { message } = await takeChatAction(userId, done[0].id, "undo.rule", { client });
      expect(message).toMatchObject({ status: "answered", answeredWith: "Undo" });
      const undone = await client.decision.findUniqueOrThrow({
        where: { id: parseRefs(done[0].refs).decisionId },
      });
      expect(undone.undoneAt).not.toBeNull();

      await expect(
        takeChatAction(userId, done[1].id, "undo.rule", {
          client,
          now: new Date(Date.now() + 25 * HOUR),
        }),
      ).rejects.toMatchObject({ code: "expired" });
      expect(
        (
          await client.decision.findUniqueOrThrow({
            where: { id: parseRefs(done[1].refs).decisionId },
          })
        ).undoneAt,
      ).toBeNull();
    });
  });
});
