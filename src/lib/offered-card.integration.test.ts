import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));

import { offeredCard } from "./offered-card";

// The manager on #2224 (11-22): /bills printed "Ask for a lower bill rate, save $1,080/yr" from the
// suggestion's row whether or not the card still showed. The page says the card only while the
// dock and the chat offer it (offeredToday: the last scan's picks, not answered).

const url = process.env.TEST_DATABASE_URL;
const NOW = new Date("2026-11-22T20:00:00Z");
const KEY = "cost:bill_negotiation";
const HEADLINE = "Ask for a lower bill rate, save $1,080 a year";
const WHY = "Comcast is $165.00 a month, $45.00 above the typical top of $120.00.";

describe.runIf(url)("the card on the page it opens", () => {
  let client: PrismaClient;
  let userId: string;

  beforeAll(async () => {
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
    userId = (
      await client.user.create({ data: { email: `offered-${crypto.randomUUID()}@example.com` } })
    ).id;
    await client.suggestion.create({
      data: {
        userId,
        key: KEY,
        capability: "cost",
        topic: "bill_negotiation",
        title: "Worth asking for a lower rate on your internet or phone bill",
        headline: HEADLINE,
        worthCents: 108_000,
        worthKind: "saves",
        confidencePercent: 70,
        confidenceReason: "seen",
        urgency: "later",
        why: WHY,
        actionLabel: "See your bills",
        actionHref: "/bills#card",
        status: "selected",
        selectedOn: new Date("2026-11-22T00:00:00Z"),
      },
    });
  });
  afterAll(async () => {
    await client.user.deleteMany({ where: { id: userId } });
    await client.$disconnect();
  });

  const card = () => offeredCard(userId, KEY, { client, now: NOW });
  const set = (data: { status?: string; answeredAt?: Date }) =>
    client.suggestion.update({ where: { userId_key: { userId, key: KEY } }, data });

  it("shows while it's offered", async () => {
    expect(await card()).toEqual({ headline: HEADLINE, why: WHY });
  });

  it("doesn't once it's answered", async () => {
    await set({ status: "answered", answeredAt: NOW });
    expect(await card()).toBeNull();
    await set({ status: "selected" });
  });

  it("doesn't once it's gone", async () => {
    await client.suggestion.delete({ where: { userId_key: { userId, key: KEY } } });
    expect(await card()).toBeNull();
  });
});
