import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";
import type { ShortTermView } from "@/lib/investments/short-term";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/advice-mode", async (actual) => ({
  ...(await actual<typeof import("@/lib/advice-mode")>()),
  adviceMode: vi.fn(async () => true),
}));
// The person's short-term money as it is today, set by the test.
const today = vi.hoisted(() => ({ view: null as ShortTermView | null }));
vi.mock("@/lib/investments/short-term", async (actual) => ({
  ...(await actual<typeof import("@/lib/investments/short-term")>()),
  loadShortTerm: vi.fn(async () => today.view),
}));

import { shortTermCard } from "./investments/short-term-copy";
import { loadPopupStack } from "./popup-stack";
import { shortCandidate } from "@/lib/investments/__fixtures__/short-term";

// The manager after gate C (11-24): a goal's short-term card posted again at each $1,000 of
// savings stayed open beside the newer ones. The dock keeps one card a pot, the newest, said with
// today's figures, and puts the rest away; a ladder card posted before shortKey goes with its pot.

const url = process.env.TEST_DATABASE_URL;
const NOW = new Date("2026-11-24T20:00:00Z");

describe.runIf(url)("one short-term card a pot of money", () => {
  let client: PrismaClient;
  let userId: string;

  beforeAll(async () => {
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
    userId = (
      await client.user.create({
        data: { email: `short-cards-${crypto.randomUUID()}@example.com` },
      })
    ).id;
    const goal = shortTermCard(shortCandidate(2_000_000));
    const emergency = shortTermCard(
      shortCandidate(1_000_000, { key: "emergency", name: "Emergency fund above its floor" }),
    );
    await client.janeMessage.createMany({
      data: [
        // Posted before shortKey: the ladder card's refs had only its ladderKey.
        {
          ...goal,
          refs: { advice: true, ladderKey: "goal:g1" },
          dedupeKey: "investments:short:goal:g1:20",
          createdAt: new Date("2026-11-21T16:00:00Z"),
        },
        {
          ...shortTermCard(shortCandidate(2_100_000)),
          dedupeKey: "investments:short:goal:g1:21",
          createdAt: new Date("2026-11-22T16:00:00Z"),
        },
        {
          ...emergency,
          dedupeKey: "investments:short:emergency:10",
          createdAt: new Date("2026-11-22T16:00:01Z"),
        },
      ].map((m) => ({ ...m, userId })),
    });
  });
  afterAll(async () => {
    await client.user.deleteMany({ where: { id: userId } });
    await client.$disconnect();
  });

  it("shows the newest of each pot, as it is now, and puts the older away", async () => {
    const goalNow = shortCandidate(2_240_000);
    const emergencyNow = shortCandidate(1_150_000, {
      key: "emergency",
      name: "Emergency fund above its floor",
    });
    today.view = {
      advice: true,
      fed: 0.24,
      state: 0.093,
      stateCode: "CA",
      fromProfile: true,
      candidates: [goalNow, emergencyNow],
      ladders: [],
    };
    const shown = (await loadPopupStack(userId, { client, now: NOW })).map((m) => m.body);
    expect(shown.filter((b) => b.startsWith("House down payment"))).toEqual([
      shortTermCard(goalNow).body,
    ]);
    expect(shown.filter((b) => b.startsWith("Emergency fund above its floor"))).toEqual([
      shortTermCard(emergencyNow).body,
    ]);
    const open = await client.janeMessage.findMany({ where: { userId, status: "open" } });
    expect(open).toHaveLength(2);
    // Stored as shown, its ladder key the pot's.
    expect(open.map((m) => m.body).sort()).toEqual(shown.slice().sort());
    expect(open.find((m) => m.body.startsWith("House"))?.refs).toMatchObject({
      shortKey: "goal:g1",
      ladderKey: "goal:g1",
    });
  });
});
