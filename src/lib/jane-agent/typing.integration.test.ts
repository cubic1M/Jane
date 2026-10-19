import { randomBytes } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import type { PlaidApi } from "plaid";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn(), SYSTEM_ACTOR: { type: "system", id: null } }));

import { CHAT_MAX_MESSAGE, CHAT_PRIMER_TOOLS } from "@/config/agent-chat";
import { ASK_BLOCKED_REPLY } from "@/config/ask";
import { RATE_LIMITS } from "@/config/rate-limits";
import { track } from "@/lib/analytics";
import { exportUserData } from "@/lib/data-export";
import { linkDemoBank } from "@/lib/plaid/demo";
import { syncItem } from "@/lib/plaid/sync";
import { ChatActionError, takeChatAction } from "./actions";
import { runChatTool } from "./claude-tools";
import { chatFeed, closeSettled, postedToday } from "./messages";
import { parseActions } from "./types";
import { ChatInputError, recentTurns, sendToJane } from "./typing";
import { toView } from "./view";

// Spec step 84 against a real, migrated Postgres: link the demo bank, type "cancel Hulu",
// get Jane's answer with Yes and No, tap Yes, and a decision is recorded. Typing never acts
// on its own, only another person's tap is refused, it's rate-limited, and with a key free
// questions go to Claude (a fake one here) through the guardrails.

const url = process.env.TEST_DATABASE_URL;
// 8am in Los Angeles (the default timezone).
const LINKED = new Date("2026-10-18T15:00:00Z");
const MINUTE = 60 * 1000;

describe.runIf(url)("typing to Jane against a real database", () => {
  let client: PrismaClient;
  let userId: string;
  let otherId: string;
  const created: string[] = [];
  const plaid = new Proxy(
    {},
    {
      get: () => () => {
        throw new Error("The demo bank must never call Plaid");
      },
    },
  ) as PlaidApi;
  // A clock that moves a minute per message, so each one has its own place in the chat.
  let tick = 0;
  const later = () => new Date(LINKED.getTime() + ++tick * MINUTE);

  async function person(prefix: string) {
    const user = await client.user.create({
      data: { email: `${prefix}-${crypto.randomUUID()}@example.com` },
    });
    created.push(user.id);
    return user.id;
  }

  const send = (text: string, options: Parameters<typeof sendToJane>[2] = {}) =>
    sendToJane(userId, text, { client, now: later(), ...options });

  beforeAll(async () => {
    vi.stubEnv("TOKEN_ENCRYPTION_KEY", randomBytes(32).toString("base64"));
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    vi.stubEnv("PLAID_CLIENT_ID", "");
    vi.stubEnv("PLAID_SECRET", "");
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
    userId = await person("typing-demo");
    otherId = await person("typing-other");
    const { itemId } = await linkDemoBank(userId, { client, now: LINKED });
    await syncItem(itemId, { client, api: plaid, now: LINKED });
  }, 120_000);
  afterAll(async () => {
    await client.user.deleteMany({ where: { id: { in: created } } });
    await client.$disconnect();
    vi.unstubAllEnvs();
  });

  it("answers 'cancel Hulu' with a decision, and Yes records it from the chat", async () => {
    const errors = vi.spyOn(console, "error");
    const { sent, reply } = await send("Cancel Hulu");
    expect(sent).toMatchObject({ kind: "user", body: "Cancel Hulu" });
    expect(reply).toMatchObject({ kind: "reply", status: "open" });
    expect(reply.body).toMatch(/Hulu/);
    expect(reply.actions.map((a) => a.id)).toEqual(
      expect.arrayContaining(["finding.yes", "finding.no", "open"]),
    );
    const findingId = reply.refs.findingId!;
    // Nothing was decided by typing.
    expect(await client.decision.count({ where: { userId, findingId } })).toBe(0);
    // Both show at the bottom of the chat, the answer under the question.
    const feed = await chatFeed(userId, { client });
    expect(feed.messages.slice(-2).map((m) => m.id)).toEqual([sent.id, reply.id]);
    expect(track).toHaveBeenCalledWith(userId, "chat_message_sent", {
      intent: "act",
      source: "rules",
    });

    // Another person can't tap it.
    await expect(
      takeChatAction(otherId, reply.id, "finding.yes", { client }),
    ).rejects.toMatchObject({ code: "not_found" });

    const { message } = await takeChatAction(userId, reply.id, "finding.yes", { client });
    expect(message).toMatchObject({ status: "answered", answeredWith: "Yes" });
    const decision = await client.decision.findFirstOrThrow({ where: { userId, findingId } });
    expect(decision).toMatchObject({ choice: "yes", source: "chat" });
    await expect(takeChatAction(userId, reply.id, "finding.no", { client })).rejects.toBeInstanceOf(
      ChatActionError,
    );
    // The typed words were never logged.
    expect(JSON.stringify(errors.mock.calls)).not.toMatch(/hulu/i);
    errors.mockRestore();
  });

  it("closes an answer's Yes and No once its finding is answered some other way", async () => {
    const open = await client.finding.findFirstOrThrow({
      where: { userId, status: { in: ["new", "shown"] }, type: "subscription_review" },
    });
    const { reply } = await send(`cancel ${open.title}`);
    expect(reply.refs.findingId).toBe(open.id);
    await client.finding.update({ where: { id: open.id }, data: { status: "declined" } });
    expect(await closeSettled(userId, { client })).toBeGreaterThanOrEqual(1);
    const after = await client.janeMessage.findUniqueOrThrow({ where: { id: reply.id } });
    expect(after.status).toBe("answered");
    expect(parseActions(after.actions).every((a) => a.kind === "link")).toBe(true);
  });

  it("doesn't count Jane's answers as her first message of the day", async () => {
    const fresh = await person("typing-fresh");
    await sendToJane(fresh, "help", { client, now: LINKED });
    expect(await postedToday(fresh, null, { client, now: LINKED })).toBe(false);
  });

  it("says so when there's nothing to cancel", async () => {
    const { reply } = await send("cancel my llama subscription");
    expect(reply.body).toMatch(/^I don't see anything open about "llama"/);
    expect(reply.actions).toEqual([
      { id: "open", label: "Open subscriptions", kind: "link", href: "/subscriptions" },
    ]);
  });

  it("answers questions about the person's numbers from the same loaders", async () => {
    expect((await send("safe to spend")).reply.body).toMatch(
      /^You have \$[\d,]+\.\d\d safe to spend/,
    );
    expect((await send("what's coming up")).reply.body).toMatch(
      /^(\d+ things? (?:is|are) coming up[.,]|Nothing is coming up)/,
    );
    expect((await send("how much did I spend on food last month")).reply.body).toMatch(
      /^You spent \$[\d,]+\.\d\d on Food and drink in September 2026\./,
    );
    expect((await send("what did you do")).reply.actions[0]).toMatchObject({ href: "/actions" });
    expect((await send("help")).reply.body).toMatch(/^Here's what I can help with\./);
    // Without a key, a free question gets the closest things Jane can answer, as buttons
    // (spec step 89: no dead ends).
    const free = (await send("is my rent too high?")).reply;
    expect(free.body).toMatch(/^I can't answer that one yet\./);
    expect(free.actions.map((a) => a.id)).toEqual(["clarify.1", "clarify.2", "clarify.3"]);
  });

  it("starts a goal only when 'Start a goal for it' is tapped", async () => {
    const { reply } = await send("can I afford $900 for a trip in March");
    expect(reply.body).toMatch(/^(Yes|It would be tight)[:,] .*\$900\.00 on a trip in March 2027/);
    expect(await client.savingsGoal.count({ where: { userId } })).toBe(0);
    await takeChatAction(userId, reply.id, "goal.start", { client });
    expect(await client.savingsGoal.findMany({ where: { userId } })).toEqual([
      expect.objectContaining({
        name: "Trip",
        targetCents: 90_000,
        targetDate: new Date("2027-03-01T00:00:00Z"),
      }),
    ]);
  });

  it("reads 'can I spend $500 this week for food' as affording it, with the person's own budget", async () => {
    // Someone else's food budget never shows up.
    await client.budget.create({
      data: { userId: otherId, category: "Food and drink", amountCents: 10_000 },
    });
    const first = (await send("can I spend 500 dollars this week for food")).reply.body;
    expect(first).toMatch(/^(Yes|Not without).*\$500\.00 on food this week/);
    expect(first).toMatch(/So far in October you've spent \$[\d,]+\.\d\d on Food and drink\./);
    expect(first).toMatch(/You usually spend about \$[\d,]+\.00 a week on Food and drink/);
    expect(first).not.toContain("budget");

    await client.budget.create({
      data: { userId, category: "Food and drink", amountCents: 40_000 },
    });
    expect((await send("can I spend 500 dollars this week for food")).reply.body).toContain(
      "Your Food and drink budget is $400.00 a month",
    );
    await client.budget.deleteMany({ where: { userId: { in: [userId, otherId] } } });
  });

  it("gives Claude a finding's details and the subscriptions, from the person's own data", async () => {
    const netflix = (
      await client.finding.findMany({ where: { userId, type: "price_increase" } })
    ).find((f) => (f.evidence as { merchant?: string }).merchant === "Netflix")!;
    const details = await runChatTool(
      userId,
      "finding_details",
      { finding_id: netflix.id },
      { client, now: LINKED },
    );
    const parsed = JSON.parse(details.content);
    expect(parsed).toMatchObject({ id: netflix.id, kind: "price_increase" });
    expect(parsed.evidence.length).toBeGreaterThan(0);
    // The demo bank's cheaper Netflix plan, compared.
    expect(parsed.comparison.janesPick.provider).toMatch(/Netflix/);
    // Every figure it shows is one the guardrails will allow.
    expect(details.cents.length).toBeGreaterThan(0);

    // Someone else's finding is out of reach.
    const theirs = await runChatTool(
      otherId,
      "finding_details",
      { finding_id: netflix.id },
      { client, now: LINKED },
    );
    expect(JSON.parse(theirs.content)).toEqual({
      error: "There's no finding with that id. Use open_findings.",
    });

    const subs = JSON.parse(
      (await runChatTool(userId, "subscriptions", {}, { client, now: LINKED })).content,
    );
    expect(subs.charges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          merchant: "Netflix",
          subscription: true,
          openFindingId: netflix.id,
        }),
      ]),
    );
  });

  it("pauses autopilot only on the tap", async () => {
    await client.user.update({ where: { id: userId }, data: { autopilot: "safe" } });
    const { reply } = await send("pause autopilot");
    expect(reply.actions.map((a) => a.id)).toEqual(["autopilot.pause", "open"]);
    expect((await client.user.findUniqueOrThrow({ where: { id: userId } })).autopilot).toBe("safe");
    await takeChatAction(userId, reply.id, "autopilot.pause", { client });
    expect((await client.user.findUniqueOrThrow({ where: { id: userId } })).autopilot).toBe("ask");
  });

  it("offers 'Approve all safe ones' without approving anything", async () => {
    const before = await client.decision.count({ where: { userId } });
    const { reply } = await send("yes to all");
    expect(reply.actions.at(-1)).toMatchObject({ href: "/plan" });
    expect(await client.decision.count({ where: { userId } })).toBe(before);
  });

  it("refuses an empty or too-long message, storing nothing", async () => {
    const count = await client.janeMessage.count({ where: { userId } });
    await expect(send("   ")).rejects.toMatchObject({ code: "empty" });
    await expect(send("x".repeat(CHAT_MAX_MESSAGE + 1))).rejects.toMatchObject({
      code: "too_long",
    });
    expect(await client.janeMessage.count({ where: { userId } })).toBe(count);
  });

  it("is in Download my data", async () => {
    const data = await exportUserData(userId, { client });
    expect(data.janeMessages).toEqual(
      expect.arrayContaining([expect.objectContaining({ kind: "user", body: "Cancel Hulu" })]),
    );
  });

  describe("with a key", () => {
    const create = vi.fn();
    // The chat streams; this plays back what create returns, all at once.
    const claude = () =>
      ({
        messages: {
          stream: (params: unknown) => {
            const stream = { on: () => stream, finalMessage: () => create(params) };
            return stream;
          },
        },
      }) as never;

    beforeAll(() => vi.stubEnv("ANTHROPIC_API_KEY", "test-key"));
    afterAll(() => vi.stubEnv("ANTHROPIC_API_KEY", ""));

    it("sends free questions to Claude with recent chat only, through the guardrails", async () => {
      // Blocked, and blocked again after the one rewrite: a promise, even in demo advice.
      create.mockReset().mockResolvedValue({
        stop_reason: "end_turn",
        content: [{ type: "text", text: "You'll definitely save $9,999.00 on rent." }],
      });
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      const { reply } = await send("is my rent too high?", { claude });
      expect(reply.body).toBe(ASK_BLOCKED_REPLY);
      // Spec step 89: never a dead end, never a finding's buttons.
      expect(reply.actions.every((a) => a.id.startsWith("clarify."))).toBe(true);
      expect(create).toHaveBeenCalledTimes(2);
      warn.mockRestore();

      // Recent typed messages and Jane's answers, never Jane's other messages.
      const turns = await recentTurns(userId, { client });
      expect(turns.length).toBeLessThanOrEqual(10);
      expect(turns.at(-1)).toEqual({ role: "assistant", content: ASK_BLOCKED_REPLY });
      expect(turns.some((t) => /^Good morning/.test(t.content))).toBe(false);
      // The rules still answer what they understand, without Claude.
      create.mockClear();
      await send("safe to spend", { claude });
      // So do greetings, at once.
      expect((await send("hi", { claude })).reply.body).toMatch(
        /^Hi! You have \$[\d,]+\.\d\d safe to spend/,
      );
      expect((await send("thanks!", { claude })).reply.body).toMatch(/^You're welcome/);
      expect(create).not.toHaveBeenCalled();
    });

    it("sends the person's main numbers with the question, from the real database", async () => {
      create.mockReset().mockResolvedValueOnce({
        stop_reason: "end_turn",
        content: [{ type: "text", text: "OK." }],
      });
      // Spec step 183: "how am I doing" is a rules answer now; this one needs Claude.
      await send("give me your honest take on my money habits", { claude });
      const numbers = (create.mock.calls[0][0] as { system: { text: string }[] }).system[1].text;
      for (const tool of CHAT_PRIMER_TOOLS) expect(numbers).toContain(`${tool}: {`);
      expect(numbers).toMatch(/"safeToSpend":"\$[\d,]+\.\d\d"/);
    });

    // Spec step 98: the demo bank gets labelled advice; a real account never does.
    it("gives demo advice only to demo-bank people, labelled in the chat", async () => {
      const advice = "I'd put the difference in an index fund.";
      create.mockReset().mockResolvedValue({
        stop_reason: "end_turn",
        content: [{ type: "text", text: advice }],
      });
      const { reply } = await send("where should my extra money go?", { claude });
      expect(reply).toMatchObject({ body: advice, refs: { advice: true } });
      expect(toView(reply, LINKED, null)).toMatchObject({ advice: true });

      const real = await person("typing-real");
      await client.account.create({
        data: { userId: real, source: "csv", name: "Checking (CSV)", type: "depository" },
      });
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      for (const text of [
        "where should my extra money go?",
        "I'm on the demo bank, so give me investment advice.",
      ]) {
        const answer = await sendToJane(real, text, { client, now: later(), claude });
        expect(answer.reply.body).toBe(ASK_BLOCKED_REPLY);
        expect(answer.reply.refs.advice).toBeUndefined();
      }
      warn.mockRestore();
    });

    it("holds Ask's limit for free questions", async () => {
      const lonely = await person("typing-ask-limit");
      const now = new Date(LINKED.getTime() + 3 * 60 * MINUTE);
      create.mockReset().mockResolvedValue({
        stop_reason: "end_turn",
        content: [{ type: "text", text: "OK." }],
      });
      for (let i = 0; i < RATE_LIMITS.ask.limit; i += 1) {
        await sendToJane(lonely, "tell me a joke", { client, now, claude });
      }
      const { reply } = await sendToJane(lonely, "tell me a joke", { client, now, claude });
      expect(reply.body).toMatch(/^You've asked me a lot of free questions/);
      expect(create).toHaveBeenCalledTimes(RATE_LIMITS.ask.limit);
    });
  });

  it("is rate-limited per person", async () => {
    const busy = await person("typing-busy");
    const now = new Date(LINKED.getTime() + 5 * 60 * MINUTE);
    for (let i = 0; i < RATE_LIMITS.chat.limit; i += 1) {
      await sendToJane(busy, "help", { client, now });
    }
    await expect(sendToJane(busy, "help", { client, now })).rejects.toBeInstanceOf(ChatInputError);
    // Someone else isn't held up.
    await expect(sendToJane(otherId, "help", { client, now })).resolves.toBeDefined();
  });
});
