import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";
import { PUT_AWAY_UNDO_MINUTES } from "@/config/put-away";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
// The audit row goes through the app's own client, which a test run with no DATABASE_URL lacks.
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn(), SYSTEM_ACTOR: { type: "system", id: null } }));

import { takeChatAction } from ".";

// Founder (11-16): "there should be an option to go back to the suggestion that they just clicked
// close". A card put away with Not now or "Don't suggest this again" is brought back from the line
// left in its place, and whatever putting it away told the server is undone: the message is open
// with its buttons, and a no's suggestion, savings record and habit are as they were. Twice is
// safe. Against a real Postgres.

const url = process.env.TEST_DATABASE_URL;
const NOW = new Date("2026-11-16T18:00:00Z");
const BUTTONS = [
  { id: "suggestion.yes", label: "Yes", kind: "primary" },
  { id: "snooze", label: "Not now", kind: "secondary" },
  { id: "suggestion.no", label: "Not for me", kind: "secondary" },
  { id: "open", label: "Open it", kind: "link", href: "/subscriptions" },
];

describe.runIf(url)("a card put away, brought back", { timeout: 60_000 }, () => {
  let client: PrismaClient;
  let userId: string;

  beforeAll(async () => {
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url! }) });
    userId = (
      await client.user.create({ data: { email: `put-away-${crypto.randomUUID()}@example.com` } })
    ).id;
  });
  afterAll(async () => {
    await client.user.deleteMany({ where: { id: userId } });
    await client.$disconnect();
  });

  // A suggestion offered today, on the record as shown, and its card.
  async function offered(topic: string) {
    const key = `subscriptions:${topic}`;
    await client.suggestion.create({
      data: {
        userId,
        key,
        capability: "subscriptions",
        topic,
        title: "Cancel the gym",
        worthCents: 30_000,
        worthKind: "yearly",
        confidencePercent: 80,
        confidenceReason: "no visits in 3 months",
        urgency: "normal",
        why: "You haven't been since August.",
        actionLabel: "Cancel it",
        actionHref: "/subscriptions",
        status: "selected",
      },
    });
    await client.suggestionOutcome.create({
      data: {
        userId,
        suggestionKey: key,
        capability: "subscriptions",
        topic,
        title: "Cancel the gym",
        firstShownAt: NOW,
        lastShownAt: NOW,
        expectedCents: 30_000,
        worthKind: "yearly",
        confidencePercent: 80,
      },
    });
    const message = await client.janeMessage.create({
      data: {
        userId,
        kind: "suggestion",
        dedupeKey: `suggestion:${key}`,
        body: "Cancel the gym, save $300/yr\nWhy you: no visits.\n80% sure: no visits.",
        status: "open",
        actions: BUTTONS,
        refs: { suggestion: key },
      },
    });
    return { key, id: message.id };
  }

  const tap = (id: string, action: string, now = NOW) =>
    takeChatAction(userId, id, action, { client, now });
  const codeOf = (p: Promise<unknown>) =>
    p.then(
      () => "ran",
      (e: { code?: string }) => e.code ?? String(e),
    );
  const messageOf = (id: string) => client.janeMessage.findUniqueOrThrow({ where: { id } });

  it("Not now: open again with its buttons, and again after a second put away", async () => {
    const card = await offered("gym_snooze");
    await tap(card.id, "snooze");
    const away = await messageOf(card.id);
    expect(away.status).toBe("dismissed");
    expect((away.actions as { id: string }[])[0].id).toBe("undo.snooze");

    await tap(card.id, "undo.snooze");
    const back = await messageOf(card.id);
    expect(back.status).toBe("open");
    expect(back.actions).toEqual(BUTTONS);
    expect(back.snoozedUntil).toBeNull();
    expect(back.answeredAt).toBeNull();
    expect(back.refs).toEqual({ suggestion: card.key });
    // A second tap of the same line changes nothing.
    expect(await codeOf(tap(card.id, "undo.snooze"))).toBe("not_open");
    expect((await messageOf(card.id)).status).toBe("open");

    // Put away again, and back again.
    await tap(card.id, "snooze");
    await tap(card.id, "undo.snooze");
    expect((await messageOf(card.id)).status).toBe("open");
  });

  it("Don't suggest this again: the suggestion, its record and the habit as they were", async () => {
    const card = await offered("gym_never");
    await tap(card.id, "suggestion.no");
    expect((await client.suggestion.findFirstOrThrow({ where: { key: card.key } })).status).toBe(
      "no",
    );
    expect(
      (await client.suggestionOutcome.findFirstOrThrow({ where: { suggestionKey: card.key } }))
        .status,
    ).toBe("declined");
    expect(await client.userFact.count({ where: { userId, key: "habit:gym_never" } })).toBe(1);

    await tap(card.id, "undo.never");
    const suggestion = await client.suggestion.findFirstOrThrow({ where: { key: card.key } });
    expect(suggestion.status).toBe("selected");
    expect(suggestion.answeredAt).toBeNull();
    const outcome = await client.suggestionOutcome.findFirstOrThrow({
      where: { suggestionKey: card.key },
    });
    expect([outcome.status, outcome.answer, outcome.answeredAt]).toEqual(["shown", null, null]);
    // The no was the only evidence: no habit is known.
    expect(await client.userFact.count({ where: { userId, key: "habit:gym_never" } })).toBe(0);
    const back = await messageOf(card.id);
    expect(back.status).toBe("open");
    expect(back.actions).toEqual(BUTTONS);
    expect(back.refs).toEqual({ suggestion: card.key });
    expect(await codeOf(tap(card.id, "undo.never"))).toBe("not_open");
  });

  // Sure enough, the no only weakens it; less sure, the no replaces it with a new row.
  it.each([
    ["weakened", 70],
    ["replaced", 50],
  ])("leaves a habit Jane already knew exactly as it was (%s)", async (how, confidence) => {
    const topic = `gym_known_${how}`;
    const card = await offered(topic);
    const known = await client.userFact.create({
      data: {
        userId,
        key: `habit:${topic}`,
        value: { value: "acts" },
        label: "You tend to act on gym suggestions",
        source: "action",
        sourceRef: "suggestion:subscriptions:other",
        confidence,
        evidenceCount: 3,
        firstSeen: new Date("2026-10-01T00:00:00Z"),
        lastConfirmed: new Date("2026-11-01T00:00:00Z"),
      },
    });
    await tap(card.id, "suggestion.no");
    const after = await client.userFact.findMany({ where: { userId, key: `habit:${topic}` } });
    expect(after).toHaveLength(how === "replaced" ? 2 : 1);
    await tap(card.id, "undo.never");
    const facts = await client.userFact.findMany({ where: { userId, key: `habit:${topic}` } });
    expect(facts).toHaveLength(1);
    expect(facts[0]).toEqual(known);
  });

  it("is too late once the window has passed", async () => {
    const card = await offered("gym_late");
    await tap(card.id, "snooze");
    const late = new Date(NOW.getTime() + (PUT_AWAY_UNDO_MINUTES + 1) * 60_000);
    expect(await codeOf(tap(card.id, "undo.snooze", late))).toBe("expired");
    expect((await messageOf(card.id)).status).toBe("dismissed");
  });
});
