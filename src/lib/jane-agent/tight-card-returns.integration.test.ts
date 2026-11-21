import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";
import type { TightMoney } from "@/lib/tight-money";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
// The tight month as it is today (src/lib/tight-money.ts), set by each test.
const today = vi.hoisted(() => ({ tight: null as TightMoney | null }));
vi.mock("@/lib/tight-money", async (actual) => ({
  ...(await actual<typeof import("@/lib/tight-money")>()),
  loadTightMoney: vi.fn(async () => today.tight),
}));

import type { PlannedMessage } from "./brain";
import { postMessages } from "./messages";
import { tightMoneySource } from "./sources/tight-money";
import { stillTrue } from "./still-true";
import { parseRefs, type ChatMessage } from "./types";

// Manager's check on #2216 (11-21): a plan card stillTrue puts away because the shortfall went must
// not keep a shortfall that returns that month, for the same request, from being said. Its
// dedupeKey, tight:<month>:<item>, is the same, and a key once posted comes back only once its
// snooze is over (./brain.ts, ./messages.ts postMessages).

const url = process.env.TEST_DATABASE_URL;
const item = {
  id: "hardship:card",
  kind: "hardship" as const,
  debtKey: "card",
  debtName: "Demo Card",
  label: "Ask Demo Card for a hardship plan",
  body: "…",
  freesCents: null,
  sent: null,
};
const tight = (date: string | null): TightMoney => ({
  available: true,
  asOf: "2026-12-08",
  shortfall: date ? { date, balanceCents: 8_000, shortCents: 2_000 } : null,
  billsFirst: [],
  items: date ? [item] : [],
  requests: [],
});
// The brain's plan of the source's card for a tight month, as it posts it.
const planned = (data: TightMoney): PlannedMessage[] =>
  tightMoneySource
    .gather(
      { tightMoney: data } as Parameters<typeof tightMoneySource.gather>[0],
      {} as Parameters<typeof tightMoneySource.gather>[1],
    )
    .map((c) => ({ ...c, source: "tight_money", dedupeKey: `tight_money:${c.dedupeKey}` }));

describe.runIf(url)("a tight month's shortfall that goes and comes back", () => {
  let client: PrismaClient;
  let userId: string;

  beforeAll(async () => {
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
    userId = (
      await client.user.create({ data: { email: `tight-back-${crypto.randomUUID()}@example.com` } })
    ).id;
  });
  afterAll(async () => {
    await client.user.deleteMany({ where: { id: userId } });
    await client.$disconnect();
  });

  const row = () =>
    client.janeMessage.findFirstOrThrow({
      where: { userId, dedupeKey: { startsWith: "tight_money:tight:2026-12:" } },
    });
  const asChat = (r: Awaited<ReturnType<typeof row>>): ChatMessage => ({
    id: r.id,
    kind: "decision",
    body: r.body,
    refs: parseRefs(r.refs),
    actions: [],
    status: "open",
    answeredWith: null,
    answeredAt: null,
    createdAt: r.createdAt,
  });

  it("is said again when it returns that month, once", async () => {
    // Dec 8: a shortfall on Dec 12, posted.
    await postMessages(userId, planned(tight("2026-12-12")), {
      client,
      now: new Date("2026-12-08T16:00:00Z"),
    });
    // Dec 10: the forecast has no shortfall; the card is put away.
    today.tight = tight(null);
    expect(
      await stillTrue(userId, [asChat(await row())], {
        client,
        now: new Date("2026-12-10T16:00:00Z"),
      }),
    ).toEqual([]);
    expect((await row()).status).toBe("answered");
    // Dec 18: one is back, on Dec 22, for the same request.
    const back = new Date("2026-12-18T16:00:00Z");
    expect(await postMessages(userId, planned(tight("2026-12-22")), { client, now: back })).toBe(1);
    const again = await row();
    expect(again.status).toBe("open");
    expect(again.body).toMatch(/on Dec 22,/);
    expect(again.snoozedUntil).toBeNull();
    // Planned again the next morning, it isn't brought back a second time: it's open as it is.
    expect(
      await postMessages(userId, planned(tight("2026-12-22")), {
        client,
        now: new Date("2026-12-19T16:00:00Z"),
      }),
    ).toBe(0);
  });
});
