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
import { chatPrimer, runChatTool } from "./claude-tools";

// The founder's bug (card-chat mismatch), the chat's half, against a real, migrated Postgres.
// The demo bank has a $1,349.00 Apple Store purchase two days before it was linked. The card
// said "Apple Store" but the chat's search only knew "Apple"; after the demo bank was
// disconnected the chat's saved numbers still had the purchase and the demo balance, so its first
// answer repeated $1,349.00, and the next contradicted it once the numbers were refreshed.

const url = process.env.TEST_DATABASE_URL;
const LINKED = new Date("2026-10-18T15:00:00Z");
const DAY = 24 * 60 * 60 * 1000;
const day = (n: number) => new Date(LINKED.getTime() + n * DAY);
const appleStore = { merchant: "Apple Store", from: "2026-08-01" };

describe.runIf(url)("the chat answers from the data as it is now", () => {
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
  const tool = (name: string, input: object = {}) =>
    runChatTool(userId, name, input, { client, now: day(10) });

  beforeAll(async () => {
    vi.stubEnv("TOKEN_ENCRYPTION_KEY", randomBytes(32).toString("base64"));
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    vi.stubEnv("PLAID_CLIENT_ID", "");
    vi.stubEnv("PLAID_SECRET", "");
    vi.stubEnv("DEMO_BANK", "1");
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
    const user = await client.user.create({
      data: { email: `card-chat-${crypto.randomUUID()}@example.com` },
    });
    userId = user.id;
    ({ itemId } = await linkDemoBank(userId, { client, now: LINKED }));
    await syncItem(itemId, { client, api: plaid, now: LINKED });
  }, 240_000);
  afterAll(async () => {
    await client.user.deleteMany({ where: { id: userId } });
    await client.$disconnect();
    vi.unstubAllEnvs();
  });

  it("finds the card's purchase by the card's name", async () => {
    const found = JSON.parse((await tool("search_transactions", appleStore)).content);
    expect(found.matched).toBe(1);
    expect(found.transactions[0]).toMatchObject({ date: "2026-10-16", amount: "$1,349.00" });
    // A card payment, by the name Jane's bills and subscriptions give it.
    const paid = JSON.parse(
      (await tool("search_transactions", { merchant: "Credit card payment", from: "2026-08-01" }))
        .content,
    );
    expect(paid.matched).toBeGreaterThan(0);
  });

  it("looks up the rows behind the suggestion and proposal cards", async () => {
    const out = JSON.parse((await tool("suggestions")).content);
    expect(out).toHaveProperty("suggestions");
    expect(out).toHaveProperty("proposed");
  });

  it("after the bank is disconnected, has no $1,349.00 in its lookups or its saved numbers", async () => {
    // The numbers were saved while the demo bank was there.
    expect((await chatPrimer(userId, { client, now: day(10) })).cents).toContain(134_900);
    expect((await tool("coming_up")).cents).toContain(134_900);

    await removePlaidItem(userId, itemId, "user_disconnected", { client, api: plaid });

    expect((await tool("coming_up")).cents).not.toContain(134_900);
    expect(JSON.parse((await tool("search_transactions", appleStore)).content).matched).toBe(0);
    // The saved copy was built from the old data, so it isn't said, and the disconnect forgot
    // the copy kept in memory.
    const primer = await chatPrimer(userId, { client, now: day(10) });
    expect(primer.cents).not.toContain(134_900);
    expect(primer.text).not.toContain("$1,349.00");
    expect(primer.text).not.toContain("$3,840.12");
  });
});
