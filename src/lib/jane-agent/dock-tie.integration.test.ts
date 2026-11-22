import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));

import { chatFeed } from "./messages";
import { loadPopupStack } from "./popup-stack";

// Main went red on c95a09d7 (debug 3, 11-22): one person made twice had two cards posted at one
// moment in one order, then the other, because the dock broke the tie by the random id. Here the
// ids are given both ways round; what shows first is what the data says (priority, then the key).

const url = process.env.TEST_DATABASE_URL;
const NOW = new Date("2026-11-12T23:00:00Z");
const AT = new Date("2026-11-12T16:00:00Z");

describe.runIf(url)("cards posted at one moment", () => {
  let client: PrismaClient;

  beforeAll(() => {
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
  });
  afterAll(async () => {
    await client.user.deleteMany({ where: { email: { startsWith: "dock-tie-" } } });
    await client.$disconnect();
  });

  // Three cards at AT: two of one priority, one more important; ids in the order given.
  const person = async (ids: [string, string, string]) => {
    const userId = (
      await client.user.create({ data: { email: `dock-tie-${crypto.randomUUID()}@example.com` } })
    ).id;
    const cards = [
      { key: "billpay:card:ask", body: "Your card payment is due Nov 26.", priority: 40 },
      { key: "billpay:loan:ask", body: "Your loan payment is due Nov 20.", priority: 40 },
      { key: "deadline:rent", body: "Rent is due Dec 1.", priority: 60 },
    ];
    await client.janeMessage.createMany({
      data: cards.map((c, i) => ({
        id: `${ids[i]}-${userId}`,
        userId,
        kind: "decision" as const,
        body: c.body,
        refs: {},
        actions: [
          { id: "finding.yes", label: "Yes", kind: "primary" },
          { id: "finding.no", label: "No", kind: "secondary" },
        ],
        dedupeKey: c.key,
        priority: c.priority,
        createdAt: AT,
      })),
    });
    return userId;
  };
  const dock = async (userId: string) =>
    (await loadPopupStack(userId, { client, now: NOW })).map((m) => m.body);
  const chat = async (userId: string) =>
    (await chatFeed(userId, { client, now: NOW })).messages.map((m) => m.body);

  it("are in one order whichever way round their ids are", async () => {
    const one = await person(["a", "b", "c"]);
    const other = await person(["z", "y", "x"]);
    const order = [
      "Rent is due Dec 1.",
      "Your card payment is due Nov 26.",
      "Your loan payment is due Nov 20.",
    ];
    expect(await dock(one)).toEqual(order);
    expect(await dock(other)).toEqual(order);
    expect(await chat(other)).toEqual(await chat(one));
  });
});
