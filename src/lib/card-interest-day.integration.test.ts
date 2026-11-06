import { randomBytes } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import type { PlaidApi } from "plaid";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn(), SYSTEM_ACTOR: { type: "system", id: null } }));

import { linkDemoBank } from "@/lib/plaid/demo";
import { syncItem } from "@/lib/plaid/sync";
import { loadCardInterest } from "./card-interest";

// Night round 11-06, the same sample person at 3pm and 7pm in Los Angeles: "paying the $41.00
// now, not on the due date, saves $0.90" became "$0.86" at 7pm, when UTC is already tomorrow.
// Days to the due date count from the person's own day.
const url = process.env.TEST_DATABASE_URL;
const LINKED = new Date("2026-11-05T15:00:00Z");
// 3pm and 7pm on Nov 5 in Los Angeles; 7pm is already Nov 6 in UTC.
const AFTERNOON = new Date("2026-11-05T23:00:00Z");
const EVENING = new Date("2026-11-06T03:00:00Z");

describe.runIf(url)("paying a card early", { timeout: 120_000 }, () => {
  let client: PrismaClient;
  const created: string[] = [];
  const plaid = new Proxy(
    {},
    {
      get: () => () => {
        throw new Error("The demo bank must never call Plaid");
      },
    },
  ) as PlaidApi;
  async function demoPerson(timezone: string | null) {
    const user = await client.user.create({
      data: { email: `card-day-${crypto.randomUUID()}@example.com`, timezone },
    });
    created.push(user.id);
    const { itemId } = await linkDemoBank(user.id, { client, now: LINKED });
    await syncItem(itemId, { client, api: plaid, now: LINKED });
    return user.id;
  }

  beforeAll(async () => {
    vi.stubEnv("TOKEN_ENCRYPTION_KEY", randomBytes(32).toString("base64"));
    vi.stubEnv("PLAID_CLIENT_ID", "");
    vi.stubEnv("PLAID_SECRET", "");
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url! }) });
  });

  afterAll(async () => {
    await client.user.deleteMany({ where: { id: { in: created } } });
    await client.$disconnect();
  });

  it("is the same at 3pm and 7pm in the person's own day", async () => {
    const id = await demoPerson(null);
    const afternoon = await loadCardInterest(id, { client, now: AFTERNOON });
    const evening = await loadCardInterest(id, { client, now: EVENING });
    expect(afternoon.asOf).toBe("2026-11-05");
    expect(evening.asOf).toBe("2026-11-05");
    const early = (c: typeof afternoon) => c.cards.map((card) => card.payEarly);
    expect(early(afternoon).some((p) => p !== null)).toBe(true);
    expect(early(evening)).toEqual(early(afternoon));
  });

  it("follows the person's timezone where it's already tomorrow", async () => {
    const id = await demoPerson("Asia/Tokyo");
    expect((await loadCardInterest(id, { client, now: EVENING })).asOf).toBe("2026-11-06");
  });
});
