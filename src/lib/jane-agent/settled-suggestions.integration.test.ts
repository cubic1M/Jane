import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));

import { stackedSuggestions } from "./messages";
import { closeAnsweredElsewhere } from "./settled";
import { parseActions } from "./types";

// Overnight upload QA: a second upload showed the car insurance payments, the scan dropped
// "Check your car is insured", and its message stayed in the dock with its buttons.
const url = process.env.TEST_DATABASE_URL;

describe.runIf(url)("a suggestion's message once the suggestion is gone", () => {
  let client: PrismaClient;
  let userId: string;

  beforeAll(async () => {
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
    userId = (
      await client.user.create({ data: { email: `settled-${crypto.randomUUID()}@example.com` } })
    ).id;
  });
  afterAll(async () => {
    await client.user.deleteMany({ where: { id: userId } });
    await client.$disconnect();
  });

  it("keeps it while the suggestion waits, and closes it, links kept, once it's gone", async () => {
    const key = "insurance:auto_insurance";
    await client.suggestion.create({
      data: {
        userId,
        key,
        capability: "insurance",
        topic: "auto_insurance",
        title: "Check your car is insured",
        worthCents: 10_000_000,
        worthKind: "risk",
        confidencePercent: 60,
        confidenceReason: "no car-cover charges",
        urgency: "now",
        why: "I see car costs but no car-insurance charge.",
        actionLabel: "Add or compare car cover",
        actionHref: "/insurance",
        status: "selected",
      },
    });
    const message = await client.janeMessage.create({
      data: {
        userId,
        kind: "decision",
        body: "Check your car is insured",
        refs: { suggestion: key },
        actions: [
          { id: "suggestion.yes", label: "Add or compare car cover", kind: "primary" },
          { id: "snooze", label: "Not now", kind: "secondary" },
          { id: "open", label: "Open", kind: "link", href: "/insurance" },
        ],
        dedupeKey: `${key}:2026-10-27`,
      },
    });

    expect(await closeAnsweredElsewhere(userId, { client })).toBe(0);
    expect((await client.janeMessage.findUniqueOrThrow({ where: { id: message.id } })).status).toBe(
      "open",
    );

    await client.suggestion.updateMany({ where: { userId, key }, data: { status: "gone" } });
    expect(await closeAnsweredElsewhere(userId, { client })).toBe(1);
    const closed = await client.janeMessage.findUniqueOrThrow({ where: { id: message.id } });
    expect(closed.status).toBe("answered");
    expect(parseActions(closed.actions).map((a) => a.id)).toEqual(["open"]);
  });

  it("leaves the dock at once when the suggestion is gone, before the message is settled", async () => {
    const key = "spending:budget_overrun";
    const now = new Date();
    await client.suggestion.create({
      data: {
        userId,
        key,
        capability: "spending",
        topic: "budget_overrun",
        title: "Set a budget",
        worthCents: 10_000,
        worthKind: "saves",
        confidencePercent: 60,
        confidenceReason: "3 months of spending",
        urgency: "soon",
        why: "Food ran over.",
        actionLabel: "Set a budget",
        actionHref: "/budgets",
        status: "selected",
      },
    });
    await client.janeMessage.create({
      data: {
        userId,
        kind: "decision",
        body: "Set a budget",
        refs: { suggestion: key },
        actions: [{ id: "suggestion.yes", label: "Set a budget", kind: "primary" }],
        dedupeKey: `${key}:dock`,
        createdAt: now,
      },
    });
    const keys = async () =>
      (await stackedSuggestions(userId, { client, now: new Date(now.getTime() + 1000) })).map(
        (m) => m.refs.suggestion,
      );
    expect(await keys()).toContain(key);
    await client.suggestion.updateMany({ where: { userId, key }, data: { status: "gone" } });
    expect(await keys()).not.toContain(key);
  });

  // A news theme's alert is posted straight from the practice scan, with no suggestion row:
  // the dock kept only cards whose suggestion was live, so the theme card never came up
  // (e2e theme-alert, 10-27).
  it("keeps a card that has no suggestion row: in the dock, and open when the chat opens", async () => {
    const key = "investing:practice_theme_idea:theme_idea:conflict_defense:test";
    const now = new Date();
    const message = await client.janeMessage.create({
      data: {
        userId,
        kind: "decision",
        body: "News theme: Try $400 of ITA in practice",
        refs: { suggestion: key, advice: true },
        actions: [
          { id: "suggestion.yes", label: "Yes, in practice", kind: "primary" },
          { id: "snooze", label: "Not now", kind: "secondary" },
        ],
        dedupeKey: `themes:${key}`,
        createdAt: now,
      },
    });
    const later = new Date(now.getTime() + 1000);
    expect(
      (await stackedSuggestions(userId, { client, now: later })).map((m) => m.refs.suggestion),
    ).toContain(key);
    await closeAnsweredElsewhere(userId, { client });
    expect((await client.janeMessage.findUniqueOrThrow({ where: { id: message.id } })).status).toBe(
      "open",
    );
  });
});
