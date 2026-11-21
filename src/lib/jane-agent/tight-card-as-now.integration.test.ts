import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";
import type { TightMoney } from "@/lib/tight-money";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
// The tight month as it is today (src/lib/tight-money.ts), set by each test.
const today = vi.hoisted(() => ({ tight: null as TightMoney | null }));
vi.mock("@/lib/tight-money", async (actual) => ({
  ...(await actual<typeof import("@/lib/tight-money")>()),
  loadTightMoney: vi.fn(async () => today.tight),
}));

import { stillTrue } from "./still-true";
import { parseRefs, type ChatMessage } from "./types";

// Debug 3's linked-month sweep person (11-21, daily): the plan posted Dec 7, "Your checking is
// forecast to be down to $56.46 on Dec 12, $43.54 under the cushion I like to keep.", stayed in the
// dock until Dec 20, a week past its day, and on Dec 20 showed at 7pm and not at 3pm.

const url = process.env.TEST_DATABASE_URL;
const NOW = new Date("2026-12-14T23:00:00Z");
const ITEM = "hardship:card";
const item = (id = ITEM) => ({
  id,
  kind: "hardship" as const,
  debtKey: "card",
  debtName: "Demo Card",
  label: "Ask Demo Card for a hardship plan",
  body: "…",
  freesCents: null,
  sent: null,
});
const tight = (date: string | null, items = [item()]): TightMoney => ({
  available: true,
  asOf: "2026-12-14",
  shortfall: date ? { date, balanceCents: 8_000, shortCents: 2_000 } : null,
  billsFirst: date
    ? [{ payee: "Avalon Rent", date, amountCents: 150_000, essential: "housing" }]
    : [],
  items: date ? (items as TightMoney["items"]) : [],
  requests: [],
});
const DEC_12 =
  "Your checking is forecast to be down to $56.46 on Dec 12, $43.54 under the cushion I like to keep.";

describe.runIf(url)("the tight month's plan card, as of today", () => {
  let client: PrismaClient;
  let userId: string;

  beforeAll(async () => {
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
    userId = (
      await client.user.create({ data: { email: `tight-card-${crypto.randomUUID()}@example.com` } })
    ).id;
  });
  afterAll(async () => {
    await client.user.deleteMany({ where: { id: userId } });
    await client.$disconnect();
  });

  // A plan card posted Dec 7 for Dec 12's shortfall, with its day kept or (before 11-21) not.
  const card = async (kept: boolean): Promise<ChatMessage> => {
    const row = await client.janeMessage.create({
      data: {
        userId,
        kind: "decision",
        body: `${DEC_12}\nPay these first, essentials before anything else:`,
        refs: {
          advice: true,
          tightItem: kept ? { id: ITEM, shortfallOn: "2026-12-12" } : { id: ITEM },
        },
        actions: [{ id: "tight.send", label: "Ask Demo Card", kind: "primary" }],
        dedupeKey: `tight:2026-12:${ITEM}:${crypto.randomUUID()}`,
        createdAt: new Date("2026-12-07T16:00:00Z"),
      },
    });
    return {
      id: row.id,
      kind: "decision",
      body: row.body,
      refs: parseRefs(row.refs),
      actions: [],
      status: "open",
      answeredWith: null,
      answeredAt: null,
      createdAt: row.createdAt,
    };
  };
  const asNow = async (m: ChatMessage) =>
    (await stillTrue(userId, [m], { client, now: NOW })).find((n) => n.id === m.id);

  it("is said with today's shortfall in the same month, not a passed day's", async () => {
    today.tight = tight("2026-12-18");
    const shown = await asNow(await card(true));
    expect(shown?.body.split("\n")[0]).toBe(
      "Your checking is forecast to be down to $80.00 on Dec 18, $20.00 under the cushion I like to keep.",
    );
    expect(shown?.body).toContain("- Avalon Rent, $1,500.00 on Dec 18 (housing)");
    expect(shown?.refs.tightItem).toEqual({ id: ITEM, shortfallOn: "2026-12-18" });
  });

  it("goes once the forecast has no shortfall", async () => {
    today.tight = tight(null);
    expect(await asNow(await card(true))).toBeUndefined();
  });

  it("goes when the shortfall is another month's: that month's card is its own", async () => {
    today.tight = tight("2027-01-04");
    expect(await asNow(await card(true))).toBeUndefined();
  });

  it("goes when its request is no longer the next to send", async () => {
    today.tight = tight("2026-12-18", [item("extension:loan")]);
    expect(await asNow(await card(true))).toBeUndefined();
  });

  it("keeps a card from before its day was kept only while it names today's shortfall day", async () => {
    today.tight = tight("2026-12-12");
    expect((await asNow(await card(false)))?.body).toContain("on Dec 12,");
    today.tight = tight("2026-12-18");
    expect(await asNow(await card(false))).toBeUndefined();
  });
});
