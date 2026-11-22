import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));

import { loadPopupStack } from "./popup-stack";

// Gate C's full sweep (debug 3, 11-21, retiree, daily, Nov 23): the dock had 13 cards at 3pm and
// 14 at 7pm with no new data. It read only the newest 36 open messages; two of that morning's
// cards, which never showed (the day's pick asked the same thing), filled places in those 36, and
// once the evening scan settled them, a Nov 14 card nobody had answered came back at the end.

const url = process.env.TEST_DATABASE_URL;
const NOW = new Date("2026-11-24T03:00:00Z");
const OLD = "Your phone bill went up $12.00 this month. Want me to look into it?";

describe.runIf(url)("the dock, whatever else is open", () => {
  let client: PrismaClient;
  let userId: string;

  beforeAll(async () => {
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
    userId = (
      await client.user.create({
        data: { email: `dock-window-${crypto.randomUUID()}@example.com` },
      })
    ).id;
    // Nov 14: a card with a question, still open.
    await client.janeMessage.create({
      data: {
        userId,
        kind: "decision",
        body: OLD,
        refs: {},
        actions: [
          { id: "finding.yes", label: "Yes", kind: "primary" },
          { id: "finding.no", label: "No", kind: "secondary" },
        ],
        dedupeKey: "dock-window:old",
        createdAt: new Date("2026-11-14T16:00:00Z"),
      },
    });
    // Nov 15 to 22, greetings that show nowhere while the morning brief is off (./popups.ts
    // hiddenBrief): 39 open messages newer than the card.
    await client.janeMessage.createMany({
      data: Array.from({ length: 39 }, (_, i) => ({
        userId,
        kind: "brief" as const,
        body: "Good morning! Nothing new from me yet.",
        refs: {},
        actions: [{ id: "brief.ok", label: "OK", kind: "primary" }],
        dedupeKey: `dock-window:brief:${i}`,
        createdAt: new Date(Date.UTC(2026, 10, 15 + Math.floor(i / 5), 16 + (i % 5))),
      })),
    });
  });
  afterAll(async () => {
    await client.user.deleteMany({ where: { id: userId } });
    await client.$disconnect();
  });

  const dock = async () => (await loadPopupStack(userId, { client, now: NOW })).map((m) => m.body);

  it("shows an open card however many newer messages that don't show are open", async () => {
    expect(await dock()).toEqual([OLD]);
  });

  it("is the same once those are settled", async () => {
    const before = await dock();
    await client.janeMessage.updateMany({
      where: { userId, dedupeKey: { startsWith: "dock-window:brief:" } },
      data: { status: "answered", answeredAt: NOW },
    });
    expect(await dock()).toEqual(before);
  });
});
