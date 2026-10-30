import { randomBytes } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import type { PlaidApi } from "plaid";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn(), SYSTEM_ACTOR: { type: "system", id: null } }));

import { linkDemoBank } from "@/lib/plaid/demo";
import { removePlaidItem } from "@/lib/plaid/remove";
import { syncItem } from "@/lib/plaid/sync";
import { runChatTool } from "./claude-tools";
import { closeSettled } from "./messages";
import { loadPopupStack } from "./popup-stack";
import { AS_THEY_COME } from "./preferences";
import { runJaneAgent } from "./run";
import { suggestionCard } from "./sources/suggestions";
import { stillTrue } from "./still-true";
import { MESSAGE_SELECT, toChatMessage } from "./types";

// The founder's bug (card-chat mismatch), the dock's half, against a real, migrated Postgres.
// The demo bank has a $1,349.00 Apple Store purchase two days before it was linked; nine days
// later Jane posts "Coming up in 3 days: Return window for Apple ($1,349.00).". Before the fix
// that text never changed, and after the demo bank was disconnected the dock kept the card (and
// the "$1,349.00 at Apple, a first charge" alert) for 14 days while the chat found no purchase.

const url = process.env.TEST_DATABASE_URL;
const LINKED = new Date("2026-10-18T15:00:00Z");
const DAY = 24 * 60 * 60 * 1000;
const day = (n: number) => new Date(LINKED.getTime() + n * DAY);
// Jane's messages are written a millisecond apart from the run's time.
const after = (d: Date) => new Date(d.getTime() + 60_000);
const APPLE = /Apple/;

describe.runIf(url)("Jane's cards are checked against the data before they show", () => {
  let client: PrismaClient;
  let userId: string;
  let itemId: string;
  const plaid = new Proxy(
    {},
    {
      get: () => () => {
        throw new Error("The demo bank must never call Plaid");
      },
    },
  ) as PlaidApi;

  const openCards = async () =>
    (
      await client.janeMessage.findMany({
        where: { userId, status: "open", kind: "heads_up" },
        select: MESSAGE_SELECT,
      })
    ).map(toChatMessage);

  beforeAll(async () => {
    vi.stubEnv("TOKEN_ENCRYPTION_KEY", randomBytes(32).toString("base64"));
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    vi.stubEnv("PLAID_CLIENT_ID", "");
    vi.stubEnv("PLAID_SECRET", "");
    vi.stubEnv("DEMO_BANK", "1");
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
    const user = await client.user.create({
      data: { email: `still-true-${crypto.randomUUID()}@example.com` },
    });
    userId = user.id;
    await client.janePreference.create({
      data: { userId, ...AS_THEY_COME, value: AS_THEY_COME.value },
    });
    ({ itemId } = await linkDemoBank(userId, { client, now: LINKED }));
    await syncItem(itemId, { client, api: plaid, now: LINKED });
    for (const n of [0, 9]) await runJaneAgent(userId, { client, now: day(n), trigger: "open" });
  }, 240_000);
  afterAll(async () => {
    await client.user.deleteMany({ where: { id: userId } });
    await client.$disconnect();
    vi.unstubAllEnvs();
  });

  it("posts the return-window heads-up, then says it as of each day", async () => {
    const card = (await openCards()).find((m) => m.refs.deadlineKey?.startsWith("return:"));
    expect(card?.body).toBe("Coming up in 3 days: Return window for Apple ($1,349.00).");
    // A day later the stored text still says "in 3 days"; the dock says it as of today.
    const [shown] = await stillTrue(userId, [card!], { client, now: day(10) });
    expect(shown.body).toBe("Coming up in 2 days: Return window for Apple ($1,349.00).");
  });

  it("after the bank is disconnected, the dock and the chat's alerts drop the $1,349.00", async () => {
    expect((await runChatTool(userId, "alerts", {}, { client, now: day(10) })).content).toContain(
      "$1,349.00",
    );
    expect((await openCards()).some((m) => APPLE.test(m.body))).toBe(true);

    await removePlaidItem(userId, itemId, "user_disconnected", { client, api: plaid });

    // The dock: the return window and the alert about the charge are both gone, and put away.
    const dock = await loadPopupStack(userId, { client, now: after(day(10)) });
    expect(dock.filter((m) => APPLE.test(m.body))).toEqual([]);
    expect((await openCards()).filter((m) => APPLE.test(m.body))).toEqual([]);
    // The alert is still unread, but no longer said.
    expect(
      (await runChatTool(userId, "alerts", {}, { client, now: day(10) })).content,
    ).not.toContain("$1,349.00");
  });

  it("puts away a heads-up whose date has passed when the chat opens", async () => {
    await client.janeMessage.create({
      data: {
        userId,
        kind: "heads_up",
        body: "Coming up today: Return window for West Marine ($640.00).",
        refs: { deadlineKey: "return:gone-west-marine" },
        actions: [{ id: "snooze", label: "Remind me tomorrow", kind: "secondary" }],
        dedupeKey: "heads_ups:deadline:return:gone-west-marine",
        createdAt: day(10),
      },
    });
    await closeSettled(userId, { client, now: after(day(10)) });
    expect((await openCards()).filter((m) => /West Marine/.test(m.body))).toEqual([]);
  });

  it("says a change as Jane sees it today, and puts it away once it no longer shows", async () => {
    const change = (title: string, key: string) =>
      client.janeMessage.create({
        data: {
          userId,
          kind: "heads_up",
          body: `${title} Want a budget for it?`,
          refs: { change: { key, kind: "category_pace", title } },
          actions: [{ id: "change.expected", label: "That's expected", kind: "secondary" }],
          dedupeKey: `changes:${key}`,
          createdAt: day(10),
        },
      });
    // No accounts any more, so no change shows: a pace card from before goes.
    const pace = await change(
      "You've spent $488.06 on Transportation so far this month. By now you'd usually have spent about $37.08.",
      "pace:Transportation:2026-10",
    );
    expect(await stillTrue(userId, [toChatMessage(pace)], { client, now: day(10) })).toEqual([]);
  });

  it("says a suggestion card as the last scan left its suggestion", async () => {
    // Night debugger (10-30): after a bank was disconnected, the card still said the cash
    // that bank had held; the rescan had moved on.
    const now = {
      key: "idle_cash:test",
      headline: "Put the cash you don't need to work, earn $412 a year",
      short: "You keep $19,447.51 in cash; about $8,200.00 is more than you need",
      why: "Your checking holds more than three months of spending.",
      confidencePercent: 82,
      confidenceReason: "1 cash account in 6 months of data",
    };
    await client.suggestion.create({
      data: {
        userId,
        ...now,
        capability: "idle_cash",
        topic: "idle_cash",
        title: "Put your idle cash to work",
        worthCents: 41_200,
        worthKind: "earns",
        urgency: "later",
        actionLabel: "Show me",
        actionHref: "/insights",
        status: "selected",
      },
    });
    const card = toChatMessage(
      await client.janeMessage.create({
        data: {
          userId,
          kind: "decision",
          body: [
            "Put the cash you don't need to work, earn $1,055/yr",
            "Why you: You keep $47,597.63 in cash; about $21,100.61 is more than you need.",
            "84% sure: 3 cash accounts in 11 months of data.",
          ].join("\n"),
          refs: { suggestion: now.key, suggestionWhy: "The old reason." },
          actions: [{ id: "suggestion.yes", label: "Show me", kind: "primary" }],
          dedupeKey: "suggestions:idle_cash:test",
        },
      }),
    );
    const [shown] = await stillTrue(userId, [card], { client, now: day(10) });
    expect(shown.body.split("\n")).toEqual(suggestionCard(now));
    expect(shown.body).not.toContain("$47,597.63");
    expect(shown.refs.suggestionWhy).toBe(now.why);
  });
});
