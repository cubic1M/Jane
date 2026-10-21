import { randomBytes } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import type { PlaidApi } from "plaid";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient, type Prisma } from "@/generated/prisma/client";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn(), SYSTEM_ACTOR: { type: "system", id: null } }));

import { AUTOPILOT_LEVELS } from "@/config/autopilot";
import { logAudit } from "@/lib/audit";
import { findingOfType } from "@/lib/__fixtures__/findings";
import { setAutopilot } from "@/lib/autopilot";
import { CARD_SELECT, buildCard, cardHash } from "@/lib/cards";
import { recordDecision } from "@/lib/decisions";
import { addDeadline } from "@/lib/deadlines";
import { linkDemoBank } from "@/lib/plaid/demo";
import { syncItem } from "@/lib/plaid/sync";
import { answerProposal } from "@/lib/proposals";
import { takeChatAction } from "./actions";
import { openChat } from "./open";
import { AS_THEY_COME } from "./preferences";
import { runJaneAgent } from "./run";
import { startOfTomorrow } from "./snooze";
import { parseActions, parseRefs, type ActionId } from "./types";

// Spec step 83 against a real, migrated Postgres (see
// src/detection/engine.integration.test.ts): the rest of Jane from the chat. The demo
// bank's first day asks how much Jane should do on its own, and "Handle the safe stuff"
// sets the standing rules; a budget suggestion is set up and a deadline marked done from
// the chat. Then each new button: it works through the feature's own code, refuses another
// person's message and refuses a message whose thing was already answered elsewhere.

const url = process.env.TEST_DATABASE_URL;
// 8am in Los Angeles (the default timezone): after quiet hours.
const LINKED = new Date("2026-10-18T15:00:00Z");
const DAY = 24 * 60 * 60 * 1000;
const day = (n: number) => new Date(LINKED.getTime() + n * DAY);
const isoDay = (d: Date) => d.toISOString().slice(0, 10);

describe.runIf(url)("everything from Jane's chat, against a real database", () => {
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

  // Each message on its own (spec step 184's "as they come"): these tests are about each
  // kind of message's buttons. The day's agenda is in ./agent.integration.test.ts.
  async function person(prefix: string) {
    const user = await client.user.create({
      data: { email: `${prefix}-${crypto.randomUUID()}@example.com`, name: "Alex Rivera" },
    });
    created.push(user.id);
    await client.janePreference.create({
      data: { userId: user.id, ...AS_THEY_COME, value: AS_THEY_COME.value },
    });
    return user.id;
  }

  // Someone with an account (so Jane talks to them) and nothing else.
  async function plainPerson(prefix: string) {
    const userId = await person(prefix);
    await client.account.create({
      data: { userId, source: "csv", name: "Checking", type: "depository", subtype: "checking" },
    });
    return userId;
  }

  const messagesOf = (userId: string) =>
    client.janeMessage.findMany({ where: { userId }, orderBy: { createdAt: "asc" } });
  const buttonIds = (m: { actions: unknown }) => parseActions(m.actions).map((a) => a.id);
  const withButton = async (userId: string, id: ActionId) =>
    (await messagesOf(userId)).filter((m) => m.status === "open" && buttonIds(m).includes(id));
  const reloadMessage = (id: string) => client.janeMessage.findUniqueOrThrow({ where: { id } });
  const talk = (userId: string, now = LINKED) =>
    runJaneAgent(userId, { client, now, trigger: "open" });

  // An approved finding whose action is waiting on the person for one step.
  async function waitingAction(
    userId: string,
    type: "bill_negotiation" | "subscription_review",
    data: Prisma.ActionUpdateInput,
  ) {
    const f = findingOfType(type);
    const finding = await client.finding.create({
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
      select: CARD_SELECT,
    });
    const { actionId } = await recordDecision(
      userId,
      { findingId: finding.id, choice: "yes", cardHash: cardHash(buildCard(finding)) },
      { client },
    );
    await client.action.update({
      where: { id: actionId! },
      data: { status: "waiting_on_user", ...data },
    });
    return actionId!;
  }

  beforeAll(() => {
    vi.stubEnv("TOKEN_ENCRYPTION_KEY", randomBytes(32).toString("base64"));
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    vi.stubEnv("PLAID_CLIENT_ID", "");
    vi.stubEnv("PLAID_SECRET", "");
    vi.stubEnv("RESEND_API_KEY", "");
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
      userId = await person("chat83-demo");
      const { itemId } = await linkDemoBank(userId, { client, now: LINKED });
      await syncItem(itemId, { client, api: plaid, now: LINKED });
    }, 120_000);

    it("asks how much to do on its own; Handle the safe stuff sets the standing rules", async () => {
      const [question] = await withButton(userId, "autopilot.safe");
      expect(question.body).toMatch(/^How much should I do on my own\?\n/);
      expect(buttonIds(question)).toEqual([
        "autopilot.safe",
        "autopilot.all",
        "autopilot.ask",
        "open",
      ]);
      // Alongside the findings, not instead of them. (The demo card's minimum now covers its
      // interest, so one fewer finding than before.)
      expect((await withButton(userId, "finding.yes")).length).toBeGreaterThanOrEqual(1);

      const stranger = await person("chat83-stranger");
      await expect(
        takeChatAction(stranger, question.id, "autopilot.safe", { client }),
      ).rejects.toMatchObject({ code: "not_found" });

      const { message, agentActionIds } = await takeChatAction(
        userId,
        question.id,
        "autopilot.safe",
        { client, now: LINKED },
      );
      expect(message).toMatchObject({ status: "answered", answeredWith: "Handle the safe stuff" });
      expect(message.refs.note).toMatch(/^Done\. I'll handle the safe stuff on my own/);
      expect(Array.isArray(agentActionIds)).toBe(true);
      expect((await client.user.findUniqueOrThrow({ where: { id: userId } })).autopilot).toBe(
        "safe",
      );
      const rules = await client.standingRule.findMany({ where: { userId, enabled: true } });
      expect(rules.map((r) => r.key).sort()).toEqual(
        Object.keys(AUTOPILOT_LEVELS.safe.rules).sort(),
      );
      expect(logAudit).toHaveBeenCalledWith(
        { type: "user", id: userId },
        "chat_action_taken",
        { type: "jane_message", id: question.id },
        { action: "autopilot.safe", kind: "decision" },
      );

      // A tap handed a defer returns before the audit row; the work runs when the caller says.
      const second = await person("chat83-defer");
      const ask = await client.janeMessage.create({
        data: {
          userId: second,
          kind: "heads_up",
          body: "Something to look at.",
          dedupeKey: "defer-test",
          actions: [{ id: "snooze", label: "Not now", kind: "secondary" }],
        },
      });
      vi.mocked(logAudit).mockClear();
      const later: (() => Promise<unknown>)[] = [];
      await takeChatAction(second, ask.id, "snooze", {
        client,
        now: LINKED,
        defer: (work) => later.push(work),
      });
      expect(logAudit).not.toHaveBeenCalled();
      for (const work of later) await work();
      expect(logAudit).toHaveBeenCalledWith(
        { type: "user", id: second },
        "chat_action_taken",
        { type: "jane_message", id: ask.id },
        { action: "snooze", kind: "heads_up" },
      );

      // Once only: the same tap again is refused, and Jane never asks again.
      await expect(
        takeChatAction(userId, question.id, "autopilot.ask", { client }),
      ).rejects.toMatchObject({ code: "not_open" });
      await runJaneAgent(userId, { client, now: day(1) });
      expect(
        (await messagesOf(userId)).filter((m) => m.dedupeKey.startsWith("autopilot:")),
      ).toHaveLength(1);
    });

    it("offers a budget suggestion, and Set it up creates the budget", async () => {
      let suggestion = (await withButton(userId, "setup.yes")).find((m) =>
        parseRefs(m.refs).proposalKey?.startsWith("budget:"),
      );
      for (let n = 2; !suggestion && n < 12; n += 1) {
        await runJaneAgent(userId, { client, now: day(n) });
        suggestion = (await withButton(userId, "setup.yes")).find((m) =>
          parseRefs(m.refs).proposalKey?.startsWith("budget:"),
        );
      }
      expect(suggestion?.body).toMatch(/^I could set a \$[\d,.]+ monthly budget for .+ Want me/);
      const key = parseRefs(suggestion!.refs).proposalKey!;
      const category = key.slice("budget:".length);

      const { message } = await takeChatAction(userId, suggestion!.id, "setup.yes", { client });
      expect(message).toMatchObject({ status: "answered", answeredWith: "Set it up" });
      expect(message.refs.note).toBe("Done. It's set up.");
      expect(await client.budget.findFirst({ where: { userId, category } })).not.toBeNull();
      expect((await client.planProposal.findFirstOrThrow({ where: { userId, key } })).status).toBe(
        "accepted",
      );
    });

    it("marks a deadline the person typed in done from its heads-up", async () => {
      let heads: Awaited<ReturnType<typeof withButton>>[number] | undefined;
      for (let n = 12; !heads && n < 20; n += 1) {
        await addDeadline(
          userId,
          { title: `Claim FSA ${n}`, dueOn: isoDay(day(n + 1)), kind: "fsa", note: "" },
          { client, now: day(n) },
        );
        await runJaneAgent(userId, { client, now: day(n) });
        heads = (await withButton(userId, "deadline.done"))[0];
      }
      expect(heads?.body).toMatch(/^Coming up (?:today|tomorrow): Claim FSA \d+\.$/);
      expect(buttonIds(heads!)).toEqual(["deadline.done", "snooze", "open"]);
      const { deadlineEntryId } = parseRefs(heads!.refs);

      const { message } = await takeChatAction(userId, heads!.id, "deadline.done", { client });
      expect(message).toMatchObject({ status: "answered", answeredWith: "Mark done" });
      expect(
        (await client.deadline.findUniqueOrThrow({ where: { id: deadlineEntryId } })).doneAt,
      ).not.toBeNull();
    });
  });

  describe("the autopilot question", () => {
    it("is refused, and loses its buttons, once a level was picked in Settings", async () => {
      const userId = await plainPerson("chat83-auto");
      await talk(userId);
      const [question] = await withButton(userId, "autopilot.all");
      await setAutopilot(userId, "ask", { client });
      await expect(
        takeChatAction(userId, question.id, "autopilot.all", { client }),
      ).rejects.toMatchObject({ code: "not_open" });
      expect((await client.user.findUniqueOrThrow({ where: { id: userId } })).autopilot).toBe(
        "ask",
      );
      await openChat(userId, { client, now: LINKED });
      const closed = await reloadMessage(question.id);
      expect(closed.status).toBe("answered");
      expect(buttonIds(closed)).toEqual(["open"]);
    });
  });

  describe("set-up suggestions", () => {
    async function withSuggestions(prefix: string) {
      const userId = await plainPerson(prefix);
      const proposals = [
        {
          kind: "budget",
          key: "budget:Food and drink",
          category: "Food and drink",
          amountCents: 40_000,
        },
        { kind: "budget", key: "budget:Shopping", category: "Shopping", amountCents: 20_000 },
        {
          kind: "goal",
          key: "goal:yearly_bills",
          name: "Yearly bills",
          targetCents: 120_000,
          targetDate: "2027-10-18",
          monthlySpendingCents: 300_000,
          monthlySetAsideCents: 10_000,
        },
      ];
      for (const p of proposals) {
        await client.planProposal.create({
          data: { userId, key: p.key, kind: p.kind, payload: p as Prisma.InputJsonObject },
        });
      }
      await setAutopilot(userId, "ask", { client });
      await talk(userId);
      const messages = await withButton(userId, "setup.yes");
      const byKey = (key: string) => messages.find((m) => parseRefs(m.refs).proposalKey === key);
      return { userId, messages, byKey };
    }

    it("No keeps the answer, so it isn't suggested again", async () => {
      const { userId, messages } = await withSuggestions("chat83-setup-no");
      expect(messages).toHaveLength(2);
      const [first] = messages;
      const stranger = await person("chat83-stranger");
      await expect(
        takeChatAction(stranger, first.id, "setup.no", { client }),
      ).rejects.toMatchObject({ code: "not_found" });
      const { message } = await takeChatAction(userId, first.id, "setup.no", { client });
      expect(message.refs.note).toBe("OK. I won't suggest it again.");
      const key = parseRefs(first.refs).proposalKey!;
      expect((await client.planProposal.findFirstOrThrow({ where: { userId, key } })).status).toBe(
        "dismissed",
      );
    });

    it("Use all N sets up every open budget and goal, the Yearly bills goal included", async () => {
      const { userId, messages } = await withSuggestions("chat83-setup-all");
      const { message } = await takeChatAction(userId, messages[0].id, "setup.all", { client });
      expect(message).toMatchObject({ answeredWith: "Use all 3 suggestions" });
      expect(message.refs.note).toBe("Done. I set up 3 suggestions.");
      expect(await client.budget.count({ where: { userId } })).toBe(2);
      expect(await client.savingsGoal.count({ where: { userId, name: "Yearly bills" } })).toBe(1);
      // The other suggestion's message lost its buttons.
      expect(buttonIds(await reloadMessage(messages[1].id))).toEqual(["open"]);
    });

    it("is refused once the suggestion was answered on the plan", async () => {
      const { userId, messages } = await withSuggestions("chat83-setup-elsewhere");
      const key = parseRefs(messages[0].refs).proposalKey!;
      await answerProposal(userId, key, false, {}, { client });
      for (const id of ["setup.yes", "setup.all"] as const) {
        await expect(takeChatAction(userId, messages[0].id, id, { client })).rejects.toMatchObject({
          code: "not_open",
        });
      }
      expect(await client.budget.count({ where: { userId } })).toBe(0);
    });
  });

  describe("things waiting on the person", () => {
    it("Accept and Decline answer an offer made on a call, only while it waits", async () => {
      const userId = await plainPerson("chat83-offer");
      const todo = {
        agentState: "confirming" as const,
        userTodo:
          "Comcast offered $95.00 a month with a 12-month contract. Nothing was accepted: say yes or no on your actions page.",
      };
      const accepted = await waitingAction(userId, "bill_negotiation", todo);
      await talk(userId);
      const [offer] = await withButton(userId, "offer.accept");
      expect(offer.body).toContain("12-month contract. Nothing was accepted. Do you want it?");

      const stranger = await person("chat83-stranger");
      await expect(
        takeChatAction(stranger, offer.id, "offer.accept", { client }),
      ).rejects.toMatchObject({ code: "not_found" });
      const { message } = await takeChatAction(userId, offer.id, "offer.accept", { client });
      expect(message.refs.note).toMatch(/^Accepted\./);
      expect(await client.action.findUniqueOrThrow({ where: { id: accepted } })).toMatchObject({
        status: "queued",
        agentState: "handed_off",
      });

      const declined = await waitingAction(userId, "bill_negotiation", todo);
      await talk(userId, new Date(LINKED.getTime() + 60_000));
      const second = (await withButton(userId, "offer.decline")).find(
        (m) => parseRefs(m.refs).actionId === declined,
      )!;
      // Answered on the actions page meanwhile: the chat refuses, and changes nothing.
      await client.action.update({ where: { id: declined }, data: { status: "in_progress" } });
      await expect(
        takeChatAction(userId, second.id, "offer.decline", { client }),
      ).rejects.toMatchObject({ code: "not_open" });
      expect((await client.action.findUniqueOrThrow({ where: { id: declined } })).status).toBe(
        "in_progress",
      );
      await client.action.update({ where: { id: declined }, data: { status: "waiting_on_user" } });
      await takeChatAction(userId, second.id, "offer.decline", { client });
      expect((await client.action.findUniqueOrThrow({ where: { id: declined } })).status).toBe(
        "failed",
      );
    });

    it("gives the cancel page, and I've cancelled starts watching for the next charge", async () => {
      const userId = await plainPerson("chat83-cancel");
      const actionId = await waitingAction(userId, "subscription_review", {
        agentState: "confirming",
        selfServiceUrl: "https://streamwise.example/cancel",
      });
      await talk(userId);
      const [message] = await withButton(userId, "cancel.done");
      expect(parseActions(message.actions)).toContainEqual({
        id: "open",
        label: "Open cancel page",
        kind: "link",
        href: "https://streamwise.example/cancel",
      });
      const stranger = await person("chat83-stranger");
      await expect(
        takeChatAction(stranger, message.id, "cancel.done", { client }),
      ).rejects.toMatchObject({ code: "not_found" });
      const { message: answered } = await takeChatAction(userId, message.id, "cancel.done", {
        client,
      });
      expect(answered.refs.note).toBe("Thanks. I'll watch for the next charge to make sure.");
      const action = await client.action.findUniqueOrThrow({ where: { id: actionId } });
      expect(action.status).toBe("in_progress");
      expect(action.cancelledOn).not.toBeNull();
      await expect(
        takeChatAction(userId, message.id, "cancel.done", { client }),
      ).rejects.toMatchObject({ code: "not_open" });
    });

    it("shows a company's question with Answer, and closes it once answered on Actions", async () => {
      const userId = await plainPerson("chat83-question");
      const actionId = await waitingAction(userId, "subscription_review", {
        agentState: "waiting_reply",
        userTodo:
          "Streamwise asked: What's the email on the account? Answer on your actions page and Jane will reply.",
      });
      await talk(userId);
      const message = (await messagesOf(userId)).find((m) => m.dedupeKey.startsWith("steps:"))!;
      expect(message.body).toContain("Streamwise asked: What's the email on the account?");
      expect(parseActions(message.actions)[0]).toEqual({
        id: "open",
        label: "Answer",
        kind: "link",
        href: `/actions#action-${actionId}`,
      });
      // No generic "I need you for one step" alongside it.
      expect(
        (await messagesOf(userId)).some((m) => m.dedupeKey.startsWith("heads_ups:waiting:")),
      ).toBe(false);
      await client.action.update({ where: { id: actionId }, data: { status: "in_progress" } });
      await openChat(userId, { client, now: LINKED });
      expect(buttonIds(await reloadMessage(message.id))).toEqual(["open"]);
    });
  });

  describe("alerts and Not now", () => {
    async function withAlert(prefix: string) {
      const userId = await plainPerson(prefix);
      const alert = await client.alert.create({
        data: {
          userId,
          type: "large_charge",
          key: crypto.randomUUID(),
          title: "$1,349.00 at Apple",
          body: "Much more than you usually spend there.",
          urgent: true,
        },
      });
      await setAutopilot(userId, "ask", { client });
      await talk(userId);
      const [message] = await withButton(userId, "alert.got_it");
      return { userId, alert, message };
    }

    it("Got it marks the alert read, once", async () => {
      const { userId, alert, message } = await withAlert("chat83-alert");
      const stranger = await person("chat83-stranger");
      await expect(
        takeChatAction(stranger, message.id, "alert.got_it", { client }),
      ).rejects.toMatchObject({ code: "not_found" });
      await takeChatAction(userId, message.id, "alert.got_it", { client });
      expect(
        (await client.alert.findUniqueOrThrow({ where: { id: alert.id } })).readAt,
      ).not.toBeNull();
    });

    it("is refused once the alert was read on Alerts", async () => {
      const { userId, alert, message } = await withAlert("chat83-alert-read");
      await client.alert.update({ where: { id: alert.id }, data: { readAt: new Date() } });
      await expect(
        takeChatAction(userId, message.id, "alert.got_it", { client }),
      ).rejects.toMatchObject({ code: "not_open" });
    });

    it("Not now hides it until tomorrow, then Jane brings it back with its buttons", async () => {
      const { userId, message } = await withAlert("chat83-snooze");
      const { message: snoozed } = await takeChatAction(userId, message.id, "snooze", {
        client,
        now: LINKED,
      });
      expect(snoozed).toMatchObject({ status: "dismissed", answeredWith: "Not now" });
      expect((await reloadMessage(message.id)).snoozedUntil).toEqual(startOfTomorrow(LINKED, null));

      // Later today: not in the chat, and not posted again.
      const later = new Date(LINKED.getTime() + 3 * 60 * 60 * 1000);
      const today = await openChat(userId, { client, now: later });
      expect(today?.messages.map((m) => m.id)).not.toContain(message.id);
      await runJaneAgent(userId, { client, now: later });
      expect((await reloadMessage(message.id)).status).toBe("dismissed");

      // Tomorrow: back at the bottom, open, with its buttons.
      const tomorrow = day(1);
      const chat = await openChat(userId, { client, now: tomorrow });
      const back = await reloadMessage(message.id);
      expect(back).toMatchObject({ status: "open", answeredWith: null, snoozedUntil: null });
      expect(back.createdAt.getTime()).toBeGreaterThanOrEqual(tomorrow.getTime());
      expect(buttonIds(back)).toEqual(["alert.got_it", "snooze", "open"]);
      expect(chat?.messages.at(-1)?.id).toBe(message.id);
    });

    it("refuses another person's snooze, and a message no longer open", async () => {
      const { userId, message } = await withAlert("chat83-snooze-refused");
      const stranger = await person("chat83-stranger");
      await expect(
        takeChatAction(stranger, message.id, "snooze", { client }),
      ).rejects.toMatchObject({ code: "not_found" });
      await takeChatAction(userId, message.id, "alert.got_it", { client });
      await expect(takeChatAction(userId, message.id, "snooze", { client })).rejects.toMatchObject({
        code: "not_open",
      });
    });
  });

  describe("deadlines", () => {
    it("Mark done is refused for another person and once it's already done", async () => {
      const userId = await plainPerson("chat83-deadline");
      await addDeadline(
        userId,
        { title: "Return the jacket", dueOn: isoDay(day(2)), kind: "other", note: "" },
        { client, now: LINKED },
      );
      await setAutopilot(userId, "ask", { client });
      await talk(userId);
      const [message] = await withButton(userId, "deadline.done");
      expect(message.body).toBe("Coming up in 2 days: Return the jacket.");
      const stranger = await person("chat83-stranger");
      await expect(
        takeChatAction(stranger, message.id, "deadline.done", { client }),
      ).rejects.toMatchObject({ code: "not_found" });
      await client.deadline.updateMany({ where: { userId }, data: { doneAt: new Date() } });
      await expect(
        takeChatAction(userId, message.id, "deadline.done", { client }),
      ).rejects.toMatchObject({ code: "not_open" });
    });
  });

  describe("things you own", () => {
    it("asks for the home's value when a mortgage has nothing linked", async () => {
      const userId = await plainPerson("chat83-things");
      const loan = await client.account.create({
        data: { userId, source: "csv", name: "Home Mortgage", type: "loan", subtype: "mortgage" },
      });
      await setAutopilot(userId, "ask", { client });
      await talk(userId);
      const message = (await messagesOf(userId)).find((m) => m.dedupeKey.startsWith("things:"))!;
      expect(parseActions(message.actions)[0]).toEqual({
        id: "open",
        label: "Add your home's value",
        kind: "link",
        href: `/things?kind=home&loan=${loan.id}`,
      });
    });
  });
});
