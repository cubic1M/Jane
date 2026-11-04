import { randomBytes } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@/generated/prisma/client";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn(), SYSTEM_ACTOR: { type: "system", id: null } }));

import { encrypt } from "@/lib/crypto";
import { removePlaidItem } from "./remove";
import { planWebhook } from "./webhooks";
import { DEMO_TOKEN_PREFIX } from "./demo";

// When a bank goes, or the person stops sharing one account, what was saved from it goes too. The
// saved numbers were only refused by their stamp: they stayed in the database, and in the export,
// and nothing remade them for someone who'd gone inactive.

const url = process.env.TEST_DATABASE_URL;

describe.runIf(url)("what's left when a bank or an account goes", () => {
  let client: PrismaClient;
  const created: string[] = [];

  async function person() {
    const user = await client.user.create({
      data: { email: `leftovers-${crypto.randomUUID()}@example.com` },
    });
    created.push(user.id);
    const plaidItemId = `demo-${crypto.randomUUID()}`;
    const item = await client.plaidItem.create({
      data: {
        userId: user.id,
        plaidItemId,
        accessTokenEncrypted: encrypt(`${DEMO_TOKEN_PREFIX}1:2026-01-01`),
        createdAt: new Date("2026-01-01T00:00:00Z"),
      },
    });
    const account = await client.account.create({
      data: {
        userId: user.id,
        itemId: item.id,
        source: "plaid",
        plaidAccountId: `acc-${crypto.randomUUID()}`,
        name: "Checking",
        type: "depository",
      },
    });
    for (const key of ["primer", "snapshot"]) {
      await client.janePreference.create({
        data: { userId: user.id, kind: "system", key, label: key, value: { text: "$4,210.00" } },
      });
    }
    await client.janePreference.create({
      data: { userId: user.id, kind: "tone", key: "own", label: "own", value: { short: true } },
    });
    return { userId: user.id, itemId: item.id, plaidItemId, account };
  }
  const left = (userId: string) =>
    client.janePreference
      .findMany({ where: { userId }, select: { key: true } })
      .then((rows) => rows.map((r) => r.key));

  beforeAll(() => {
    vi.stubEnv("TOKEN_ENCRYPTION_KEY", randomBytes(32).toString("base64"));
    client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
  });
  afterAll(async () => {
    await client.user.deleteMany({ where: { id: { in: created } } });
    await client.$disconnect();
    vi.unstubAllEnvs();
  });

  it("deletes the saved numbers with the bank, and keeps the person's own settings", async () => {
    const { userId, itemId } = await person();
    await removePlaidItem(userId, itemId, "inactive", {
      client,
      actor: { type: "system", id: null },
    });
    expect(await left(userId)).toEqual(["own"]);
  });

  it("does the same when the person stops sharing one account", async () => {
    const { userId, plaidItemId, account } = await person();
    await planWebhook(
      {
        item_id: plaidItemId,
        webhook_type: "ITEM",
        webhook_code: "USER_ACCOUNT_REVOKED",
        account_id: account.plaidAccountId,
      },
      { client },
    );
    expect(await client.account.count({ where: { id: account.id } })).toBe(0);
    expect(await left(userId)).toEqual(["own"]);
  });

  it("leaves them alone when the account was never there", async () => {
    const { userId, plaidItemId } = await person();
    await planWebhook(
      {
        item_id: plaidItemId,
        webhook_type: "ITEM",
        webhook_code: "USER_ACCOUNT_REVOKED",
        account_id: "made-up",
      },
      { client },
    );
    expect((await left(userId)).sort()).toEqual(["own", "primer", "snapshot"]);
  });
});
